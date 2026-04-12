import { describe, it, expect } from 'vitest';
import { ippAdapter } from './ipp.js';
import { DEFAULT_ADAPTER_OPTS } from '../types.js';

const LIVE = process.env.PRINTER_DASHBOARD_LIVE === '1';
const d = LIVE ? describe : describe.skip;

d('ippAdapter (live)', () => {
  it('detects the Canon SELPHY CP1300 at 192.168.0.186', async () => {
    expect(await ippAdapter.detect('192.168.0.186', DEFAULT_ADAPTER_OPTS)).toBe(true);
  });

  it('fetches state + identity from the Canon SELPHY (level always unknown)', async () => {
    const snap = await ippAdapter.fetch('192.168.0.186', DEFAULT_ADAPTER_OPTS);
    expect(snap.ok).toBe(true);
    expect(snap.model).toMatch(/Canon SELPHY/i);
    expect(snap.status).toBe('online');
    expect(snap.supplies).toBeDefined();
    expect(snap.supplies!.length).toBeGreaterThanOrEqual(1);
    // SELPHY hardware cannot report ribbon level — it always reports -2.
    expect(snap.supplies![0]!.levelPercent).toBe(null);
    expect(snap.supplies![0]!.state).toBe('unknown');
  });

  // HPs advertise IPP over mDNS but don't respond at the standard /ipp/print path
  // — they use vendor-specific paths. We have LEDM + SNMP for HPs so this is fine;
  // no assertion needed here.
});
