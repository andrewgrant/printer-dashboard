import { describe, it, expect } from 'vitest';
import { mergePartials } from './index.js';
import type { PartialSnapshot } from '../types.js';

describe('mergePartials', () => {
  it('uses LEDM supplies when both SNMP and LEDM succeed (LEDM > SNMP precedence)', () => {
    // The ENVY 6000 scenario: SNMP says 0%, LEDM says real values.
    const snmp: PartialSnapshot = {
      adapter: 'snmp',
      ok: true,
      model: 'HP ETHERNET MULTI-ENVIRONMENT',
      status: 'online',
      pageCount: 1336,
      supplies: [
        { colorant: 'color', label: 'tri-color ink cartridge HP unknown', levelPercent: 0, state: 'empty' },
        { colorant: 'black', label: 'black ink cartridge HP unknown', levelPercent: 0, state: 'empty' },
      ],
    };
    const ledm: PartialSnapshot = {
      adapter: 'ledm',
      ok: true,
      model: 'ENVY 6000 All-in-One Printer series',
      status: 'online',
      pageCount: 1336,
      pageCountColor: 928,
      pageCountMono: 407,
      supplies: [
        { colorant: 'color', label: 'Tri-color', levelPercent: 10, state: 'veryLow' },
        { colorant: 'black', label: 'Black', levelPercent: 20, state: 'low' },
      ],
    };
    const merged = mergePartials([snmp, ledm]);
    expect(merged.sources).toEqual(['snmp', 'ledm']);
    expect(merged.model).toBe('ENVY 6000 All-in-One Printer series'); // LEDM wins
    expect(merged.supplies).toHaveLength(2);
    expect(merged.supplies[0]!.levelPercent).toBe(10); // LEDM truth
    expect(merged.supplies[1]!.levelPercent).toBe(20);
    expect(merged.pageCountColor).toBe(928);
    expect(merged.pageCountMono).toBe(407);
  });

  it('falls back to SNMP when LEDM is not present (OfficeJet-style if LEDM were unreachable)', () => {
    const snmp: PartialSnapshot = {
      adapter: 'snmp',
      ok: true,
      status: 'online',
      pageCount: 23721,
      supplies: [
        { colorant: 'cyan', label: 'cyan ink HP 3JA86A', levelPercent: 85, state: 'ok' },
      ],
    };
    const merged = mergePartials([snmp]);
    expect(merged.sources).toEqual(['snmp']);
    expect(merged.supplies[0]!.levelPercent).toBe(85);
    expect(merged.pageCount).toBe(23721);
  });

  it('uses IPP data when it is the only successful adapter (Canon SELPHY)', () => {
    const ipp: PartialSnapshot = {
      adapter: 'ipp',
      ok: true,
      name: 'Canon SELPHY CP1300',
      model: 'Canon SELPHY CP1300 HTTP',
      status: 'online',
      printerStatus: 'idle',
      supplies: [{ colorant: 'color', label: 'Color', levelPercent: null, state: 'unknown' }],
    };
    const snmpFail: PartialSnapshot = { adapter: 'snmp', ok: false, error: 'Request timed out' };
    const ledmFail: PartialSnapshot = { adapter: 'ledm', ok: false, error: 'no response' };
    const merged = mergePartials([snmpFail, ledmFail, ipp]);
    expect(merged.sources).toEqual(['ipp']);
    expect(merged.model).toBe('Canon SELPHY CP1300 HTTP');
    expect(merged.status).toBe('online');
    expect(merged.supplies).toHaveLength(1);
    expect(merged.supplies[0]!.levelPercent).toBe(null);
  });

  it('returns offline status when every adapter fails', () => {
    const merged = mergePartials([
      { adapter: 'snmp', ok: false, error: 'timeout' },
      { adapter: 'ledm', ok: false, error: 'ECONNREFUSED' },
      { adapter: 'ipp', ok: false, error: '503' },
    ]);
    expect(merged.status).toBe('offline');
    expect(merged.sources).toEqual([]);
    expect(merged.statusMessage).toContain('snmp');
    expect(merged.statusMessage).toContain('ledm');
    expect(merged.statusMessage).toContain('ipp');
    expect(merged.supplies).toEqual([]);
  });

  it('skips empty supplies arrays so a later source can still fill them', () => {
    const snmp: PartialSnapshot = {
      adapter: 'snmp',
      ok: true,
      supplies: [{ colorant: 'cyan', label: 'cyan', levelPercent: 50, state: 'ok' }],
    };
    const ledm: PartialSnapshot = {
      adapter: 'ledm',
      ok: true,
      model: 'ENVY',
      supplies: [], // LEDM returned empty
    };
    const merged = mergePartials([snmp, ledm]);
    // LEDM's empty supplies should NOT clobber SNMP's valid supplies.
    expect(merged.supplies).toHaveLength(1);
    expect(merged.supplies[0]!.levelPercent).toBe(50);
    expect(merged.model).toBe('ENVY');
  });
});
