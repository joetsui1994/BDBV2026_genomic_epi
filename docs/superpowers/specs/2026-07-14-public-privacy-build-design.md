# Public (privacy) build of the dashboard — design

**Date:** 2026-07-14
**Status:** Approved (pending spec review)

## Goal

Produce a second, publicly-shareable version of the Ituri dashboard that lives in
its own **separate repository** and removes two feature areas: the entire
**sequencing-prioritisation** capability and the outbreak map's **non-positive
metrics**. Everything else — phylogeny, map (positives), sample distribution,
data — is carried over.

## Threat model & scope (important)

The stated driver is "keep sensitive data out of the public repo/artifact
entirely," which is why this is a *separate* repo rather than a build flag on the
current one. However, for THIS pass the owner has chosen to **keep all line-list
records and all fields** in the public data (see decisions below). So this pass
is a **feature removal**, not a data-stripping exercise:

- The public data artifact is, for now, the same row-level `linelist_data.dhis.csv`
  as the current app (all statuses, all columns).
- The deeper "no sensitive records at rest" hardening is a **deferred** follow-up.
  The design keeps it cheap to add later: because "positive vs. rest" is already a
  clean filter, a future step can filter the public CSV to positives only without
  touching app code.

### Decisions captured during brainstorming
- Separate repo, **fresh (no shared git history)** — so nothing from the current
  repo's history can leak into the public one.
- Remove **all** sequencing-prioritisation features.
- Remove the outbreak map's **Negative / Invalid / Unclassified** metrics (keep
  Positive + Relative risk).
- Keep sample IDs, Ct, health-area, and exact dates in the data (for now).
- The **CSV upload** flow is removed with prioritisation.
- The **sample-distribution chart** also drops non-positive bars (positives only),
  for consistency with the map.

## Architecture

A copy of the current codebase with the two feature areas excised, published as a
new repo with its own GitHub Pages deploy.

- **New repo:** proposed name `DRC-Ebola-genomic-epi-public` (owner may rename).
  Created empty on GitHub; the stripped working tree is pushed as a single clean
  initial commit (no history carried over).
- **Vite base:** `vite.config.js` sets the Pages subpath. Change it from
  `/DRC-Ebola-genomic-epi/` to `/<new-repo-name>/` so assets resolve on the new
  Pages URL.
- **Deploy:** copy `.github/workflows/deploy.yml` verbatim (it is repo-name
  agnostic — it builds `dist` and publishes Pages).
- **Data & other assets:** `public/data/**` carried over unchanged.

## Removed — sequencing prioritisation (entire feature)

**Delete files:**
- `src/prioritise-panel.js`, `src/prioritise-data.js`, `src/prioritise.js`,
  `src/prio-knobs.js`
- `src/prioritise-data.test.js`, `src/prioritise.test.js`

**`src/main.js`** — remove:
- the `createPrioritisationPanel` import and its instantiation inside the geojson
  `.then` (the `prio` object, `prioPanel`, `map.attachPrioKnobs(prio)`);
- `window.__PRIO_LINELIST__` assignments;
- the `ts.setAllocation(...)` calls in the prio `onChange`;
- the sample-collected toggle's prio hooks (`setPrioRows`, `getPrio`) — it should
  now push only to `map` and `ts`.

**`src/map-panel.js`** — remove:
- `import { buildKnobs, buildSeedControl } from './prio-knobs.js'`;
- the Map/Prioritisation **tab switcher** (`tabPrio`, `prio-body`, the `showTab`
  prioritisation branch, `prioBody()`);
- on-map knobs: `prioKnobsCtl`, `prioRef`, `attachPrioKnobs`, and the knobs
  visibility toggling;
- `toSeqByZone`, `setToSequence`, `applyToSeq`, and the `toSequence` METRIC (+ its
  tooltip branch).

**`src/timeseries-panel.js`** — remove the allocation overlay: the `setAllocation`
method and its `allocation` / `allocOpts` rendering.

**`index.html`** — remove the prioritisation tab (`#tab-prio`) and `#prio-body`
container; the map becomes single-view (no tab bar) unless a tab bar is still
needed for other views (it is not — only Map remained).

## Removed — map non-positive metrics

**`src/map-panel.js`** `METRICS`: keep `risk` and `Positive`; drop `Negative`,
`Invalid`, `Unclassified` (and `toSequence`, already removed above). Update the
metric button group so only "Relative risk" and "Positive samples" are
selectable. `tallyZones` may keep computing all statuses (harmless); only the map
exposure changes.

## Changed — distribution chart positives-only

**`src/timeseries-panel.js`**: reduce the status set to `Positive` only — the
stacked bars, the legend, and the per-day tooltip should show positives (drop
Negative/Invalid/Unclassified). The "Sequences" and "In sequencing" tracks and
the Ct filter are unchanged.

## Kept unchanged

Phylogeny tree + its pipeline (`data:tree`, `hipstr-parse`, `tree-lib`),
the outbreak map (Positive metric, Relative-risk metric, health-area markers,
mobility arrows, Ct-threshold filter, zone search), the sample-collected toggle,
and all `public/data/**` artifacts.

## Sync strategy

The two repos share no history, so future changes to the main dashboard are
ported to the public repo **manually**. Record the feature-removal as a documented
diff/patch in the public repo (e.g. `docs/DIVERGENCE.md`) so re-applying after an
upstream change is mechanical. (Accepted cost of the separate-repo choice.)

## Testing / verification

- Remaining unit tests must pass (the prioritisation test files are deleted; no
  other test imports the removed modules — verify with a grep for
  `prioritise`/`prio-knobs`/`setAllocation`/`__PRIO_LINELIST__`).
- `npm run build` succeeds with no dangling imports.
- Browser check: no Prioritisation tab; the map metric group offers only
  Relative risk + Positive; the distribution chart shows positive bars only; the
  tree and mobility/markers still render.

## Out of scope / non-goals (this pass)

- Stripping non-positive or identifiable records from the public data (deferred;
  design keeps it a one-line filter later).
- Any change to the main (current) repo beyond authoring this spec/plan.
- Automated cross-repo sync.
