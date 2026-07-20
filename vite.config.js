import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { filterCsvToPositives } from './scripts/linelist-lib.mjs';

// Build-time privacy backstop: filter every line-list CSV in the build output to positive cases
// only, so a forgotten `npm run data:linelist` can never publish non-positive individual records
// to the deployed /data/ endpoint. Runs after the public/ dir is copied to the output.
function positivesOnlyLineLists() {
  let outDir = 'dist';
  return {
    name: 'positives-only-line-lists',
    apply: 'build',
    configResolved(cfg) { outDir = cfg.build.outDir; },
    closeBundle() {
      const dataDir = join(outDir, 'data');
      if (!existsSync(dataDir)) return;
      for (const f of readdirSync(dataDir)) {
        if (!/^linelist_data.*\.csv$/.test(f)) continue;
        const p = join(dataDir, f);
        const before = readFileSync(p, 'utf8');
        const after = filterCsvToPositives(before);
        if (after !== before) {
          writeFileSync(p, after);
          this.warn(`positives-only backstop filtered ${f}`);
        }
      }
    },
  };
}

// "Last updated" = the most recent commit touching public/data (falls back to the
// build time if git history isn't available). Injected as __LAST_UPDATED__ at build
// time, so it refreshes automatically whenever the data changes and is redeployed.
// (CI must check out full history — see fetch-depth in the deploy workflow.)
function dataLastUpdated() {
  try {
    const iso = execSync('git log -1 --format=%cI -- public/data', { encoding: 'utf8' }).trim();
    if (iso) return iso;
  } catch { /* no git / no history → fall through */ }
  return new Date().toISOString();
}

// Served from a project subpath on GitHub Pages (…/DRC-Ebola-genomic-epi/), but
// from root in local dev. `base` feeds import.meta.env.BASE_URL, which prefixes
// the runtime data fetches and the peartree bundle so they resolve under the subpath.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/BDBV2026_genomic_epi/' : '/',
  define: { __LAST_UPDATED__: JSON.stringify(dataLastUpdated()) },
  build: { target: 'esnext' },
  plugins: [positivesOnlyLineLists()],
  test: { environment: 'node' },
}));
