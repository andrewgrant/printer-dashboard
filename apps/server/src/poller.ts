import type { Repo } from './db.js';
import type { AdapterOpts, PrinterSnapshot, Supply } from './types.js';
import { detectAdapters, runAdapters } from './adapters/index.js';
import { discover } from './discovery.js';
import { v4 as uuid } from 'uuid';

export interface PollerDeps {
  repo: Repo;
  opts: AdapterOpts;
  pollIntervalMs: number;
  discoveryIntervalMs: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  now?: () => number;
  /** Test hook: override the adapter runner. */
  runAdapters?: typeof runAdapters;
  /** Test hook: override the discovery call. */
  discover?: typeof discover;
}

/** Threshold for "level went up" → detected cartridge swap. */
const SUPPLY_INCREASE_THRESHOLD = 20;

/**
 * Compare a new snapshot against the previous one and find supplies whose
 * level jumped up by more than `SUPPLY_INCREASE_THRESHOLD` percentage points.
 * These represent cartridge replacements.
 */
export function detectSupplyChanges(prev: Supply[], next: Supply[]): Supply[] {
  const prevByLabel = new Map(prev.map((s) => [s.label, s]));
  const changed: Supply[] = [];
  for (const n of next) {
    if (n.levelPercent === null) continue;
    const p = prevByLabel.get(n.label);
    if (!p || p.levelPercent === null) continue;
    if (n.levelPercent - p.levelPercent >= SUPPLY_INCREASE_THRESHOLD) {
      changed.push(n);
    }
  }
  return changed;
}

export class Poller {
  private pollTimer: NodeJS.Timeout | null = null;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly now: () => number;
  private readonly runAdaptersFn: typeof runAdapters;
  private readonly discoverFn: typeof discover;

  constructor(private readonly deps: PollerDeps) {
    this.log = deps.logger ?? console;
    this.now = deps.now ?? Date.now;
    this.runAdaptersFn = deps.runAdapters ?? runAdapters;
    this.discoverFn = deps.discover ?? discover;
  }

  start(): void {
    void this.runPollCycle();
    void this.runDiscoveryCycle();
    this.pollTimer = setInterval(() => void this.runPollCycle(), this.deps.pollIntervalMs);
    this.discoveryTimer = setInterval(
      () => void this.runDiscoveryCycle(),
      this.deps.discoveryIntervalMs,
    );
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.pollTimer = null;
    this.discoveryTimer = null;
  }

  async runPollCycle(): Promise<void> {
    const printers = this.deps.repo.listPrinters();
    if (printers.length === 0) return;
    this.log.info(`[poller] polling ${printers.length} printer(s)`);
    await Promise.allSettled(printers.map((p) => this.pollOne(p.id)));
  }

  async pollOne(printerId: string): Promise<PrinterSnapshot | null> {
    const printer = this.deps.repo.getPrinter(printerId);
    if (!printer) return null;

    let adapters = printer.adapters;
    if (adapters.length === 0) {
      adapters = await detectAdapters(printer.ip, this.deps.opts);
      this.deps.repo.updatePrinterMeta(printer.id, { adapters });
    }

    const { snapshot } = await this.runAdaptersFn(printer.ip, this.deps.opts, adapters);
    snapshot.takenAt = this.now();

    const prev = this.deps.repo.getLatestSnapshot(printer.id);

    if (prev) {
      const changes = detectSupplyChanges(prev.supplies, snapshot.supplies);
      for (const c of changes) {
        this.deps.repo.insertSupplyEvent(printer.id, c.label, snapshot.takenAt, snapshot.pageCount ?? null);
        this.log.info(`[poller] detected supply change on ${printer.ip}: ${c.label}`);
      }
    }

    this.deps.repo.insertSnapshot(printer.id, snapshot);
    this.deps.repo.updatePrinterMeta(printer.id, {
      model: snapshot.model ?? printer.model ?? null,
      lastSeenAt: snapshot.status === 'offline' ? printer.lastSeenAt : snapshot.takenAt,
    });

    return snapshot;
  }

  async runDiscoveryCycle(): Promise<void> {
    try {
      const found = await this.discoverFn(8000);
      const newlyAdded: string[] = [];
      for (const f of found) {
        if (this.deps.repo.getPrinterByIp(f.ip)) continue;
        const id = uuid();
        this.deps.repo.insertPrinter({
          id,
          ip: f.ip,
          name: f.name ?? null,
          model: f.model ?? null,
          source: 'discovered',
          community: this.deps.opts.community,
          adapters: [],
        });
        newlyAdded.push(id);
        this.log.info(`[poller] discovered ${f.ip} ${f.name}`);
      }
      // Poll new arrivals immediately so their status shows up without waiting
      // for the next regular poll cycle.
      if (newlyAdded.length > 0) {
        await Promise.allSettled(newlyAdded.map((id) => this.pollOne(id)));
      }
    } catch (err) {
      this.log.warn(`[poller] discovery failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
