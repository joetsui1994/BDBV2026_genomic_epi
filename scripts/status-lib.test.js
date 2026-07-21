// scripts/status-lib.test.js
import { describe, it, expect } from 'vitest';
import { buildDerivedRows, serializeDerived } from './status-lib.mjs';

const RAW = [
  'country,date_of_symptom_onset_imputed,onset_date_was_imputed,blank,not_a_case,confirmed_case,suspected_case,probable_case,spatial_scale,province,health_zone',
  '"DRC",2026-04-20,FALSE,1,0,2,0,0,"national",NA,NA',
  '"DRC",2026-04-20,FALSE,0,0,1,0,0,"province","Ituri",NA',
  '"DRC",2026-04-20,FALSE,0,0,1,0,0,"healthzone",NA,"Nyankunde"',
  '"DRC",2026-04-20,TRUE,0,0,1,0,0,"healthzone",NA,"Nyankunde"', // imputed, same zone+date → merges
  '"DRC",2026-04-21,FALSE,3,0,0,1,0,"national",NA,NA',           // 0 confirmed → dropped
  '"DRC",2026-05-17,TRUE,0,0,1,0,0,"province","Ituri",NA',        // imputed only
].join('\n') + '\n';

describe('buildDerivedRows', () => {
  it('keeps confirmed>0, merges observed/imputed per (scale,area,date), drops non-confirmed', () => {
    const rows = buildDerivedRows(RAW);
    // national 04-20: observed 2
    expect(rows).toContainEqual({ scale: 'national', area: '', date: '2026-04-20', observed: 2, imputed: 0 });
    // province Ituri 04-20 observed 1; 05-17 imputed 1
    expect(rows).toContainEqual({ scale: 'province', area: 'Ituri', date: '2026-04-20', observed: 1, imputed: 0 });
    expect(rows).toContainEqual({ scale: 'province', area: 'Ituri', date: '2026-05-17', observed: 0, imputed: 1 });
    // Nyankunde 04-20: FALSE+TRUE merge → observed 1, imputed 1
    expect(rows).toContainEqual({ scale: 'healthzone', area: 'Nyankunde', date: '2026-04-20', observed: 1, imputed: 1 });
    // the 0-confirmed national 04-21 row is absent
    expect(rows.some(r => r.date === '2026-04-21')).toBe(false);
  });
});

describe('serializeDerived', () => {
  it('emits the header + one line per row with a trailing newline', () => {
    const text = serializeDerived([
      { scale: 'national', area: '', date: '2026-04-20', observed: 2, imputed: 0 },
    ]);
    expect(text).toBe('scale,area,date,confirmed_observed,confirmed_imputed\nnational,,2026-04-20,2,0\n');
  });
});
