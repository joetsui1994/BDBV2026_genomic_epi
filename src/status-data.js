// src/status-data.js
// Parse the derived status_confirmed.csv (scale,area,date,confirmed_observed,confirmed_imputed)
// into per-scale, date-keyed count lookups for the histogram + map. Zone `area` is already the
// canonical geojson Nom (canonicalised in scripts/build-status.mjs).

const up = (s) => (s || '').toUpperCase().trim();

/** @returns {{ national: Map, provinces: Map<string,Map>, zones: Map<string,Map> }}
 *  Provinces are keyed by ORIGINAL-case name (drives the selector display); zones by UPPER Nom
 *  (must match the geojson `Nom` for the choropleth join). */
export function parseStatus(text) {
  const national = new Map();
  const provinces = new Map();
  const zones = new Map();
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const [scale, area, date, obs, imp] = lines[i].split(',');
    const cell = { observed: Number(obs) || 0, imputed: Number(imp) || 0 };
    if (scale === 'national') {
      national.set(date, cell);
    } else {
      const bag = scale === 'province' ? provinces : zones;
      const key = scale === 'province' ? area : up(area);   // province: original case · zone: UPPER Nom
      if (!bag.has(key)) bag.set(key, new Map());
      bag.get(key).set(date, cell);
    }
  }
  return { national, provinces, zones };
}

/** Collapse a date→{observed,imputed} map to date→total (observed+imputed). */
export function seriesTotal(dailyCounts) {
  const m = new Map();
  if (dailyCounts) for (const [d, c] of dailyCounts) m.set(d, c.observed + c.imputed);
  return m;
}

/** zones map → Map<UPPER Nom, Map<date, total>> for the choropleth roll-up. */
export function toZoneDaily(zones) {
  const out = new Map();
  for (const [nom, dc] of zones) out.set(nom, seriesTotal(dc));
  return out;
}
