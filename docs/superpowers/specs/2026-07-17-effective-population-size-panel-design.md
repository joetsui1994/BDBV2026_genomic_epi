# Effective population size (SkyGrid) panel — design spec

**Goal:** Add a third left-column panel, **"Effective population size"**, directly below the
Phylogeny panel. It visualises the inferred effective population size (Ne) over time from a
BEAST SkyGrid run of the *same* analysis as the tree in the Phylogeny panel — a median line with
a shaded 95% credible band, on a log-scale y-axis and a calendar x-axis aligned to the tree's
time window, styled consistently with the rest of the dashboard.

**Tech stack:** Vanilla JS (ES modules), Vite, Vitest, SVG (same approach as the existing
`timeseries-panel.js` / `map-panel.js`). Offline data processing follows the existing
`scripts/*.mjs` → `public/data/*.json` pattern.

---

## 1. Source data (established by inspection)

Raw log: `Ituri2026.DRC_trimmed_n134_GTR_SG.log` (BEAST v10.6, `keywords: skygrid`).

- Tab-delimited; 4 comment lines, then a header row, then **10,001 sampled states** (state 0 →
  50,000,000, step 5,000).
- **23 `skygrid.logPopSize1…23`** columns (cols 9–31) → 22 grid points, 23 piecewise-constant Ne
  segments.
- **`skygrid.cutOff`** logged (col 32), constant `0.460273973` years — the oldest (finite) grid
  time, i.e. the SkyGrid spans ~0.46 yr (~168 days) before the most recent tip.
- Height units are **years**. The tree metadata (`public/data/ituri-meta.json`) gives
  `mostRecentDate = 2026-06-23`, `rootDate = 2026-03-14`, and confirms the same source analysis
  (`Ituri2026.DRC_trimmed_n134_GTR_SG.HIPSTR.tree`).

**Grid geometry.** With 22 grid points and cutOff `T`, grid times are `g_k = T·k/22` (k = 1…22,
~7.6 days apart). Segment `i` (`logPopSize_i`) is constant over:
`seg 1 = [0, g_1]`, `seg i = [g_{i-1}, g_i]` (i = 2…22), `seg 23 = [g_22, ∞)`.

**Data reality (drives design):** Ne rises toward the present (growing outbreak). Grid points
older than the tree root (~2026-03-14) have essentially no coalescent data — the median flattens
at the smoothing-prior mean (~0.026) and the band widens by many orders of magnitude. This
prior-dominated tail is why the default view is clipped to the tree window (§4) and the y-axis is
fixed during the reveal (§5).

---

## 2. Data processing — `scripts/build-skygrid.mjs` (+ `scripts/skygrid-lib.mjs`)

Raw input copied to `data-raw/Ituri2026.DRC_trimmed_n134_GTR_SG.log` (matches `data-raw/` convention).

Pure, unit-tested helpers live in `scripts/skygrid-lib.mjs` (mirrors `tree-lib.mjs` + its test):

- `parseSkygridLog(text)` → `{ header, states: [{state, cutOff, logPopSizes: number[] }] }`.
- `gridTimes(cutOff, gridPoints)` → `number[]` of `g_k = cutOff·k/gridPoints`.
- `hpd(sortedValues, mass = 0.95)` → `[lo, hi]` narrowest interval covering `mass` (computed on
  `logPopSize`; the caller exponentiates the bounds → log-space HPD on Ne).
- `summariseSkygrid(states, cutOff, gridPoints, { burninFraction = 0.10 })` → array of 23 points.

Each of the 23 points is placed for a **smooth median line** at times
`t = [0, g_1, …, g_22]` (years before most recent tip), value = segment `i`:

```
point_i = {
  tBP:      t_i,                              // years before mostRecentDate
  date:     mostRecentDate − t_i years (ISO), // calendar date
  neMedian: median(exp(logPopSize_i)),
  neLower:  exp(hpd_lo(logPopSize_i)),        // 95% HPD, log-space
  neUpper:  exp(hpd_hi(logPopSize_i)),
}
```

`build-skygrid.mjs` reads the log + `ituri-meta.json` (for `mostRecentDate`), drops the first
`burninFraction` of states, and writes the JSON below. Burn-in is **configurable** via a
`--burnin=<fraction>` CLI flag (parsed like `build-tree.mjs`'s `--date=`), **defaulting to `0.10`**
(→ 9,001 of 10,001 states kept); values are clamped to `[0, 1)`. The chosen fraction is recorded in
the output as `burninFraction`.

```json
// public/data/skygrid.json
{
  "mostRecentDate": "2026-06-23",
  "rootDate": "2026-03-14",
  "cutOffYears": 0.460274,
  "gridPoints": 22,
  "burninFraction": 0.1,
  "states": 9001,
  "points": [ { "date": "2026-06-23", "tBP": 0, "neMedian": …, "neLower": …, "neUpper": … }, … ]  // 23, present→past
}
```

Added npm script: `"data:skygrid": "node scripts/build-skygrid.mjs"`. The file is small (~23 rows);
nothing heavy ships to the browser.

---

## 3. Panel component — `src/ne-panel.js`

Factory `createNePanel(containerId, skygrid, domain, opts)`, same shape as the other panels
(`domain = { minDate: rootDate, maxDate: mostRecentDate }`). Renders one SVG per layout pass.

- **Y-axis: log10(Ne)**, power-of-10 gridlines/ticks (10, 100, … and sub-decade as needed), like
  the reference figure. The y-domain is computed **once** from the HPD ribbon (`neLower…neUpper`)
  over the **default tree window** (with a small log margin) so the band is fully visible there,
  and is then **held fixed** while the x-window changes (§5) — so the reveal never rescales the
  plot; the wider prior-dominated old-end band simply clips at the axis edges.
- **X-axis: calendar dates.** Default domain = the tree window (`rootDate → mostRecentDate`).
- **Marks:** a shaded **HPD ribbon** (`neLower`…`neUpper`) and the **median line** on top, both
  built from the 23 points; smooth polyline through the points (not stepped).
- **Hover tooltip** on the plot: nearest grid point → date + median + 95% HPD.
- Re-renders via a `ResizeObserver` on its container (same pattern as `timeseries-panel.js`).

**Testable pure helpers** (either exported from `ne-panel.js` or a small `src/log-scale.js`):
log-tick generation for a `[min,max]` Ne range, and date↔x / Ne↔y mappers. Unit-tested in Vitest
(node env); DOM rendering verified in the running app.

**X-axis coupling (decided): standalone calendar axis.** The panel owns its x-scale from
`domain` (root→present); it does **not** subscribe to the tree's live view transform. It therefore
aligns with the tree's default/full view and the Sample-distribution panel's default view, and the
reveal (§5) is a self-contained x-domain change. (Locking to the live tree transform is a possible
future enhancement, explicitly out of scope here.)

---

## 4 & 5. Interaction — hover-to-reveal full extent

Default x-domain is the tree window. A **dedicated header control** (a small affordance, e.g.
`⤢ full extent`, styled like the other header buttons) drives the reveal — the plot area is left
free for the curve's hover tooltip.

- **On pointer-enter / focus of the control:** ease the x-domain out from the tree window to the
  **full SkyGrid extent** (`mostRecentDate − cutOff … mostRecentDate`, ~2026-01-05 → present),
  revealing the older, prior-dominated tail.
- **On pointer-leave / blur:** ease the x-domain back to the tree window.
- No timer — the expanded view persists exactly while hovered/focused.
- The transition is a short eased `requestAnimationFrame` tween of the x-domain endpoints
  (~200–300 ms). The **y-axis stays fixed** (§3), so the widening old-end band simply clips at the
  axis edges rather than rescaling the plot.

---

## 6. Layout — three-pane left column

`index.html` `#left` becomes: `#tree` · `#gutter-h` · **`#ne`** · **`#gutter-h2`** · `#timeseries`.
The new panel header carries the title "Effective population size", the collapse chevron, and the
`⤢ full extent` control.

Two infra changes:

- **Collapse controller (`panel-collapse.js`).** `makeCollapsibleColumn` already takes an array of
  panels; add the third. `collapseGroupState` is extended so it also returns **per-gutter** lock
  state — gutter `j` (between panes `j` and `j+1`) is disabled when *either* neighbour is collapsed
  — and the controller is passed the array of gutters. The "≥1 panel stays expanded" rule (disable
  the sole expanded panel's button) already generalises to N. Its unit test is extended for the
  3-pane cases.
- **Splitter (`splitter.js`).** The current `makeSplitter` handles a strict 2-pane column only.
  Generalise vertical resizing to **adjacent-pair** resizing: dragging a gutter resizes only its
  two neighbouring panes (their combined height held constant, other panes untouched), honouring
  per-pane min-heights. Provide a `makeColumnSplitters(panes, gutters, axis, minSizes)` (or
  equivalent) that wires each gutter to its adjacent pair. The horizontal `#gutter-v`
  (left-column ↔ map) is unchanged.

Panel bodies: `#ne` follows the `#timeseries` pattern (`display:flex; column`, body
`position:relative; flex:1; min-height:0`) so its height tracks the header — avoiding the
hardcoded `top:31px` offset used by the tree/map bodies.

---

## 7. Styling

Consistent with the page: light gridlines (`#eee`), muted axis labels (`#9c968b`), header matching
the other panels. Median line in **maroon** (`var(--maroon)`) with a **translucent maroon HPD
ribbon** (e.g. `rgba(124,29,29,0.15)`) — distinct from the distribution panel's blue sequence
marks. Log-y tick labels formatted as plain integers / powers of ten.

---

## 8. Testing

- `scripts/skygrid-lib.test.js` — `gridTimes`, `hpd` (known-input intervals), `summariseSkygrid`
  (burn-in drop, point count, monotonic times, median/HPD ordering) on a small synthetic log.
- `src/log-scale` helpers — tick generation + mappers.
- `panel-collapse.test.js` — extended `collapseGroupState` (3-pane button + per-gutter locks).
- Splitter adjacent-pair math — pure clamp/redistribute helper unit-tested if extracted.
- Full render + hover reveal + 3-pane collapse/resize verified in the running dev app.

---

## 9. Non-goals / deferred

- Locking the Ne x-axis to the tree's **live** pan/zoom transform (standalone axis only for now).
- Recomputing Ne in-browser from raw MCMC (processing is offline; the app reads the summarised JSON).
- Any change to the SkyGrid analysis itself, or exposing burn-in / grid controls in the app UI
  (burn-in is a build-time CLI flag only).
- Step-style (piecewise-constant) median rendering (smooth line chosen).
