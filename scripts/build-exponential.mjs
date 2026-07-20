// Read the BEAST exponential-growth .log from data-raw/, summarise it (median + 95% log-space
// HPD Ne over time), and write public/data/exponential.json for the Effective population size
// panel. Evaluated over the SAME extent as the SkyGrid (public/data/skygrid.json's cutOffYears)
// so the two curves overlay.
// Usage:
//   node scripts/build-exponential.mjs               # 10% burn-in (default)
//   node scripts/build-exponential.mjs --burnin=0.2
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseExponentialLog, summariseExponential } from './exponential-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data-raw', 'Ituri2026.DRC_trimmed_n134_GTR_EGC.log');
const META = join(ROOT, 'public/data/ituri-meta.json');
const SKYGRID = join(ROOT, 'public/data/skygrid.json');
const OUT = join(ROOT, 'public/data/exponential.json');
const STEPS = 60;

const burninArg = process.argv.find((a) => a.startsWith('--burnin='));
const burninFraction = burninArg ? parseFloat(burninArg.slice(9)) : 0.10;
if (!Number.isFinite(burninFraction) || burninFraction < 0 || burninFraction >= 1) {
  throw new Error(`--burnin must be a fraction in [0,1) (got "${burninArg ? burninArg.slice(9) : ''}")`);
}

const { states } = parseExponentialLog(readFileSync(RAW, 'utf8'));
const meta = JSON.parse(readFileSync(META, 'utf8'));
const skygrid = JSON.parse(readFileSync(SKYGRID, 'utf8'));
const maxYearsBP = skygrid.cutOffYears;   // share the SkyGrid's full extent so the curves overlay
const { keptStates, points } = summariseExponential(states, {
  maxYearsBP, steps: STEPS, mostRecentDate: meta.mostRecentDate, burninFraction,
});

const out = {
  model: 'exponential',
  mostRecentDate: meta.mostRecentDate,
  rootDate: meta.rootDate,
  cutOffYears: maxYearsBP,
  steps: STEPS,
  burninFraction,
  states: keptStates,
  points,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`Exponential: ${states.length} states -> ${keptStates} kept (burn-in ${burninFraction}), ${points.length} points over ${maxYearsBP.toFixed(4)}y`);
console.log(`✓ Wrote ${OUT}`);
