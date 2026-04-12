import { describe, it, expect } from 'vitest';
import {
  buildSnapshotFromVarbinds,
  deviceStatusToPrinterStatus,
  guessColorant,
  supplyStateFromPercent,
} from './snmp.js';

describe('guessColorant', () => {
  it.each([
    ['cyan ink HP 3JA86A', 'cyan'],
    ['magenta ink HP 3JA87A', 'magenta'],
    ['yellow ink HP 3JA88A', 'yellow'],
    ['black ink HP 3JA89A', 'black'],
    ['tri-color ink cartridge HP unknown', 'color'],
    ['photo gray ink', 'photo'],
    ['something weird', 'other'],
  ])('maps %s → %s', (input, expected) => {
    expect(guessColorant(input)).toBe(expected);
  });
});

describe('supplyStateFromPercent', () => {
  it.each([
    [null, 'unknown'],
    [0, 'empty'],
    [5, 'veryLow'],
    [10, 'veryLow'],
    [15, 'low'],
    [25, 'low'],
    [26, 'ok'],
    [100, 'ok'],
  ] as const)('%s → %s', (pct, state) => {
    expect(supplyStateFromPercent(pct)).toBe(state);
  });
});

describe('deviceStatusToPrinterStatus', () => {
  it('maps known codes', () => {
    expect(deviceStatusToPrinterStatus(2)).toBe('online');
    expect(deviceStatusToPrinterStatus(3)).toBe('warning');
    expect(deviceStatusToPrinterStatus(4)).toBe('warning');
    expect(deviceStatusToPrinterStatus(5)).toBe('offline');
    expect(deviceStatusToPrinterStatus(1)).toBe('unknown');
    expect(deviceStatusToPrinterStatus(null)).toBe('unknown');
  });
});

describe('buildSnapshotFromVarbinds', () => {
  it('parses a healthy HP OfficeJet varbind set', () => {
    // Reproduces what probe.ts saw against 192.168.0.137.
    const vbs = new Map<string, unknown>([
      ['1.3.6.1.2.1.1.1.0', Buffer.from('HP ETHERNET MULTI-ENVIRONMENT')],
      ['1.3.6.1.2.1.1.5.0', Buffer.from('HPA01932')],
      ['1.3.6.1.2.1.25.3.2.1.5.1', 2],
      ['1.3.6.1.2.1.25.3.5.1.1.1', 3],
      ['1.3.6.1.2.1.43.10.2.1.4.1.1', 23721],
      ['1.3.6.1.2.1.43.11.1.1.6.1.1', Buffer.from('cyan ink HP 3JA86A')],
      ['1.3.6.1.2.1.43.11.1.1.6.1.2', Buffer.from('magenta ink HP 3JA87A')],
      ['1.3.6.1.2.1.43.11.1.1.6.1.3', Buffer.from('yellow ink HP 3JA88A')],
      ['1.3.6.1.2.1.43.11.1.1.6.1.4', Buffer.from('black ink HP 3JA89A')],
      ['1.3.6.1.2.1.43.11.1.1.8.1.1', 100],
      ['1.3.6.1.2.1.43.11.1.1.8.1.2', 100],
      ['1.3.6.1.2.1.43.11.1.1.8.1.3', 100],
      ['1.3.6.1.2.1.43.11.1.1.8.1.4', 100],
      ['1.3.6.1.2.1.43.11.1.1.9.1.1', 85],
      ['1.3.6.1.2.1.43.11.1.1.9.1.2', 0],
      ['1.3.6.1.2.1.43.11.1.1.9.1.3', 91],
      ['1.3.6.1.2.1.43.11.1.1.9.1.4', 29],
    ]);

    const snap = buildSnapshotFromVarbinds(vbs);

    expect(snap.ok).toBe(true);
    expect(snap.adapter).toBe('snmp');
    expect(snap.model).toBe('HP ETHERNET MULTI-ENVIRONMENT');
    expect(snap.name).toBe('HPA01932');
    expect(snap.status).toBe('online');
    expect(snap.deviceStatus).toBe('running');
    expect(snap.printerStatus).toBe('idle');
    expect(snap.pageCount).toBe(23721);
    expect(snap.supplies).toHaveLength(4);
    expect(snap.supplies![0]).toEqual({
      colorant: 'cyan',
      label: 'cyan ink HP 3JA86A',
      levelPercent: 85,
      state: 'ok',
    });
    expect(snap.supplies![1]!.state).toBe('empty');
    expect(snap.supplies![3]!.state).toBe('ok');
  });

  it('handles HP ENVY 6000 reporting all-zero levels (the motivating LEDM case)', () => {
    const vbs = new Map<string, unknown>([
      ['1.3.6.1.2.1.1.1.0', Buffer.from('HP ETHERNET MULTI-ENVIRONMENT')],
      ['1.3.6.1.2.1.25.3.2.1.5.1', 2],
      ['1.3.6.1.2.1.43.10.2.1.4.1.1', 1336],
      ['1.3.6.1.2.1.43.11.1.1.6.1.1', Buffer.from('tri-color ink cartridge HP unknown')],
      ['1.3.6.1.2.1.43.11.1.1.6.1.2', Buffer.from('black ink cartridge HP unknown')],
      ['1.3.6.1.2.1.43.11.1.1.8.1.1', 100],
      ['1.3.6.1.2.1.43.11.1.1.8.1.2', 100],
      ['1.3.6.1.2.1.43.11.1.1.9.1.1', 0],
      ['1.3.6.1.2.1.43.11.1.1.9.1.2', 0],
    ]);
    const snap = buildSnapshotFromVarbinds(vbs);
    expect(snap.supplies).toHaveLength(2);
    expect(snap.supplies![0]!.colorant).toBe('color');
    expect(snap.supplies![0]!.levelPercent).toBe(0);
    expect(snap.supplies![0]!.state).toBe('empty');
    expect(snap.pageCount).toBe(1336);
  });

  it('treats negative level values as unknown (RFC 3805 -2/-3)', () => {
    const vbs = new Map<string, unknown>([
      ['1.3.6.1.2.1.43.11.1.1.6.1.1', Buffer.from('Color Ink Ribbon')],
      ['1.3.6.1.2.1.43.11.1.1.8.1.1', 36],
      ['1.3.6.1.2.1.43.11.1.1.9.1.1', -2],
    ]);
    const snap = buildSnapshotFromVarbinds(vbs);
    expect(snap.supplies).toHaveLength(1);
    expect(snap.supplies![0]!.levelPercent).toBe(null);
    expect(snap.supplies![0]!.state).toBe('unknown');
  });

  it('skips supply rows missing any of description/level/max', () => {
    const vbs = new Map<string, unknown>([
      ['1.3.6.1.2.1.43.11.1.1.6.1.1', Buffer.from('cyan')],
      // no max, no level
    ]);
    const snap = buildSnapshotFromVarbinds(vbs);
    expect(snap.supplies).toEqual([]);
  });
});
