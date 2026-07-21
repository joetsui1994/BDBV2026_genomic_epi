# Migrate histogram + map to the aggregated status data source — design

**Date:** 2026-07-21
**Repo:** `DRC-Ebola-genomic-epi-public` (remote `joetsui1994/BDBV2026_genomic_epi`, public GitHub Pages)
**Status:** Draft (pending spec review)

## Goal

Replace the dashboard's row-level DHIS line list with a **pre-aggregated** daily
case-count dataset as the source for the two epi components — the sample-distribution
histogram and the outbreak map. The aggregate comes from the private repo
`INRB-UMIE/BDBV2026-Processed_Sensitive_Data` (`outputs/<DATE>/status_aggregated.csv`).
We do **not** publish that CSV; we publish a **minimal derived artifact** carrying only
what the plots need.

The genomic surfaces (phylogeny tree, effective-population-size panel, mobility arrows,
relative-risk choropleth, health-area markers) are unaffected — they come from other
sources and are untouched.

## Context: current data flow (before)

`public/data/linelist_data.dhis.csv` (row-level, positives-only, produced by
`npm run data:linelist` → `scripts/filter-linelist.mjs` + `linelist-lib.mjs`) is parsed
by `parseLinelist` in `src/main.js` into per-record rows, which feed:

- `tallyZones` (`src/zone-tally.js`) → per-zone status counts + positive-Ct lists → map
  choropleth (`src/map-panel.js`).
- `createTimeseriesPanel` (`src/timeseries-panel.js`) → daily stacked bars (already reduced
  to the single `Positive` series in the public build) + a Ct filter + a zone⇄area tip
  selection filter.

The public build already removed prioritisation, the lab/DHIS version selector, and the
sample-collected toggle. What remains to change is the **data shape** and the **Ct** wiring.

## Why this is a shape change, not a file swap

`status_aggregated.csv` is fundamentally different from the line list:

- **Pre-aggregated daily counts**, not per-record rows. Columns: `country`,
  `date_of_symptom_onset_imputed`, `onset_date_was_imputed` (TRUE/FALSE), `blank`,
  `not_a_case`, `confirmed_case`, `suspected_case`, `probable_case`, `spatial_scale`
  (`national`/`province`/`healthzone`), `province`, `health_zone`.
- **No Ct, no sample IDs, no health-area** — so the map's Ct-threshold filter and any
  per-sample readout have no data behind them.
- **Case classification**, not lab status — "Positive" becomes `confirmed_case`.
- **National coverage** — 8 provinces with cases (Ituri, Nord-Kivu, Sud-Kivu, Haut-Uele,
  Kasai, Kinshasa, Tshopo, Tshuapa); onset dates 2026-04-10 → 2026-07-19.

The map geojson (`health-zones.geojson`) and risk metadata are already **national**
(519 health zones, all 26 provinces), so national scope needs no new map assets.

## Decisions captured during brainstorming

- **Geographic scope:** national / all provinces (map covers all affected zones;
  histogram defaults to national counts).
- **Case classification shown:** **confirmed cases only** (drop suspected/probable/
  not-a-case/blank at the transform boundary).
- **Histogram interactivity:** national by default, filterable to a health zone (map
  click / tree tip) or province (selector) — requires daily per-scale counts, which the
  derived artifact carries.
- **Ct:** remove **all** Ct-related code (no Ct in the aggregate).
- **Imputation flag:** **keep** it in the derived data (split observed vs imputed) to
  support a deferred imputed-onset toggle feature. Not surfaced yet — bars plot the sum.
- **"Reporting likely incomplete" recent-days shading:** not included this pass (plain bars).
- **Publication:** publish only the minimal derived artifact, never the raw CSV.
- **Automation:** swap first; the scheduled auto-pull GitHub Action is a separate later spec.

## Derived data artifact

New transform script `scripts/build-status.mjs` (+ `npm run data:status`) reads the private
repo's `outputs/manifest.json` → latest-date `status_aggregated.csv` and emits
`public/data/status_confirmed.csv`:

| column | values |
|---|---|
| `scale` | `national` \| `province` \| `healthzone` |
| `area` | `""` for national · province name · health-zone name |
| `date` | onset date (`date_of_symptom_onset_imputed`) |
| `confirmed_observed` | `confirmed_case` count where `onset_date_was_imputed == FALSE` |
| `confirmed_imputed` | `confirmed_case` count where `onset_date_was_imputed == TRUE` |

Rules:

- Keep only rows contributing `confirmed_case > 0`; drop `blank/not_a_case/suspected/
  probable`, `country`. A `(scale, area, date)` key merges the FALSE/TRUE rows into the
  two count columns.
- **Zone-name canonicalisation:** map `health_zone` onto geojson `Nom` using the existing
  `public/data/aliases.csv`. The script **logs every unmatched zone** — this is the main
  integration risk at national scale (DHIS names vs shapefile `Nom`), and unmatched zones
  would silently vanish from the map.
- **Source path** is a configurable CLI arg/env (default: the sibling private checkout
  `../BDBV2026-Processed_Sensitive_Data`), so the deferred CI job can point it at a fresh
  checkout without code changes.

Retire `linelist_data.dhis.csv` / `linelist_data.legacy*.csv`, `npm run data:linelist`
(`filter-linelist.mjs`), and the Vite positives-filter backstop in `vite.config.js`.

## Component rewire — Approach A: aggregate-native (chosen)

Replace `parseLinelist` with `parseStatus`, producing per-scale daily-count lookups instead
of per-record rows. Refactor the two components to consume **counts**:

**`src/timeseries-panel.js` (histogram):**
- Bars = confirmed cases (`confirmed_observed + confirmed_imputed`) by onset date.
- Defaults to the `national` series. New `setArea(scale, area)` swaps the plotted series
  when a zone (map click / tree tip) or province (selector) is chosen.
- Keeps: tree x-axis lock, the brush (drives the shared time window), the tree-tip
  "sequences available" overlay, the "look beyond" extent behaviour.
- Removes: the Ct `<input>`/readout, `ctThreshold`, `ctPass`, `setCtThreshold`, `onCtChange`,
  and the `ct` param of `extentFraction`; the zone⇄area toggle's **area** branch (aggregate
  is zone-level — tree tips still carry area for markers).

**`src/zone-tally.js` + `src/map-panel.js` (map):**
- `tallyZones` becomes an aggregate roll-up: per-zone `confirmed` total (sum of both count
  columns across `healthzone`-scale rows), plus a windowed variant for the brush
  (`setDateWindow` re-sums within `[d0, d1]`).
- Map metric `Positive` → **"Confirmed cases"**; keep **"Relative risk"**. Remove the
  map-header Ct filter, `ctThreshold`, `zonePosCt`, `applyCtThreshold`, and the
  `onCtChange`⇄`setCtThreshold` sync.
- Unchanged: mobility arrows, health-area markers, zone search/selection, risk choropleth.

**`src/main.js`:** swap `parseLinelist`→`parseStatus`; fetch `status_confirmed.csv` instead
of the line list; drop the Ct sync wiring; wire map-zone / province-selector / tree-tip
selection to `ts.setArea(...)`.

### Alternative considered — Approach B: synthetic rows (rejected)

Expand the aggregate into one synthetic `{date, health_zone, status:'Positive'}` row per
confirmed case so the components stay row-based. Least code churn, but it fabricates records
(a day with 12 confirmed → 12 fake rows), is semantically misleading, and still requires
removing the Ct UI. Approach A is cleaner and smaller at runtime, and the components are
already single-series, so the refactor is contained.

## Kept unchanged

Phylogeny tree + pipeline, Ne panel (SkyGrid/exponential), mobility arrows, relative-risk
choropleth, health-area markers, zone search/selection, the shared brush→all-panels time
window, and the "last updated" header (still derived from the latest `public/data` commit).

## Testing / verification

- Unit tests: transform (confirmed-only filter, zero-drop, FALSE/TRUE merge into the two
  count columns, zone canonicalisation, unmatched-zone logging); `zone-tally` roll-up
  (totals + window); histogram `setArea` series selection.
- Remove `ctPass` tests and any Ct-dependent assertions.
- `npm run build` succeeds with no dangling imports (grep for `ct`, `zonePosCt`, `setCtThreshold`,
  `filter-linelist`, `linelist_data`).
- Browser check: national epi curve renders; clicking a zone / choosing a province filters
  the histogram; choropleth offers "Confirmed cases" + "Relative risk"; no Ct inputs; tree,
  Ne panel, mobility, and markers still render.

## Deferred (each its own spec)

1. **Scheduled auto-pull GitHub Action** — pull the latest `status_aggregated.csv` from the
   private repo (auth via a repo secret), run `npm run data:status`, commit the refreshed
   `status_confirmed.csv`, and let Pages redeploy on a cron + `workflow_dispatch`.
2. **Imputed-onset toggle** — surface `confirmed_imputed` as a switchable stacked segment on
   top of `confirmed_observed` in the histogram. The derived artifact already carries the
   split, so this is a UI-only change.

## Out of scope (this pass)

- Suspected/probable/non-case classifications, health-area granularity, Ct, per-sample data.
- The two deferred features above.
- Any change to `ituri-dashboard` (the internal full-featured repo).
