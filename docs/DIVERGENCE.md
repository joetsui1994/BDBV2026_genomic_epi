# Divergence from the private repo

This repository is a **public (privacy) build** derived from the private
`ituri-dashboard` / `DRC-Ebola-genomic-epi` repo. It was created by copying the
working tree, dropping git history, and re-initialising. The sections below record
everything that differs, so changes can be **manually synced** from the private
repo without re-introducing the removed features. When pulling a change across,
skip anything that touches the areas described here.

## Deleted modules (sequencing prioritisation)

The entire sequencing-prioritisation feature is gone. These six files were deleted
and must never be copied back: `src/prioritise-panel.js` (the panel UI + the
line-list **upload** control), `src/prioritise-data.js`, `src/prioritise.js`,
`src/prio-knobs.js`, and their tests `src/prioritise-data.test.js` /
`src/prioritise.test.js`. All call-sites were unwired in `src/main.js`
(the `createPrioritisationPanel` wiring, the `window.__PRIO_LINELIST__` seed, and
the `prioPanel`/`setPrioRows`/`getPrio` plumbing through `applySampleView` in
`src/sample-toggle.js`) and in `src/map-panel.js` (the `prio-knobs` import,
`setPrio`/`attachPrioKnobs`, `setToSequence`, `applyToSeq`, and `prioBody`).

## Trimmed map metrics (risk + Positive only)

The health-zone choropleth in `src/map-panel.js` now exposes only **Off / Relative
risk / Positive**. The `METRICS` table and the metric button group were reduced to
`off`, `risk`, `Positive`; the removed metrics are `Negative`, `Invalid`,
`Unclassified`, `total`, `toSequence` (Seq+), and `inProgress` (Being-sequenced).
`total` was removed deliberately because it leaks non-positive counts via
`total − Positive`; `toSequence`/`inProgress` are sequencing-workflow. The
`STATUS_RAMP`/`countsOf`/`ZERO` data tables still carry all-status keys but they are
inert — never rendered as a selectable metric.

## Positives-only sample distribution

In `src/timeseries-panel.js` the module-level `STATUS` array was reduced from
`['Positive', 'Negative', 'Invalid', 'Unclassified']` to `['Positive']`. This
cascades to the bars, legend, tooltip, the "not shown" undated breakdown, and the
CSV export (the non-positive columns drop and CSV `total` becomes the positive
count). Separately, the brushed-window **"test positivity" readout**
(`positives / (positives + negatives)`) in `updateWindowSummary` was removed
explicitly, since it read Negative counts directly and would not have been affected
by the `STATUS` change. The retained positive count still feeds the
"% of positives sequenced" line. The to-sequence allocation code (`setAllocation`
and its `if (allocation)` blocks) is left in place but is permanently inert —
nothing calls `setAllocation` any more.

## Removed prioritisation tab / upload UI

`index.html` no longer has the tabbed map header. The
`<button id="tab-map">` / `<button id="tab-prio">` switcher and the
`<div id="prio-body">` panel were replaced by a single static
`<span class="map-title">Outbreak map</span>` header with the `map-body` view only.
The file-upload UI lived inside `prioritise-panel.js`, so deleting that module
(above) removed it. Corresponding CSS was removed from `src/style.css`: the
`.map-tab` / `#tab-prio` tab styles, the entire `#prio-body` block, the `.ps-*`
allocation-heatmap styles, the `.prio-*` upload styles, and the `.pk-*` /
`.prio-knobs` knob styles, replaced by a single `.map-title` rule.

## Vite base path

`vite.config.js` sets the production `base` to `/DRC-Ebola-genomic-epi-public/`
(was `/DRC-Ebola-genomic-epi/`) so the site serves from this repo's GitHub Pages
subpath. Never sync this line back to the private value.

## Not done (deferred)

Data-level stripping of non-positive / identifiable records is **not** performed
here — the app still loads the same line-list and filters at render time. If the
underlying data must be sanitised, that remains a separate one-line filter to add
at the data-loading step.
