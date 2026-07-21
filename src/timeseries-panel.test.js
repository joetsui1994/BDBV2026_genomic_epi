import { describe, it, expect } from 'vitest';
import { extentFraction, isUsableTransform, brushWindow } from './timeseries-panel.js';

describe('isUsableTransform', () => {
  it('accepts a transform with a real finite drawn span', () => {
    expect(isUsableTransform({ offsetX: 34, maxX: 500, scaleX: 1.2 })).toBe(true);
  });
  it('rejects a collapsed tree (maxX>0 but scaleX≈0 → span≈0)', () => {
    expect(isUsableTransform({ offsetX: 100, maxX: 500, scaleX: 0 })).toBe(false);
  });
  it('rejects a zero/absent maxX', () => {
    expect(isUsableTransform({ offsetX: 100, maxX: 0, scaleX: 1.2 })).toBe(false);
  });
  it('rejects non-finite fields', () => {
    expect(isUsableTransform({ offsetX: NaN, maxX: 500, scaleX: 1.2 })).toBe(false);
    expect(isUsableTransform({ offsetX: 34, maxX: 500, scaleX: NaN })).toBe(false);
  });
  it('rejects null / undefined', () => {
    expect(isUsableTransform(null)).toBe(false);
    expect(isUsableTransform(undefined)).toBe(false);
  });
});

const T0 = +new Date('2026-04-05');   // tree root
const T1 = +new Date('2026-05-20');   // tree most-recent
const series = (entries) => new Map(entries);   // Map<dateStr, count>

describe('extentFraction', () => {
  it('off → effMax=t1, f=1', () => {
    expect(extentFraction(series([['2026-06-03', 1]]), T0, T1, false)).toEqual({ effMax: T1, f: 1 });
  });
  it('on with a later dated count → extends and shrinks proportionally', () => {
    const { effMax, f } = extentFraction(series([['2026-06-03', 2]]), T0, T1, true);
    expect(effMax).toBe(+new Date('2026-06-03'));
    expect(f).toBeCloseTo((T1 - T0) / (+new Date('2026-06-03') - T0), 4);
  });
  it('on but no dated count past t1 → f=1', () => {
    expect(extentFraction(series([['2026-05-10', 4]]), T0, T1, true).f).toBe(1);
  });
  it('ignores zero-count days when computing the extent', () => {
    expect(extentFraction(series([['2026-06-03', 0]]), T0, T1, true).effMax).toBe(T1);
  });
});

describe('brushWindow', () => {
  const scale = { xToDate: (x) => new Date(+new Date('2026-04-05') + x * 86400000) };  // 1px = 1 day
  it('returns null for a click (drag below the px threshold)', () => {
    expect(brushWindow(100, 102, scale, 3)).toBeNull();
  });
  it('orders the window regardless of drag direction', () => {
    const a = brushWindow(10, 40, scale, 3);
    const b = brushWindow(40, 10, scale, 3);
    expect(a).toEqual(b);
    expect(a.d0).toBe(+scale.xToDate(10));
    expect(a.d1).toBe(+scale.xToDate(40));
  });
});
