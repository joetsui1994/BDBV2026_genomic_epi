// Pure helpers for summarising a BEAST SkyGrid .log into a small Ne trajectory.
// No DOM / filesystem — unit-tested in skygrid-lib.test.js; the IO wrapper is build-skygrid.mjs.

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** Parse a BEAST tab-delimited .log. Returns { header, states } where each state carries
 *  { state, cutOff, logPopSizes: number[] } with logPopSize1..N in numeric order. */
export function parseSkygridLog(text) {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const header = lines[0].split('\t');
  const iState = header.indexOf('state');
  const iCut = header.indexOf('skygrid.cutOff');
  const popCols = header
    .map((h, i) => ({ h, i }))
    .filter((o) => /^skygrid\.logPopSize\d+$/.test(o.h))
    .sort((a, b) => (+a.h.match(/\d+/)[0]) - (+b.h.match(/\d+/)[0]))
    .map((o) => o.i);
  const states = lines.slice(1).map((l) => {
    const c = l.split('\t');
    return { state: +c[iState], cutOff: +c[iCut], logPopSizes: popCols.map((i) => +c[i]) };
  });
  return { header, states };
}

/** Grid times g_k = cutOff*k/gridPoints, k=1..gridPoints (years before the most recent tip). */
export function gridTimes(cutOff, gridPoints) {
  return Array.from({ length: gridPoints }, (_, i) => (cutOff * (i + 1)) / gridPoints);
}

/** Narrowest interval [lo,hi] of already-sorted `sorted` covering `mass` of the samples (HPD). */
export function hpd(sorted, mass = 0.95) {
  const n = sorted.length;
  if (n === 0) return [NaN, NaN];
  if (n === 1) return [sorted[0], sorted[0]];
  const w = Math.max(1, Math.floor(mass * n));
  let best = [sorted[0], sorted[w - 1]], bestW = Infinity;
  for (let i = 0; i + w - 1 < n; i++) {
    const width = sorted[i + w - 1] - sorted[i];
    if (width < bestW) { bestW = width; best = [sorted[i], sorted[i + w - 1]]; }
  }
  return best;
}

const median = (sorted) => {
  const n = sorted.length, m = n >> 1;
  return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

/** Summarise post-burn-in states into gridPoints+1 Ne points for a smooth median line at times
 *  [0, g_1, ..., g_gridPoints]; point i uses segment i (logPopSize_i). 95% HPD on logPopSize,
 *  exp'd (log-space band). Returns { keptStates, points } ordered present -> past. */
export function summariseSkygrid(states, { cutOff, gridPoints, mostRecentDate, burninFraction = 0.10 }) {
  const maxState = Math.max(...states.map((s) => s.state));
  const kept = states.filter((s) => s.state >= burninFraction * maxState);
  const nSeg = gridPoints + 1;
  const times = [0, ...gridTimes(cutOff, gridPoints)];   // length nSeg
  const mrd = +new Date(mostRecentDate);
  const points = [];
  for (let i = 0; i < nSeg; i++) {
    const logs = kept.map((s) => s.logPopSizes[i]).sort((a, b) => a - b);
    const ne = kept.map((s) => Math.exp(s.logPopSizes[i])).sort((a, b) => a - b);
    const [lLo, lHi] = hpd(logs, 0.95);
    const tBP = times[i];
    points.push({
      tBP,
      date: new Date(mrd - tBP * YEAR_MS).toISOString().slice(0, 10),
      neMedian: median(ne),
      neLower: Math.exp(lLo),
      neUpper: Math.exp(lHi),
    });
  }
  return { keptStates: kept.length, points };
}
