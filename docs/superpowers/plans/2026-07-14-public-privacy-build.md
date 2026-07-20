# Public (privacy) build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a fresh standalone repo that is a copy of this dashboard with the entire sequencing-prioritisation feature removed and the map + distribution reduced to positive cases only, deployed to its own GitHub Pages.

**Architecture:** Copy the working tree into a new directory, drop git history, re-init. Delete the prioritisation modules, unwire their call-sites in `main.js`/`map-panel.js`/`timeseries-panel.js`/`index.html`, trim the map metric set and the distribution status set to positives, then deploy via a copied `deploy.yml` with an updated Vite `base`.

**Tech Stack:** Vanilla JS (ES modules), Vite, Vitest, Leaflet, PearTree.

**Design spec:** `docs/superpowers/specs/2026-07-14-public-privacy-build-design.md`

---

## Settled scope decisions (confirmed by owner 2026-07-14)

1. **Map metrics — keep `off`, `risk`, `Positive` only.** Confirmed: `Negative`, `Invalid`, `Unclassified`, **`total`**, `toSequence`, and **`inProgress` (Being-sequenced)** are all removed. (`total` reveals non-positive counts via `total − Positive`; `inProgress` is sequencing-workflow.) Implemented in Task 4 Steps 6 & 8.

2. **Distribution "test positivity" readout — removed.** Confirmed. The brushed-window card's positivity % (`positives / (positives + negatives)`, `updateWindowSummary` ~lines 488–512) reads Negative counts directly and is NOT affected by the positives-only `STATUS` change, so it is removed explicitly in **Task 5 Step 3** (this step is now mandatory, not conditional).

### Context caveat for the executor
Line numbers below are from the source tree at authoring time; the fresh copy is byte-identical so they should match, but if any drift, **locate edits by the quoted code**, not the line number.

## File structure

- **New repo dir** (e.g. `../DRC-Ebola-genomic-epi-public`) — a copy of this tree, no git history.
- **Delete:** `src/prioritise-panel.js`, `src/prioritise-data.js`, `src/prioritise.js`, `src/prio-knobs.js`, `src/prioritise-data.test.js`, `src/prioritise.test.js`.
- **Modify:** `vite.config.js`, `src/main.js`, `src/map-panel.js`, `src/timeseries-panel.js`, `index.html`, `src/style.css`.
- **Add:** `docs/DIVERGENCE.md` (what differs from the private repo, for manual sync).

---

## Task 1: Scaffold the fresh copy + baseline

**Files:** new directory; `vite.config.js`

- [ ] **Step 1: Copy the tree, drop history, re-init**

Run (adjust `PUB` if you chose a different repo name):
```bash
SRC=/Users/user/Documents/work/ituri-dashboard
PUB=/Users/user/Documents/work/DRC-Ebola-genomic-epi-public
rsync -a --exclude='.git' --exclude='node_modules' --exclude='dist' "$SRC/" "$PUB/"
cd "$PUB"
git init -q && git add -A && git commit -q -m "Initial import: copy of ituri-dashboard (pre-strip)"
npm ci
```

- [ ] **Step 2: Baseline — tests + build pass on the untouched copy**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds. (Establishes the copy is sound before edits.)

- [ ] **Step 3: Update the Vite base path**

In `vite.config.js`, line 20 currently:
```js
  base: command === 'build' ? '/DRC-Ebola-genomic-epi/' : '/',
```
Change the build subpath to the new repo name:
```js
  base: command === 'build' ? '/DRC-Ebola-genomic-epi-public/' : '/',
```

- [ ] **Step 4: Commit**
```bash
git add vite.config.js && git commit -m "Set Vite base to the public repo subpath"
```

---

## Task 2: Delete prioritisation modules

**Files:** delete six files.

- [ ] **Step 1: Delete the modules + their tests**
```bash
git rm src/prioritise-panel.js src/prioritise-data.js src/prioritise.js \
       src/prio-knobs.js src/prioritise-data.test.js src/prioritise.test.js
```

- [ ] **Step 2: Confirm nothing else imports them (call-sites handled in later tasks)**

Run: `grep -rnE "from './(prioritise|prio-knobs)" src`
Expected: only `src/main.js` (createPrioritisationPanel) and `src/map-panel.js` (prio-knobs) — both fixed in Tasks 3–4.

- [ ] **Step 3: Commit**
```bash
git commit -m "Delete sequencing-prioritisation modules"
```
(The build is intentionally broken until Tasks 3–4 remove the call-sites; do not run build here.)

---

## Task 3: Unwire prioritisation from `main.js`

**Files:** `src/main.js`

- [ ] **Step 1: Remove the import**

Delete line 8:
```js
import { createPrioritisationPanel } from './prioritise-panel.js';
```

- [ ] **Step 2: Remove the `__PRIO_LINELIST__` seed**

Delete lines 129–130:
```js
// Expose the current line-list rows (public-mode candidates) to the prioritisation engine.
window.__PRIO_LINELIST__ = linelist;
```

- [ ] **Step 3: Remove the `prioPanel` holder + the prioritisation panel wiring inside the geojson `.then`**

Replace this block (lines 153–181):
```js
let prioPanel = null;   // late-bound below; used by the sample-collected toggle
fetch(`${BASE}data/health-zones.geojson`)
  .then(r => r.json())
  .then(zones => {
    map.addZoneLayer(zones, zoneCounts, zonePosCt, linelist);
    const risk = new Map(zones.features.map((f) => [(f.properties.Nom || '').toUpperCase().trim(), f.properties.relative_risk]));
    const prio = createPrioritisationPanel(map.prioBody(), {
      risk, canon, tips: seqTips,
      onChange: ({ active, pageActive, cellSummary, origin, binWidthDays }) => {
        // Map choropleth follows the map's Seq+ metric; the chart overlay follows Seq+ OR the
        // prioritisation tab being open.
        if (active && cellSummary) {
          const byZone = new Map();
          for (const c of cellSummary) byZone.set(c.location, (byZone.get(c.location) || 0) + c.selected);
          map.setToSequence(byZone);
        } else {
          map.setToSequence(new Map());
        }
        if ((active || pageActive) && cellSummary) ts.setAllocation(cellSummary, { binWidthDays, origin });
        else ts.setAllocation(null);
      },
    });
    prioPanel = prio;
    map.attachPrioKnobs?.(prio);   // on-map knobs panel
    return fetch(`${BASE}data/flowminder__inflow__static.matrix.csv`)
      .then(r => r.text())
      .then(text => map.addMobilityLayer(parseMobilityMatrix(text, canon)));
  })
  .catch(err => console.warn('risk/mobility layer not loaded:', err));
```
with (drop the prio panel; keep the zone layer + mobility):
```js
fetch(`${BASE}data/health-zones.geojson`)
  .then(r => r.json())
  .then(zones => {
    map.addZoneLayer(zones, zoneCounts, zonePosCt, linelist);
    return fetch(`${BASE}data/flowminder__inflow__static.matrix.csv`)
      .then(r => r.text())
      .then(text => map.addMobilityLayer(parseMobilityMatrix(text, canon)));
  })
  .catch(err => console.warn('risk/mobility layer not loaded:', err));
```
(The `risk` local was only used by the prioritisation panel — it is intentionally gone. The map's own relative-risk choropleth reads `f.properties.relative_risk` directly and is unaffected.)

- [ ] **Step 4: Simplify the sample-collected toggle callback (drop prio push)**

Replace (lines 194–201 region):
```js
  onSampleToggle: (checked) => {
    sampleState.checked = checked;
    applySampleView(viewRows(), {
      map, ts,
      setPrioRows: (rows) => { window.__PRIO_LINELIST__ = rows; },
      getPrio: () => prioPanel,
    });
  },
```
with:
```js
  onSampleToggle: (checked) => {
    sampleState.checked = checked;
    applySampleView(viewRows(), { map, ts });
  },
```

- [ ] **Step 5: Drop the now-unused params in `applySampleView`**

In `src/sample-toggle.js`, `applySampleView` currently calls `setPrioRows(rows)` and `getPrio?.()?.refresh?.()`. Change its body to only touch map + ts:
```js
export function applySampleView(rows, { map, ts }) {
  map.setLinelist(rows);
  ts.setRows(rows);
  return rows;
}
```
Update `src/sample-toggle.test.js`: remove the `setPrioRows`/`getPrio`/`prio.refresh` expectations from the two `applySampleView` tests (keep the `map.setLinelist`/`ts.setRows`/return-value assertions; delete the "tolerates a not-yet-created prio panel" test).

- [ ] **Step 6: Verify main.js has no prio references**

Run: `grep -nE "prio|__PRIO_LINELIST__|setAllocation|setToSequence|attachPrioKnobs" src/main.js`
Expected: no matches.

- [ ] **Step 7: Commit** (build still broken until Task 4)
```bash
git add src/main.js src/sample-toggle.js src/sample-toggle.test.js
git commit -m "Unwire prioritisation from main.js + sample-toggle"
```

---

## Task 4: Unwire prioritisation + trim metrics in `map-panel.js`

**Files:** `src/map-panel.js`

- [ ] **Step 1: Remove the prio-knobs import**

Delete line 3:
```js
import { buildKnobs, buildSeedControl } from './prio-knobs.js';
```

- [ ] **Step 2: Remove prioritisation state + `setPrio`**

Delete lines 162–172:
```js
  let toSeqByZone = new Map();       // upper Nom -> to-sequence count (prioritisation)
  let applyToSeq = null;             // recompute "To sequence" metric + redraw (set in addZoneLayer)
  let prioKnobsCtl = null;           // on-map δ/β/N/Ct/bin knobs control (prioritisation)
  let mapKnobsRefresh = null;        // re-sync the on-map knob sliders to the shared params
  let prioRef = null;                // the prioritisation panel (set in attachPrioKnobs)
  // Prioritisation is "on" exactly when the chosen choropleth metric is "To sequence":
  // selecting it shows the knobs + asks the panel to compute; leaving it hides + clears.
  function setPrio(on) {
    if (prioKnobsCtl) { if (on) prioKnobsCtl.addTo(map); else prioKnobsCtl.remove(); }
    prioRef?.setActive(on);
  }
```

- [ ] **Step 3: Collapse the Map/Prioritisation tab switch to a map-only view**

Replace lines 273–292:
```js
  // Map / Prioritisation tab switch. Returning to the map re-sizes Leaflet.
  const mapBody = document.getElementById('map-body');
  const prioBody = document.getElementById('prio-body');
  const tabMap = document.getElementById('tab-map');
  const tabPrio = document.getElementById('tab-prio');
  function showTab(which) {
    const onMap = which === 'map';
    mapBody.style.display = onMap ? '' : 'none';
    prioBody.style.display = onMap ? 'none' : '';
    tabMap?.classList.toggle('active', onMap);
    tabPrio?.classList.toggle('active', !onMap);
    // Each knob strip is rebuilt/refreshed when its tab is shown, so the two never disagree
    // (they're never on screen together, so on-show sync is enough).
    if (onMap) { requestAnimationFrame(() => map.invalidateSize()); mapKnobsRefresh?.(); }
    else prioRef?.refreshKnobs?.();
    prioRef?.setPageActive?.(!onMap);   // chart shows the to-sequence overlay while on the prio tab
    onMapTab = onMap; updateCtVisibility();   // hide the Ct input off the Map tab
  }
  tabMap?.addEventListener('click', () => showTab('map'));
  tabPrio?.addEventListener('click', () => showTab('prio'));
```
with (single map view; Ct input always visible on the map):
```js
  // Single map view (the prioritisation tab was removed). Ct input is always relevant here.
  onMapTab = true;
  updateCtVisibility();
```

**Verified context (so this is unambiguous):**
- `let onMapTab = true;` is declared at **line 262** and `function updateCtVisibility() {…}` at **lines 263–265** — both *before* the replaced block (273–292), so the two replacement lines are in scope.
- `updateCtVisibility` reads `mapCtWrap`; if `mapCtWrap` is declared *after* this point it will be `undefined` at this call and the guard `if (mapCtWrap)` makes it a harmless no-op (Ct visibility is then set correctly on the first metric-button click). Either way it is safe.
- **There is NO init `showTab('map')` call** — the only two `showTab(` references are the click listeners on lines 291–292, which are inside the block you are replacing. So after this edit, `grep -nE "showTab|tabPrio|tabMap|prioBody" src/map-panel.js` must return **nothing**. `onMapTab` remains (declared line 262, only ever `true`).

- [ ] **Step 4: Remove `setToSequence` from the returned API**

Delete line 353:
```js
    setToSequence(byZone) { toSeqByZone = byZone || new Map(); applyToSeq?.(); },
```

- [ ] **Step 5: Remove `attachPrioKnobs`**

Delete the entire `attachPrioKnobs(prio) { ... }` method (starts ~line 371; it builds the `prio-knobs-wrap` control and ends at its matching `},`). Verify by grepping `grep -n "attachPrioKnobs\|prio-knobs-wrap\|buildSeedControl\|buildKnobs" src/map-panel.js` → no matches after.

- [ ] **Step 6: Trim `METRICS` to risk + Positive**

Replace the METRICS object (lines 405–414):
```js
      METRICS = {
        risk:         { label: 'Relative risk',       ramp: RISK_RAMP,                kind: 'continuous', fmt: (x) => x.toFixed(2), value: (f) => f.properties.relative_risk },
        Positive:     { label: 'Positive samples',     ramp: STATUS_RAMP.Positive,     kind: 'count', fmt: intFmt, value: (f) => (ctThreshold == null ? countsOf(f).Positive : posBelow(f)) },
        Negative:     { label: 'Negative samples',     ramp: STATUS_RAMP.Negative,     kind: 'count', fmt: intFmt, value: (f) => countsOf(f).Negative },
        Invalid:      { label: 'Invalid samples',      ramp: STATUS_RAMP.Invalid,      kind: 'count', fmt: intFmt, value: (f) => countsOf(f).Invalid },
        Unclassified: { label: 'Unclassified samples', ramp: STATUS_RAMP.Unclassified, kind: 'count', fmt: intFmt, value: (f) => countsOf(f).Unclassified },
        total:        { label: 'Total samples',        ramp: RISK_RAMP,                kind: 'count', fmt: intFmt, value: (f) => countsOf(f).total },
        toSequence:   { label: 'To sequence', ramp: TOSEQ_RAMP, kind: 'count', fmt: intFmt, value: (f) => toSeqByZone.get(upper(f.properties.Nom)) || 0 },
        inProgress:   { label: 'Being sequenced (in progress)', ramp: INPROG_RAMP, kind: 'count', fmt: intFmt, value: (f) => countsOf(f).inProgress },
      };
```
with:
```js
      METRICS = {
        risk:     { label: 'Relative risk',   ramp: RISK_RAMP,            kind: 'continuous', fmt: (x) => x.toFixed(2), value: (f) => f.properties.relative_risk },
        Positive: { label: 'Positive samples', ramp: STATUS_RAMP.Positive, kind: 'count', fmt: intFmt, value: (f) => (ctThreshold == null ? countsOf(f).Positive : posBelow(f)) },
      };
```

- [ ] **Step 7: Remove `applyToSeq` definition**

Delete line 494:
```js
      applyToSeq = () => { recomputeBreaks(METRICS.toSequence); if (metric === 'toSequence') { restyle(); renderLegend(); } };
```

- [ ] **Step 8: Simplify the metric button group (drop the sequencing group + prio activation)**

Replace lines 509–537:
```js
      // metric button group (replaces the on/off toggle): Off + risk + per-status + total (+ toSequence when prio active)
      const SHORT = { off: 'Off', risk: 'Risk', Positive: 'Pos', Negative: 'Neg', Invalid: 'Inv', Unclassified: 'Unc', total: 'Total', toSequence: 'Seq+', inProgress: 'InSeq' };
      const FULL  = { off: 'Hide colour (zones stay clickable)', risk: 'Relative risk', Positive: 'Positive samples', Negative: 'Negative samples', Invalid: 'Invalid samples', Unclassified: 'Unclassified samples', total: 'Total samples', toSequence: 'To sequence (prioritisation)', inProgress: 'Being sequenced (in progress)' };
      // Two button groups: the general metrics, then a separate sequencing group (InSeq, Seq+).
      const ORDER_MAIN = ['off', 'risk', 'Positive', 'Negative', 'Invalid', 'Unclassified', 'total'];
      const ORDER_SEQ  = ['inProgress', 'toSequence'];
      let groupWrap = null;
      const buildGroup = () => {
        if (!groupWrap) return;
        groupWrap.replaceChildren();
        const addGroup = (keys) => {
          const g = L.DomUtil.create('div', 'choropleth-group', groupWrap);
          for (const key of keys) {
            const b = L.DomUtil.create('button', key === metric ? 'active' : '', g);
            b.type = 'button'; b.textContent = SHORT[key]; b.title = FULL[key]; b.dataset.metric = key;
            b.onclick = () => {
              const wasToSeq = metric === 'toSequence';
              metric = key;
              groupWrap.querySelectorAll('button').forEach((c) => c.classList.toggle('active', c.dataset.metric === key));
              restyle(); renderLegend();
              updateCtVisibility();   // the Ct input rides with the Positive metric
              // Selecting "To sequence" activates prioritisation (knobs + compute); leaving it deactivates.
              if (key === 'toSequence' && !wasToSeq) setPrio(true);
              else if (key !== 'toSequence' && wasToSeq) setPrio(false);
            };
          }
        };
        addGroup(ORDER_MAIN);
        addGroup(ORDER_SEQ);
      };
```
with:
```js
      // metric button group: Off + Relative risk + Positive.
      const SHORT = { off: 'Off', risk: 'Risk', Positive: 'Pos' };
      const FULL  = { off: 'Hide colour (zones stay clickable)', risk: 'Relative risk', Positive: 'Positive samples' };
      const ORDER_MAIN = ['off', 'risk', 'Positive'];
      let groupWrap = null;
      const buildGroup = () => {
        if (!groupWrap) return;
        groupWrap.replaceChildren();
        const g = L.DomUtil.create('div', 'choropleth-group', groupWrap);
        for (const key of ORDER_MAIN) {
          const b = L.DomUtil.create('button', key === metric ? 'active' : '', g);
          b.type = 'button'; b.textContent = SHORT[key]; b.title = FULL[key]; b.dataset.metric = key;
          b.onclick = () => {
            metric = key;
            groupWrap.querySelectorAll('button').forEach((c) => c.classList.toggle('active', c.dataset.metric === key));
            restyle(); renderLegend();
            updateCtVisibility();   // the Ct input rides with the Positive metric
          };
        }
      };
```

- [ ] **Step 9: Remove `prioBody` from the returned API + the tooltip's toSequence branch**

Delete line 615: `    prioBody: () => document.getElementById('prio-body'),`
Delete line 457: `        if (metric === 'toSequence') return \`${nom} (health zone) — ${METRICS.toSequence.value(f) || 0} to sequence\`;`

- [ ] **Step 10: Verify map-panel is prio-free and builds**

Run: `grep -nE "prio|Prio|toSequence|toSeqByZone|setPrio|applyToSeq|ORDER_SEQ|prio-knobs|prioBody|tabPrio|showTab" src/map-panel.js`
Expected: **no matches** (the prioritisation symbols are gone).

Then run: `grep -nE "Negative|Invalid|Unclassified|inProgress" src/map-panel.js`
Expected: **matches are OK here** — these survive only in inert data tables (`STATUS_RAMP` ramp entries ~lines 24–27, the `ZERO` default `{…Negative:0,Invalid:0,Unclassified:0,total:0,inProgress:0}` ~line 397, and `countsOf`, which still receives all-status counts from `tallyZones`). They are never rendered as metrics. Removing the unused `STATUS_RAMP` entries is optional tidy.

Run: `npm run build`
Expected: build succeeds (all call-sites resolved).

- [ ] **Step 11: Commit**
```bash
git add src/map-panel.js && git commit -m "map-panel: remove prioritisation + non-positive metrics (risk + Positive only)"
```

---

## Task 5: Distribution chart → positives only

**Files:** `src/timeseries-panel.js`, `src/timeseries-panel.test.js`

**Context — how positives-only actually works here.** The chart's bars, legend, tooltip, "not shown" note, and CSV export all iterate the module-level `STATUS` array, so reducing it to `['Positive']` cascades to all of them. Two things do NOT cascade and need explicit handling: the unit test that asserts non-positives are plotted (Step 2), and the window-summary positivity % that hard-codes Negative (Step 3). The to-sequence allocation code is already inert (Step 4).

- [ ] **Step 1: Reduce the status set to Positive**

Line 13 currently:
```js
const STATUS = ['Positive', 'Negative', 'Invalid', 'Unclassified'];
```
Change to:
```js
const STATUS = ['Positive'];
```
This cascades automatically to: the legend (line 138), tooltip (162), bars loop (671), the "not shown" undated breakdown (457/470/472), and the CSV `EXPORT_COLS = ['date', ...STATUS, 'total', …]` (324) — so the Negative/Invalid/Unclassified **columns drop from the export** and CSV `total` becomes the Positive count. Note: a few `{ Positive: 0, Negative: 0, Invalid: 0, Unclassified: 0 }` *default objects* (lines ~344, ~455) still list the four keys — that is harmless (only the `STATUS` keys are ever read); do not treat their presence as a failure in later greps.

- [ ] **Step 2: Fix the one test that breaks**

In `src/timeseries-panel.test.js`, `extentFraction` filters rows through `STATUS_SET` (`src/timeseries-panel.js:36`), so with `STATUS=['Positive']` a beyond-tree **Negative** row is now ignored (no longer extends the axis). Replace the test at lines 42–45:
```js
  it('a beyond-tree non-positive still extends (it is plotted)', () => {
    expect(extentFraction([row('2026-06-03', 'Negative', '')], T0, T1, true, 30).effMax)
      .toBe(+new Date('2026-06-03'));
  });
```
with:
```js
  it('a beyond-tree non-positive no longer extends (positives-only build)', () => {
    expect(extentFraction([row('2026-06-03', 'Negative', '')], T0, T1, true, 30).effMax).toBe(T1);
  });
```
(The `ctPass` "passes non-positives regardless of Ct" test at line 10 is unaffected — `ctPass` keys off `status !== 'Positive'`, not `STATUS_SET`. Leave it.)

- [ ] **Step 3: Remove the test-positivity readout (confirmed — mandatory)**

`updateWindowSummary()` (~lines 482–518) counts positives+negatives to render a positivity %. Remove **only** the negative-derived parts — the `pos` count must stay (it also feeds the "% of positives sequenced" line at ~514).

Change the tally loop (~488–495) from:
```js
    let pos = 0, neg = 0;
    for (const r of filteredRows()) {
      if (!inWin(r.date) || !ctPass(r, ctThreshold)) continue;
      if (r.status === 'Positive') pos++;
      else if (r.status === 'Negative') neg++;
    }
    const tested = pos + neg;
    const pct = tested ? Math.round((pos / tested) * 100) : null;
```
to (keep `pos`; drop `neg`/`tested`/`pct`):
```js
    let pos = 0;
    for (const r of filteredRows()) {
      if (!inWin(r.date) || !ctPass(r, ctThreshold)) continue;
      if (r.status === 'Positive') pos++;
    }
```
Then delete the positivity render line (~510–512):
```js
    lines.push(`<div>${pct == null
      ? '<span class="ws-dim">no tests in range</span>'
      : `<b>${pct}%</b> test positivity <span class="ws-dim">(${pos}/${tested})</span>`}</div>`);
```
Keep everything else in the summary: the date-range line (509) and the "existing sequences (`seqPct`% of +ve)" line (513–515, which uses the retained `pos`).

- [ ] **Step 4: (Optional tidy) drop the inert allocation leftovers**

The to-sequence allocation is only ever activated by `setAllocation`, which nothing calls after Task 3 — so `allocation` is permanently `null` and every `if (allocation)` block (tooltip "To sequence" row ~167–168, the teal track ~710–721, the window-summary alloc line ~516) is dead and never renders. This step is **not required for correctness**; do it only for cleanliness:
- Remove the `setAllocation` method (~806) — a dead public method.
- Remove the `to_sequence` entry from `EXPORT_COLS` (324) and the `const alloc = allocByDate(...)` (337), the `alloc.keys()` day-union (342), and `to_sequence: alloc.get(ds) || 0` (346) so the CSV drops the always-0 column.
Anything left behind (`ALLOC_COLOR`, `allocByDate`, the state at 191–192, the track block) is inert and safe to leave. Do NOT touch the `SEQ_COLOR` (sequences) or `INPROG_COLOR` (in-sequencing) tracks — those are kept.

- [ ] **Step 5: Build + tests**

Run: `npm test && npm run build`
Expected: all pass (the updated `timeseries-panel.test.js` included); build succeeds.

- [ ] **Step 6: Commit**
```bash
git add src/timeseries-panel.js src/timeseries-panel.test.js
git commit -m "distribution: positives-only bars + drop negative-derived positivity readout"
```

---

## Task 6: `index.html` — drop the prioritisation tab

**Files:** `index.html`

- [ ] **Step 1: Replace the tabbed map header + remove the prio body**

Lines 29–31 currently:
```html
      <h3 class="map-head"><button id="tab-map" class="map-tab active" type="button">Outbreak map</button><button id="tab-prio" class="map-tab" type="button">Sequencing prioritisation</button><span id="map-ct" class="dist-ct map-ct" style="display:none"><label>Ct&lt;</label><input type="number" min="1" max="99" step="1" placeholder="off"></span></h3>
      <div id="map-body" class="panel-body"></div>
      <div id="prio-body" class="panel-body" style="display:none; overflow:auto; padding:14px 16px;"></div>
```
Replace with (static title, keep the Ct input span, drop the prio tab + body):
```html
      <h3 class="map-head"><span class="map-title">Outbreak map</span><span id="map-ct" class="dist-ct map-ct" style="display:none"><label>Ct&lt;</label><input type="number" min="1" max="99" step="1" placeholder="off"></span></h3>
      <div id="map-body" class="panel-body"></div>
```

- [ ] **Step 2: Build + commit**
```bash
npm run build && git add index.html && git commit -m "index: remove prioritisation tab, single Outbreak map view"
```

---

## Task 7: `src/style.css` — remove prio + tab styles

**Files:** `src/style.css`

- [ ] **Step 1: Delete the dead rule blocks**

Remove these rules (grep the line ranges, then delete each block):
- `.choropleth-group button[data-metric="toSequence"]` (3 rules, ~lines 346–348)
- `#tab-prio.active` (~446), `#prio-body` and its descendants `#prio-body h4/code/input/.prio-lead` (~447–452)
- `.prio-knobs`, `.prio-knobs-wrap`, `.prio-knobs .pk-*` (~525–578)
- Any `.map-tab` rule that styled the removed tab buttons (search `grep -n "map-tab\|#tab-map\|#tab-prio\|map-title" src/style.css`); if `.map-tab` styled the title look you want to keep, re-point it to `.map-title`, otherwise delete.

- [ ] **Step 2: Verify no prio selectors remain + the map title still looks right**

Run: `grep -nE "prio|toSequence|tab-prio|tab-map" src/style.css`
Expected: no matches (or only intentional `.map-title`).

- [ ] **Step 3: Commit**
```bash
git add src/style.css && git commit -m "style: remove prioritisation + tab CSS"
```

---

## Task 8: Full verification + DIVERGENCE doc

**Files:** `docs/DIVERGENCE.md`

- [ ] **Step 1: Global grep — the feature is fully gone**

Run: `grep -rnE "prioritise|prio-knobs|__PRIO_LINELIST__|attachPrioKnobs|toSequence|setToSequence|createPrioritisationPanel|prio-body|tab-prio" src index.html`
Expected: **no matches.** (These are the mandatory removals.)

Note: `setAllocation` / `allocation` / `ALLOC_COLOR` may still appear in `src/timeseries-panel.js` if the optional Task 5 Step 4 tidy was skipped — that is acceptable, they are inert (never triggered because nothing calls `setAllocation`).

- [ ] **Step 2: Unit tests + build**

Run: `npm test && npm run build`
Expected: all remaining tests pass (prioritisation test files are gone; `sample-toggle.test.js` updated); build succeeds.

- [ ] **Step 3: Browser check**

Run: `npm run dev`, open the DHIS view. Confirm:
- No "Sequencing prioritisation" tab; the map is a single "Outbreak map" view.
- The map metric buttons offer only **Off / Risk / Pos**; selecting Pos colours zones; no Neg/Inv/Unc/Total/Seq buttons.
- The sample-distribution chart shows **positive bars only** (no other status bars/legend entries); the Sequences / In-sequencing tracks + Ct filter still work.
- Tree, markers, mobility arrows, and the sample-collected toggle still render/behave.

- [ ] **Step 4: Write `docs/DIVERGENCE.md`**

Record, for manual sync from the private repo: the deleted modules, the trimmed map metrics (risk + Positive), the positives-only distribution, the removed upload/prioritisation tab, and the Vite `base` change. One paragraph each.

- [ ] **Step 5: Commit + create the GitHub repo + push**
```bash
git add docs/DIVERGENCE.md && git commit -m "Add DIVERGENCE notes"
# Create the empty public repo on GitHub (owner action), then:
git remote add origin https://github.com/joetsui1994/DRC-Ebola-genomic-epi-public.git
git branch -M main && git push -u origin main
```
Enable GitHub Pages (Source: GitHub Actions) on the new repo. The copied `deploy.yml` runs on push to `main`; confirm the run is green and the site serves at `https://joetsui1994.github.io/DRC-Ebola-genomic-epi-public/`.

---

## Self-review notes

- **Spec coverage:** separate fresh repo (Task 1) · delete prio modules (Task 2) · unwire main.js (Task 3) · unwire + trim map (Task 4) · positives-only distribution + no allocation (Task 5) · index tab removal (Task 6) · CSS (Task 7) · verify + deploy + divergence (Task 8). Upload removal is covered by deleting `prioritise-panel.js` (Task 2), which houses it.
- **Naming consistency:** `setLinelist`/`setRows` (kept), `applySampleView({map, ts})` (Task 3 Step 5), metric keys `off/risk/Positive`, `STATUS=['Positive']` — used identically across tasks.
- **Deferred:** data-level stripping of non-positive/identifiable records (spec non-goal); note it stays a one-line filter later.
