import { describe, it, expect } from 'vitest';
import { snmpAdapter } from './snmp.js';
import { DEFAULT_ADAPTER_OPTS } from '../types.js';

const LIVE = process.env.PRINTER_DASHBOARD_LIVE === '1';
const d = LIVE ? describe : describe.skip;

/**
 * Phase 0 findings:
 *   192.168.0.137  HP OfficeJet Pro 9020  → SNMP returns all 4 supplies with real %
 *   192.168.0.159  HP ENVY 6000           → SNMP returns levels=0 for all supplies
 *   192.168.0.186  Canon SELPHY CP1300    → SNMP times out (no support)
 */

d('snmpAdapter (live)', () => {
  it('detects HP OfficeJet Pro 9020 at 192.168.0.137', async () => {
    expect(await snmpAdapter.detect('192.168.0.137', DEFAULT_ADAPTER_OPTS)).toBe(true);
  });

  it('fetches rich data from HP OfficeJet Pro 9020', async () => {
    const snap = await snmpAdapter.fetch('192.168.0.137', DEFAULT_ADAPTER_OPTS);
    expect(snap.ok).toBe(true);
    expect(snap.model).toMatch(/HP/i);
    expect(snap.status).toBe('online');
    expect(snap.pageCount).toBeGreaterThan(0);
    expect(snap.supplies).toBeDefined();
    expect(snap.supplies!.length).toBeGreaterThanOrEqual(4);
    const colors = new Set(snap.supplies!.map((s) => s.colorant));
    expect(colors.has('cyan')).toBe(true);
    expect(colors.has('black')).toBe(true);
  });

  it('detects HP ENVY 6000 at 192.168.0.159 (even though levels are wrong)', async () => {
    expect(await snmpAdapter.detect('192.168.0.159', DEFAULT_ADAPTER_OPTS)).toBe(true);
  });

  it('ENVY 6000 is online but SNMP-reported levels are all zero (expected)', async () => {
    const snap = await snmpAdapter.fetch('192.168.0.159', DEFAULT_ADAPTER_OPTS);
    expect(snap.ok).toBe(true);
    expect(snap.status).toBe('online');
    expect(snap.supplies!.every((s) => s.levelPercent === 0)).toBe(true);
    // This is the case that motivates the LEDM adapter.
  });

  it('does NOT detect the Canon SELPHY at 192.168.0.186', async () => {
    expect(
      await snmpAdapter.detect('192.168.0.186', { ...DEFAULT_ADAPTER_OPTS, snmpTimeoutMs: 1500 }),
    ).toBe(false);
  });
});
