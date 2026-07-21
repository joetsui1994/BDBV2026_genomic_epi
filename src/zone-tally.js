// src/zone-tally.js
// Roll a per-zone daily confirmed-count structure into per-zone totals for the choropleth,
// optionally restricted to a time window. Pure (no DOM); shared by the initial render and the
// brush's windowed recompute. Keys are UPPER-cased canonical Nom.

/**
 * @param {Map<string, Map<string, number>>} zoneDaily  UPPER Nom → (dateStr → confirmed total)
 * @param {{d0:number,d1:number}|null} window  inclusive ms bounds, or null for all dates
 * @returns {{ zoneCounts: Map<string, {confirmed:number, total:number}> }}
 */
export function tallyZones(zoneDaily, window = null) {
  const zoneCounts = new Map();
  for (const [nom, daily] of zoneDaily) {
    let confirmed = 0;
    for (const [ds, n] of daily) {
      if (window) {
        const t = +new Date(ds);
        if (isNaN(t) || t < window.d0 || t > window.d1) continue;
      }
      confirmed += n;
    }
    if (confirmed > 0) zoneCounts.set(nom, { confirmed, total: confirmed });
  }
  return { zoneCounts };
}
