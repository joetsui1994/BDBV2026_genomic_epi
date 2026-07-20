// Filter the committed public/data line lists to positive cases only (in place). Run after
// refreshing the line-list data so no non-positive individual records are committed / published.
// The Vite build (vite.config.js) applies the same filter to the deployed copy as a backstop.
// Usage: node scripts/filter-linelist.mjs   (or `npm run data:linelist`)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { filterCsvToPositives } from './linelist-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The runtime line-list sources (see src/linelist-source.js).
const FILES = ['linelist_data.csv', 'linelist_data.dhis.csv'];

for (const name of FILES) {
  const path = join(ROOT, 'public/data', name);
  const before = readFileSync(path, 'utf8');
  const after = filterCsvToPositives(before);
  const rows = (t) => t.trim().split(/\r?\n/).length - 1;
  writeFileSync(path, after);
  console.log(`${name}: ${rows(before)} -> ${rows(after)} rows (positives only)`);
}
console.log('✓ Line lists filtered to positive cases');
