import { describe, it, expect } from 'vitest';
import { discover } from './discovery.js';

const LIVE = process.env.PRINTER_DASHBOARD_LIVE === '1';
const d = LIVE ? describe : describe.skip;

d('mDNS discovery (live)', () => {
  it('finds at least two of the three target printers within 10 seconds', async () => {
    // mDNS is inherently unreliable — consumer WiFi printers sleep and may miss
    // a broadcast window. We assert "at least two" rather than "all three" so the
    // test isn't flaky; the service itself retries on an interval.
    const printers = await discover(10_000);
    const ips = new Set(printers.map((p) => p.ip));
    const targets = ['192.168.0.137', '192.168.0.159', '192.168.0.186'];
    const found = targets.filter((ip) => ips.has(ip));
    expect(found.length).toBeGreaterThanOrEqual(2);
  }, 15_000);

  it('records the TXT ty/product as a model hint when a printer is found', async () => {
    const printers = await discover(10_000);
    expect(printers.length).toBeGreaterThan(0);
    // At least one of them should carry a model hint from TXT.
    expect(printers.some((p) => p.model !== undefined)).toBe(true);
  }, 15_000);
});
