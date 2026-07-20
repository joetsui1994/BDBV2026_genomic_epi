import { describe, it, expect } from 'vitest';
import { parseSkygridLog, gridTimes, hpd, summariseSkygrid } from './skygrid-lib.mjs';

const LOG = [
  '# BEAST vX',
  '# Generated',
  '# file.xml',
  '# keywords: skygrid',
  ['state', 'likelihood', 'skygrid.cutOff', 'skygrid.logPopSize1', 'skygrid.logPopSize2', 'skygrid.logPopSize3'].join('\t'),
  ['0',   '-10', '0.3', '0',                  '0', '0'].join('\t'),
  ['50',  '-9',  '0.3', '0.6931471805599453', '0', '0'].join('\t'),   // ln2
  ['100', '-8',  '0.3', '1.0986122886681098', '0', '0'].join('\t'),   // ln3
].join('\n');

describe('parseSkygridLog', () => {
  it('extracts states with cutOff + ordered logPopSizes (skipping comments)', () => {
    const { states } = parseSkygridLog(LOG);
    expect(states).toHaveLength(3);
    expect(states[0].cutOff).toBe(0.3);
    expect(states[1].logPopSizes).toHaveLength(3);
    expect(states[1].logPopSizes[0]).toBeCloseTo(Math.log(2), 10);
  });
});

describe('gridTimes', () => {
  it('evenly spaces g_k = cutOff*k/gridPoints', () => {
    expect(gridTimes(0.3, 2)).toEqual([0.15, 0.3]);
  });
});

describe('hpd', () => {
  it('returns the narrowest interval covering the mass', () => {
    expect(hpd([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toEqual([1, 5]);
  });
  it('handles a full-mass / tiny sample', () => {
    expect(hpd([10, 20, 30], 1)).toEqual([10, 30]);
  });
});

describe('summariseSkygrid', () => {
  it('drops burn-in, yields gridPoints+1 points at times [0, g...], median on Ne', () => {
    const { states } = parseSkygridLog(LOG);
    const out = summariseSkygrid(states, { cutOff: 0.3, gridPoints: 2, mostRecentDate: '2026-06-23', burninFraction: 0.5 });
    expect(out.keptStates).toBe(2);                       // states 50 & 100 (>= 0.5*100)
    expect(out.points.map((p) => p.tBP)).toEqual([0, 0.15, 0.3]);
    expect(out.points[0].date).toBe('2026-06-23');        // tBP 0 → most recent date
    expect(out.points[0].neMedian).toBeCloseTo(2.5, 10);  // median(exp[ln2, ln3]) = (2+3)/2
  });
});
