import { describe, it, expect } from 'vitest';
import { buildSnapshotFromAttrs } from './ipp.js';

describe('buildSnapshotFromAttrs', () => {
  it('parses the real Canon SELPHY CP1300 attribute set (level=-2 unknown)', () => {
    // Reproduces what Phase 0 ipp-probe.ts captured from 192.168.0.186.
    const attrs = {
      'printer-name': 'Canon SELPHY CP1300',
      'printer-make-and-model': 'Canon SELPHY CP1300 HTTP',
      'printer-state': 'idle',
      'printer-state-reasons': 'none',
      'printer-is-accepting-jobs': true,
      'marker-names': 'Color',
      'marker-levels': -2,
      'marker-high-levels': 100,
      'marker-low-levels': 1,
      'marker-types': 'ink-ribbon',
    };
    const snap = buildSnapshotFromAttrs(attrs);
    expect(snap.ok).toBe(true);
    expect(snap.adapter).toBe('ipp');
    expect(snap.name).toBe('Canon SELPHY CP1300');
    expect(snap.model).toBe('Canon SELPHY CP1300 HTTP');
    expect(snap.status).toBe('online');
    expect(snap.printerStatus).toBe('idle');
    expect(snap.statusMessage).toBeUndefined();
    expect(snap.supplies).toHaveLength(1);
    expect(snap.supplies![0]).toEqual({
      colorant: 'color',
      label: 'Color',
      levelPercent: null,
      state: 'unknown',
    });
  });

  it('maps printer-state stopped → warning', () => {
    const snap = buildSnapshotFromAttrs({
      'printer-state': 'stopped',
      'printer-state-reasons': ['media-empty', 'cover-open'],
    });
    expect(snap.status).toBe('warning');
    expect(snap.statusMessage).toBe('media-empty, cover-open');
  });

  it('treats not-accepting-jobs as a warning', () => {
    const snap = buildSnapshotFromAttrs({
      'printer-state': 'idle',
      'printer-is-accepting-jobs': false,
    });
    expect(snap.status).toBe('warning');
  });

  it('computes percent from real CMYK marker levels', () => {
    const snap = buildSnapshotFromAttrs({
      'printer-state': 'idle',
      'marker-names': ['Cyan', 'Magenta', 'Yellow', 'Black'],
      'marker-levels': [85, 0, 91, 29],
      'marker-high-levels': [100, 100, 100, 100],
    });
    expect(snap.supplies).toHaveLength(4);
    expect(snap.supplies![0]).toMatchObject({ colorant: 'cyan', levelPercent: 85, state: 'ok' });
    expect(snap.supplies![1]).toMatchObject({ colorant: 'magenta', levelPercent: 0, state: 'empty' });
    expect(snap.supplies![2]).toMatchObject({ colorant: 'yellow', levelPercent: 91, state: 'ok' });
    expect(snap.supplies![3]).toMatchObject({ colorant: 'black', levelPercent: 29, state: 'ok' });
  });

  it('ignores "none" in printer-state-reasons', () => {
    const snap = buildSnapshotFromAttrs({
      'printer-state': 'idle',
      'printer-state-reasons': 'none',
    });
    expect(snap.statusMessage).toBeUndefined();
    expect(snap.status).toBe('online');
  });
});
