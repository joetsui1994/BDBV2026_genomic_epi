import { describe, it, expect } from 'vitest';
import { parseExponentialLog, neOfExponential, summariseExponential } from './exponential-lib.mjs';

const LOG = [
  '# BEAST vX',
  '# Generated',
  '# file.xml',
  ['state', 'likelihood', 'exponential.popSize', 'exponential.growthRate', 'doublingTime'].join('\t'),
  ['0',   '-10', '2', '0', 'Infinity'].join('\t'),
  ['50',  '-9',  '2', '1', '0.69'].join('\t'),
  ['100', '-8',  '4', '1', '0.69'].join('\t'),
].join('\n');

describe('parseExponentialLog', () => {
  it('extracts popSize + growthRate per state (3 comment lines)', () => {
    const { states } = parseExponentialLog(LOG);
    expect(states).toHaveLength(3);
    expect(states[2]).toEqual({ state: 100, popSize: 4, growthRate: 1 });
  });
});

describe('neOfExponential', () => {
  it('Ne(t) = popSize * exp(-growthRate * t)', () => {
    expect(neOfExponential(2, 0, 5)).toBe(2);             // no growth → constant
    expect(neOfExponential(2, 1, 0)).toBe(2);             // present
    expect(neOfExponential(2, 1, 1)).toBeCloseTo(2 * Math.exp(-1), 10);
  });
});

describe('summariseExponential', () => {
  it('drops burn-in and summarises Ne over the grid (median on Ne)', () => {
    const { states } = parseExponentialLog(LOG);
    const out = summariseExponential(states, { maxYearsBP: 1, steps: 2, mostRecentDate: '2026-06-23', burninFraction: 0.5 });
    expect(out.keptStates).toBe(2);                       // states 50 & 100
    expect(out.points).toHaveLength(3);                    // steps + 1
    expect(out.points.map((p) => p.tBP)).toEqual([0, 0.5, 1]);
    expect(out.points[0].date).toBe('2026-06-23');
    expect(out.points[0].neMedian).toBeCloseTo(3, 10);     // median(popSize[2,4]) at t=0
  });
});
