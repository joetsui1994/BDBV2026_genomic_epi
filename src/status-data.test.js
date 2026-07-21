// src/status-data.test.js
import { describe, it, expect } from 'vitest';
import { parseStatus, seriesTotal, toZoneDaily } from './status-data.js';

const CSV = [
  'scale,area,date,confirmed_observed,confirmed_imputed',
  'national,,2026-04-20,2,0',
  'national,,2026-04-21,1,1',
  'province,Ituri,2026-04-20,1,0',
  'healthzone,Nyankunde,2026-04-20,1,1',
  'healthzone,Beni,2026-04-21,3,0',
].join('\n') + '\n';

describe('parseStatus', () => {
  it('splits rows by scale into date-keyed {observed,imputed} maps', () => {
    const s = parseStatus(CSV);
    expect(s.national.get('2026-04-20')).toEqual({ observed: 2, imputed: 0 });
    expect(s.national.get('2026-04-21')).toEqual({ observed: 1, imputed: 1 });
    expect(s.provinces.get('Ituri').get('2026-04-20')).toEqual({ observed: 1, imputed: 0 });   // province keyed by original case
    expect(s.zones.get('NYANKUNDE').get('2026-04-20')).toEqual({ observed: 1, imputed: 1 });   // zone keyed by UPPER Nom
  });
});

describe('seriesTotal', () => {
  it('sums observed+imputed per day', () => {
    const s = parseStatus(CSV);
    expect([...seriesTotal(s.national)]).toEqual([['2026-04-20', 2], ['2026-04-21', 2]]);
  });
});

describe('toZoneDaily', () => {
  it('flattens zone maps to UPPER Nom → date → total', () => {
    const s = parseStatus(CSV);
    const zd = toZoneDaily(s.zones);
    expect(zd.get('NYANKUNDE').get('2026-04-20')).toBe(2);
    expect(zd.get('BENI').get('2026-04-21')).toBe(3);
  });
});
