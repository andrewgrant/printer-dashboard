import { describe, it, expect } from 'vitest';
import { ledmAdapter } from './ledm.js';
import { DEFAULT_ADAPTER_OPTS } from '../types.js';

const LIVE = process.env.PRINTER_DASHBOARD_LIVE === '1';
const d = LIVE ? describe : describe.skip;

d('ledmAdapter (live)', () => {
  it('detects HP OfficeJet Pro 9020 at 192.168.0.137', async () => {
    expect(await ledmAdapter.detect('192.168.0.137', DEFAULT_ADAPTER_OPTS)).toBe(true);
  });

  it('detects HP ENVY 6000 at 192.168.0.159', async () => {
    expect(await ledmAdapter.detect('192.168.0.159', DEFAULT_ADAPTER_OPTS)).toBe(true);
  });

  it('does NOT detect the Canon SELPHY at 192.168.0.186', async () => {
    expect(
      await ledmAdapter.detect('192.168.0.186', { ...DEFAULT_ADAPTER_OPTS, httpTimeoutMs: 2000 }),
    ).toBe(false);
  });

  it('fetches ENVY 6000 supplies with REAL percentages (unlike SNMP)', async () => {
    const snap = await ledmAdapter.fetch('192.168.0.159', DEFAULT_ADAPTER_OPTS);
    expect(snap.ok).toBe(true);
    expect(snap.model).toMatch(/ENVY 6000/);
    expect(snap.supplies).toBeDefined();
    expect(snap.supplies!.length).toBeGreaterThanOrEqual(2);
    // The tri-color cartridge should NOT be 0% — SNMP lies about this, LEDM tells the truth.
    const nonZero = snap.supplies!.filter((s) => (s.levelPercent ?? 0) > 0);
    expect(nonZero.length).toBeGreaterThan(0);
    expect(snap.pageCount).toBeGreaterThan(0);
  });

  it('fetches OfficeJet Pro 9020 with rich usage data', async () => {
    const snap = await ledmAdapter.fetch('192.168.0.137', DEFAULT_ADAPTER_OPTS);
    expect(snap.ok).toBe(true);
    expect(snap.model).toMatch(/OfficeJet/i);
    expect(snap.pageCount).toBeGreaterThan(0);
    expect(snap.pageCountColor).toBeDefined();
    expect(snap.pageCountMono).toBeDefined();
    expect(snap.supplies!.length).toBeGreaterThanOrEqual(4);
  });
});
