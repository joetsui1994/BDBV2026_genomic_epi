// Read the BEAST SkyGrid .log from data-raw/, summarise it (median + 95% log-space HPD per grid
// point), and write public/data/skygrid.json for the Effective population size panel.
// Usage:
//   node scripts/build-skygrid.mjs               # 10% burn-in (default)
//   node scripts/build-skygrid.mjs --burnin=0.2
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSkygridLog, summariseSkygrid } from './skygrid-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data-raw', 'Ituri2026.DRC_trimmed_n134_GTR_SG.log');
const META = join(ROOT, 'public/data/ituri-meta.json');
const OUT = join(ROOT, 'public/data/skygrid.json');

const burninArg = process.argv.find((a) => a.startsWith('--burnin='));
const burninFraction = burninArg ? parseFloat(burninArg.slice(9)) : 0.10;
if (!Number.isFinite(burninFraction) || burninFraction < 0 || burninFraction >= 1) {
  throw new Error(`--burnin must be a fraction in [0,1) (got "${burninArg ? burninArg.slice(9) : ''}")`);
}

const { states } = parseSkygridLog(readFileSync(RAW, 'utf8'));
const meta = JSON.parse(readFileSync(META, 'utf8'));
const cutOff = states[0].cutOff;
const gridPoints = states[0].logPopSizes.length - 1;
const { keptStates, points } = summariseSkygrid(states, {
  cutOff, gridPoints, mostRecentDate: meta.mostRecentDate, burninFraction,
});

const out = {
  mostRecentDate: meta.mostRecentDate,
  rootDate: meta.rootDate,
  cutOffYears: cutOff,
  gridPoints,
  burninFraction,
  states: keptStates,
  points,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`SkyGrid: ${states.length} states -> ${keptStates} kept (burn-in ${burninFraction}), ${points.length} points, cutOff ${cutOff.toFixed(4)}y`);
console.log(`✓ Wrote ${OUT}`);
