// scripts/build-status.mjs
// Build public/data/status_confirmed.csv from the private repo's latest status_aggregated.csv.
// Reads outputs/manifest.json to find the newest dated CSV, filters to confirmed cases (observed/
// imputed split via status-lib), and canonicalises health-zone names onto the geojson Nom via
// aliases.csv. If any health zone doesn't match a geojson Nom it FAILS (exit 1) WITHOUT writing —
// so the CI sync never ships data with a silently-missing zone; add the alias to aliases.csv and
// re-run. In GitHub Actions the failure is emitted as a ::error:: annotation.
// Usage: node scripts/build-status.mjs [SOURCE_REPO_DIR]   (or `npm run data:status`)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildDerivedRows, serializeDerived } from './status-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || process.env.STATUS_SRC || join(ROOT, '..', 'BDBV2026-Processed_Sensitive_Data');

// aliases.csv: observed_name,canonical_nom,... → canonicaliser (matches src/main.js makeCanon).
function makeCanon(text) {
  const map = new Map();
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [observed, canonical] = line.split(',');
    if (observed && canonical) map.set(observed.toUpperCase().trim(), canonical.trim());
  }
  return (name) => map.get((name || '').toUpperCase().trim()) || name;
}

const manifest = JSON.parse(readFileSync(join(SRC, 'outputs', 'manifest.json'), 'utf8'));
const rawPath = join(SRC, 'outputs', manifest.source_csv);
const raw = readFileSync(rawPath, 'utf8');

const canon = makeCanon(readFileSync(join(ROOT, 'public/data/aliases.csv'), 'utf8'));
const geo = JSON.parse(readFileSync(join(ROOT, 'public/data/health-zones.geojson'), 'utf8'));
const nomSet = new Set(geo.features.map((f) => (f.properties.Nom || '').toUpperCase().trim()));

const rows = buildDerivedRows(raw);
const unmatched = new Set();
for (const r of rows) {
  if (r.scale !== 'healthzone') continue;
  r.area = canon(r.area);
  if (!nomSet.has(r.area.toUpperCase().trim())) unmatched.add(r.area);
}

// Unmatched zones would silently vanish from the map — fail loudly and write nothing so the run
// (and the CI sync) stops until an alias is added. GitHub Actions renders ::error:: as an annotation.
if (unmatched.size) {
  const list = [...unmatched].sort().join(', ');
  const msg = `${unmatched.size} health zone(s) not matched to a geojson Nom — add to public/data/aliases.csv: ${list}`;
  console.error(process.env.GITHUB_ACTIONS ? `::error::${msg}` : `✗ ${msg}`);
  process.exit(1);
}

writeFileSync(join(ROOT, 'public/data/status_confirmed.csv'), serializeDerived(rows));
console.log(`✓ status_confirmed.csv: ${rows.length} rows from ${manifest.source_csv}`);
