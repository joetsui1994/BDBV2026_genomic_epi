// src/zone-tally.test.js
import { describe, it, expect } from 'vitest';
import { tallyZones } from './zone-tally.js';

const D = (s) => +new Date(s);
// zoneDaily: Map<UPPER Nom, Map<dateStr, confirmedTotal>>
const zoneDaily = new Map([
  ['BUNIA', new Map([['2026-05-01', 2], ['2026-06-01', 3]])],
  ['KATWA', new Map([['2026-05-01', 1]])],
]);

describe('tallyZones', () => {
  it('full roll-up: per-zone confirmed totals keyed by UPPER Nom', () => {
    const { zoneCounts } = tallyZones(zoneDaily, null);
    expect(zoneCounts.get('BUNIA')).toEqual({ confirmed: 5, total: 5 });
    expect(zoneCounts.get('KATWA')).toEqual({ confirmed: 1, total: 1 });
  });
  it('window restricts to inclusive ms bounds', () => {
    const { zoneCounts } = tallyZones(zoneDaily, { d0: D('2026-05-01'), d1: D('2026-05-31') });
    expect(zoneCounts.get('BUNIA')).toEqual({ confirmed: 2, total: 2 });   // June excluded
  });
  it('empty window yields no zones', () => {
    const { zoneCounts } = tallyZones(zoneDaily, { d0: D('2027-01-01'), d1: D('2027-02-01') });
    expect(zoneCounts.size).toBe(0);
  });
});
