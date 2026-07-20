import { describe, it, expect } from 'vitest';
import { filterCsvToPositives } from './linelist-lib.mjs';

const CSV = [
  'row_id,sample_id,health_zone,status,date',
  '1,A,Bunia,Positive,2026-05-01',
  '2,B,Beni,Negative,2026-05-02',
  '3,C,Katwa,Unclassified,',
  '4,D,Bunia,Positive,2026-05-03',
  '',
].join('\n');

describe('filterCsvToPositives', () => {
  it('keeps the header + only Positive rows', () => {
    const out = filterCsvToPositives(CSV);
    expect(out).toBe([
      'row_id,sample_id,health_zone,status,date',
      '1,A,Bunia,Positive,2026-05-01',
      '4,D,Bunia,Positive,2026-05-03',
      '',
    ].join('\n'));
  });

  it('is idempotent (already-filtered input is unchanged)', () => {
    const once = filterCsvToPositives(CSV);
    expect(filterCsvToPositives(once)).toBe(once);
  });

  it('leaves a CSV without a status column untouched', () => {
    const noStatus = 'name,lat,lon\nBunia,1.5,30.2\n';
    expect(filterCsvToPositives(noStatus)).toBe(noStatus);
  });

  it('finds the status column wherever it sits', () => {
    const csv = 'status,x\nNegative,1\nPositive,2\n';
    expect(filterCsvToPositives(csv)).toBe('status,x\nPositive,2\n');
  });
});
