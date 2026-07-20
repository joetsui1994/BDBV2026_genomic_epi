import { describe, it, expect } from 'vitest';
import { niceLogRange, logTicks, fmtNe } from './log-scale.js';

describe('niceLogRange', () => {
  it('rounds out to enclosing decades', () => {
    expect(niceLogRange(0.02, 600)).toEqual([0.01, 1000]);
  });
  it('never returns a zero-width range', () => {
    expect(niceLogRange(1, 1)).toEqual([1, 10]);
  });
  it('falls back for non-positive input', () => {
    expect(niceLogRange(0, 5)).toEqual([1, 10]);
  });
});

describe('logTicks', () => {
  it('returns one tick per decade inclusive', () => {
    expect(logTicks(0.01, 1000)).toEqual([0.01, 0.1, 1, 10, 100, 1000]);
  });
});

describe('fmtNe', () => {
  it('integers >= 1, decimals below', () => {
    expect(fmtNe(1000)).toBe('1000');
    expect(fmtNe(1)).toBe('1');
    expect(fmtNe(0.1)).toBe('0.1');
    expect(fmtNe(0.01)).toBe('0.01');
  });
});
