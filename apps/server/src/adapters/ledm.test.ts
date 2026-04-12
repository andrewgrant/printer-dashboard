import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseConsumables, parseUsage, parseConfig, mapMeasuredQuantityState } from './ledm.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const load = (name: string): string => readFileSync(join(fixturesDir, name), 'utf8');

describe('mapMeasuredQuantityState', () => {
  it.each([
    [undefined, 'unknown'],
    ['ok', 'ok'],
    ['low', 'low'],
    ['veryLow', 'veryLow'],
    ['exhausted', 'empty'],
    ['outOfInk', 'empty'],
    ['missing', 'unknown'],
    ['bogus', 'unknown'],
  ] as const)('%s → %s', (input, expected) => {
    expect(mapMeasuredQuantityState(input)).toBe(expected);
  });
});

describe('parseConsumables (HP ENVY 6000 fixture)', () => {
  const supplies = parseConsumables(load('envy6000-consumables.xml'));

  it('extracts both cartridges', () => {
    expect(supplies).toHaveLength(2);
  });

  it('reports tri-color at 10% veryLow (the truth SNMP hides)', () => {
    const color = supplies.find((s) => s.colorant === 'color');
    expect(color).toBeDefined();
    expect(color!.levelPercent).toBe(10);
    expect(color!.state).toBe('veryLow');
  });

  it('reports black at 20% low', () => {
    const black = supplies.find((s) => s.colorant === 'black');
    expect(black).toBeDefined();
    expect(black!.levelPercent).toBe(20);
    expect(black!.state).toBe('low');
  });
});

describe('parseConsumables (HP OfficeJet Pro 9020 fixture)', () => {
  const supplies = parseConsumables(load('officejet9020-consumables.xml'));

  it('extracts at least the four CMYK cartridges', () => {
    const colorants = new Set(supplies.map((s) => s.colorant));
    expect(colorants.has('cyan')).toBe(true);
    expect(colorants.has('magenta')).toBe(true);
    expect(colorants.has('yellow')).toBe(true);
    expect(colorants.has('black')).toBe(true);
  });

  it('all four have a numeric level percent', () => {
    const cmyk = supplies.filter((s) => ['cyan', 'magenta', 'yellow', 'black'].includes(s.colorant));
    for (const s of cmyk) {
      expect(typeof s.levelPercent === 'number').toBe(true);
      expect(s.levelPercent).toBeGreaterThanOrEqual(0);
      expect(s.levelPercent).toBeLessThanOrEqual(100);
    }
  });
});

describe('parseUsage (HP ENVY 6000 fixture)', () => {
  const usage = parseUsage(load('envy6000-usage.xml'));

  it('extracts the lifetime page count and color/mono split', () => {
    expect(usage.pageCount).toBe(1336);
    expect(usage.pageCountMono).toBe(407);
    expect(usage.pageCountColor).toBe(928);
  });
});

describe('parseConfig (HP ENVY 6000 fixture)', () => {
  it('extracts MakeAndModel and SerialNumber', () => {
    const cfg = parseConfig(load('envy6000-config.xml'));
    expect(cfg.model).toMatch(/ENVY 6000/);
    expect(cfg.serial).toBe('XXXXXXXXXX');
  });
});
