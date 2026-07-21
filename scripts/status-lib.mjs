// scripts/status-lib.mjs
// Pure transform: raw status_aggregated.csv → minimal derived rows (confirmed cases only,
// observed/imputed split, one row per (scale, area, date)). No IO — see build-status.mjs for the
// CLI wrapper that adds zone canonicalisation + file writes. Unit-tested in status-lib.test.js.
//
// The aggregate has no quoted fields containing commas, so a naive comma split (with wrapping-quote
// strip) is safe.

const unquote = (s) => {
  const t = (s ?? '').trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
};
const naToEmpty = (s) => (s === 'NA' || s == null ? '' : s);

/** Parse the raw CSV into typed field objects (one per data row). */
export function parseAggregateCsv(text) {
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = lines[i].split(',');
    out.push({
      date: unquote(c[1]),
      imputed: unquote(c[2]).toUpperCase() === 'TRUE',
      confirmed: Number(unquote(c[5])) || 0,
      scale: unquote(c[8]),
      province: naToEmpty(unquote(c[9])),
      health_zone: naToEmpty(unquote(c[10])),
    });
  }
  return out;
}

/** Build merged derived rows: confirmed>0 only, one row per (scale, area, date). */
export function buildDerivedRows(text) {
  const byKey = new Map();   // `${scale} ${area} ${date}` → row
  for (const r of parseAggregateCsv(text)) {
    if (!r.confirmed) continue;
    const area = r.scale === 'province' ? r.province : r.scale === 'healthzone' ? r.health_zone : '';
    const key = `${r.scale} ${area} ${r.date}`;
    let row = byKey.get(key);
    if (!row) { row = { scale: r.scale, area, date: r.date, observed: 0, imputed: 0 }; byKey.set(key, row); }
    if (r.imputed) row.imputed += r.confirmed; else row.observed += r.confirmed;
  }
  return [...byKey.values()];
}

const DERIVED_COLS = ['scale', 'area', 'date', 'confirmed_observed', 'confirmed_imputed'];

/** Serialize derived rows to CSV text (stable column order, trailing newline). */
export function serializeDerived(rows) {
  const body = rows.map((r) => [r.scale, r.area, r.date, r.observed, r.imputed].join(','));
  return [DERIVED_COLS.join(','), ...body].join('\n') + '\n';
}
