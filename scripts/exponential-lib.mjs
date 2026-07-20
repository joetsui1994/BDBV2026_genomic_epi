// Pure helpers for summarising a BEAST exponential-growth-coalescent .log into an Ne trajectory.
// No DOM / filesystem — unit-tested in exponential-lib.test.js; the IO wrapper is build-exponential.mjs.
import { hpd } from './skygrid-lib.mjs';

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** Parse a BEAST tab-delimited .log. Returns { header, states } with each state's
 *  { state, popSize, growthRate } (exponential.popSize N0, exponential.growthRate r). */
export function parseExponentialLog(text) {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const header = lines[0].split('\t');
  const iState = header.indexOf('state');
  const iPop = header.indexOf('exponential.popSize');
  const iRate = header.indexOf('exponential.growthRate');
  const states = lines.slice(1).map((l) => {
    const c = l.split('\t');
    return { state: +c[iState], popSize: +c[iPop], growthRate: +c[iRate] };
  });
  return { header, states };
}

/** Exponential-growth Ne at time `tBP` years before the most recent tip: N0·exp(-r·t). */
export function neOfExponential(popSize, growthRate, tBP) {
  return popSize * Math.exp(-growthRate * tBP);
}

const median = (sorted) => {
  const n = sorted.length, m = n >> 1;
  return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

/** Summarise the exponential-growth posterior into `steps`+1 Ne points over [0, maxYearsBP]
 *  (present -> past). median + 95% HPD (log-space), matching the SkyGrid output shape. */
export function summariseExponential(states, { maxYearsBP, steps = 60, mostRecentDate, burninFraction = 0.10 }) {
  const maxState = Math.max(...states.map((s) => s.state));
  const kept = states.filter((s) => s.state >= burninFraction * maxState);
  const mrd = +new Date(mostRecentDate);
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const tBP = (maxYearsBP * i) / steps;
    const ne = kept.map((s) => neOfExponential(s.popSize, s.growthRate, tBP)).sort((a, b) => a - b);
    const logs = ne.map((v) => Math.log(v)).sort((a, b) => a - b);
    const [lLo, lHi] = hpd(logs, 0.95);
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
