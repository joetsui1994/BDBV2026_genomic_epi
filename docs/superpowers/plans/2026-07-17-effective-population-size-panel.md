# Effective population size (SkyGrid) panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third left-column panel, "Effective population size", that plots the BEAST SkyGrid Ne trajectory (median line + 95% HPD ribbon) on a log-y / calendar-x chart aligned to the tree window, with a hover-to-reveal full-extent control.

**Architecture:** An offline script summarises the raw `.log` into a tiny `public/data/skygrid.json`; a standalone SVG panel (`src/ne-panel.js`) renders it. The left column becomes a 3-pane resizable+collapsible stack — the splitter is generalised to adjacent-pair resizing and the collapse controller to N panes with per-gutter locks.

**Tech Stack:** Vanilla JS (ES modules), Vite, Vitest, SVG. Node for the build script.

**Design spec:** `docs/superpowers/specs/2026-07-17-effective-population-size-panel-design.md`

---

## Context for the executor

- Repo root: `/Users/user/Documents/work/DRC-Ebola-genomic-epi-public`. Run tests with `npm test`, build with `npm run build`.
- Raw BEAST log currently lives at `/Users/user/Downloads/Ituri2026.DRC_trimmed_n134_GTR_SG.log` (8.4 MB, 10,001 states, 23 `logPopSize` columns, `skygrid.cutOff` logged).
- The transform field names / SVG helper / fetch patterns are taken from the existing `src/timeseries-panel.js`. `--maroon` is `#7c1d1d`.
- Between tasks the app still builds and unit-tests pass; the **3-pane layout only becomes visually correct after Task 8** (which adds the DOM and swaps the wiring). Earlier tasks add modules/CSS that are inert until then.

## File structure

- **Create:** `scripts/skygrid-lib.mjs`, `scripts/skygrid-lib.test.js`, `scripts/build-skygrid.mjs`, `src/log-scale.js`, `src/log-scale.test.js`, `src/ne-panel.js`, `public/data/skygrid.json` (generated), `data-raw/Ituri2026.DRC_trimmed_n134_GTR_SG.log` (copied).
- **Modify:** `package.json` (add `data:skygrid`), `src/splitter.js` (adjacent-pair resize), `src/panel-collapse.js` (N-pane + per-gutter), `src/panel-collapse.test.js`, `index.html` (add `#ne` + `#gutter-h2`), `src/main.js` (fetch + wire), `src/style.css` (panel + reveal + tooltip styles).

---

## Task 1: SkyGrid summarisation library (pure, TDD)

**Files:**
- Create: `scripts/skygrid-lib.mjs`
- Test: `scripts/skygrid-lib.test.js`

- [ ] **Step 1: Write the failing test**

Create `scripts/skygrid-lib.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { parseSkygridLog, gridTimes, hpd, summariseSkygrid } from './skygrid-lib.mjs';

const LOG = [
  '# BEAST vX',
  '# Generated',
  '# file.xml',
  '# keywords: skygrid',
  ['state', 'likelihood', 'skygrid.cutOff', 'skygrid.logPopSize1', 'skygrid.logPopSize2', 'skygrid.logPopSize3'].join('\t'),
  ['0',   '-10', '0.3', '0',                  '0', '0'].join('\t'),
  ['50',  '-9',  '0.3', '0.6931471805599453', '0', '0'].join('\t'),   // ln2
  ['100', '-8',  '0.3', '1.0986122886681098', '0', '0'].join('\t'),   // ln3
].join('\n');

describe('parseSkygridLog', () => {
  it('extracts states with cutOff + ordered logPopSizes (skipping comments)', () => {
    const { states } = parseSkygridLog(LOG);
    expect(states).toHaveLength(3);
    expect(states[0].cutOff).toBe(0.3);
    expect(states[1].logPopSizes).toHaveLength(3);
    expect(states[1].logPopSizes[0]).toBeCloseTo(Math.log(2), 10);
  });
});

describe('gridTimes', () => {
  it('evenly spaces g_k = cutOff*k/gridPoints', () => {
    expect(gridTimes(0.3, 2)).toEqual([0.15, 0.3]);
  });
});

describe('hpd', () => {
  it('returns the narrowest interval covering the mass', () => {
    expect(hpd([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toEqual([1, 5]);
  });
  it('handles a full-mass / tiny sample', () => {
    expect(hpd([10, 20, 30], 1)).toEqual([10, 30]);
  });
});

describe('summariseSkygrid', () => {
  it('drops burn-in, yields gridPoints+1 points at times [0, g...], median on Ne', () => {
    const { states } = parseSkygridLog(LOG);
    const out = summariseSkygrid(states, { cutOff: 0.3, gridPoints: 2, mostRecentDate: '2026-06-23', burninFraction: 0.5 });
    expect(out.keptStates).toBe(2);                       // states 50 & 100 (>= 0.5*100)
    expect(out.points.map((p) => p.tBP)).toEqual([0, 0.15, 0.3]);
    expect(out.points[0].date).toBe('2026-06-23');        // tBP 0 → most recent date
    expect(out.points[0].neMedian).toBeCloseTo(2.5, 10);  // median(exp[ln2, ln3]) = (2+3)/2
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- skygrid-lib`
Expected: FAIL — `parseSkygridLog is not a function` (module missing).

- [ ] **Step 3: Implement the library**

Create `scripts/skygrid-lib.mjs`:
```js
// Pure helpers for summarising a BEAST SkyGrid .log into a small Ne trajectory.
// No DOM / filesystem — unit-tested in skygrid-lib.test.js; the IO wrapper is build-skygrid.mjs.

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** Parse a BEAST tab-delimited .log. Returns { header, states } where each state carries
 *  { state, cutOff, logPopSizes: number[] } with logPopSize1..N in numeric order. */
export function parseSkygridLog(text) {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const header = lines[0].split('\t');
  const iState = header.indexOf('state');
  const iCut = header.indexOf('skygrid.cutOff');
  const popCols = header
    .map((h, i) => ({ h, i }))
    .filter((o) => /^skygrid\.logPopSize\d+$/.test(o.h))
    .sort((a, b) => (+a.h.match(/\d+/)[0]) - (+b.h.match(/\d+/)[0]))
    .map((o) => o.i);
  const states = lines.slice(1).map((l) => {
    const c = l.split('\t');
    return { state: +c[iState], cutOff: +c[iCut], logPopSizes: popCols.map((i) => +c[i]) };
  });
  return { header, states };
}

/** Grid times g_k = cutOff*k/gridPoints, k=1..gridPoints (years before the most recent tip). */
export function gridTimes(cutOff, gridPoints) {
  return Array.from({ length: gridPoints }, (_, i) => (cutOff * (i + 1)) / gridPoints);
}

/** Narrowest interval [lo,hi] of already-sorted `sorted` covering `mass` of the samples (HPD). */
export function hpd(sorted, mass = 0.95) {
  const n = sorted.length;
  if (n === 0) return [NaN, NaN];
  if (n === 1) return [sorted[0], sorted[0]];
  const w = Math.max(1, Math.floor(mass * n));
  let best = [sorted[0], sorted[w - 1]], bestW = Infinity;
  for (let i = 0; i + w - 1 < n; i++) {
    const width = sorted[i + w - 1] - sorted[i];
    if (width < bestW) { bestW = width; best = [sorted[i], sorted[i + w - 1]]; }
  }
  return best;
}

const median = (sorted) => {
  const n = sorted.length, m = n >> 1;
  return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

/** Summarise post-burn-in states into gridPoints+1 Ne points for a smooth median line at times
 *  [0, g_1, ..., g_gridPoints]; point i uses segment i (logPopSize_i). 95% HPD on logPopSize,
 *  exp'd (log-space band). Returns { keptStates, points } ordered present -> past. */
export function summariseSkygrid(states, { cutOff, gridPoints, mostRecentDate, burninFraction = 0.10 }) {
  const maxState = Math.max(...states.map((s) => s.state));
  const kept = states.filter((s) => s.state >= burninFraction * maxState);
  const nSeg = gridPoints + 1;
  const times = [0, ...gridTimes(cutOff, gridPoints)];   // length nSeg
  const mrd = +new Date(mostRecentDate);
  const points = [];
  for (let i = 0; i < nSeg; i++) {
    const logs = kept.map((s) => s.logPopSizes[i]).sort((a, b) => a - b);
    const ne = kept.map((s) => Math.exp(s.logPopSizes[i])).sort((a, b) => a - b);
    const [lLo, lHi] = hpd(logs, 0.95);
    const tBP = times[i];
    points.push({
      tBP,
      date: new Date(mrd - tBP * YEAR_MS).toISOString().slice(0, 10),
      neMedian: median(ne),
      neLower: Math.exp(lLo),
      neUpper: Math.exp(lHi),
    });
  }
  return { keptStates: kept.length, points };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- skygrid-lib`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**
```bash
git add scripts/skygrid-lib.mjs scripts/skygrid-lib.test.js
git commit -m "Add SkyGrid summarisation library (parse, gridTimes, hpd, summarise)"
```

---

## Task 2: Build script + generate `skygrid.json`

**Files:**
- Copy: `data-raw/Ituri2026.DRC_trimmed_n134_GTR_SG.log`
- Create: `scripts/build-skygrid.mjs`
- Modify: `package.json` (scripts)
- Generate: `public/data/skygrid.json`

- [ ] **Step 1: Copy the raw log into the repo's raw-inputs dir**
```bash
cp /Users/user/Downloads/Ituri2026.DRC_trimmed_n134_GTR_SG.log \
   data-raw/Ituri2026.DRC_trimmed_n134_GTR_SG.log
```

- [ ] **Step 2: Write the build script**

Create `scripts/build-skygrid.mjs`:
```js
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
```

- [ ] **Step 3: Add the npm script**

In `package.json`, add to `"scripts"` after the `"data:tree"` line:
```json
    "data:tree": "node scripts/build-tree.mjs",
    "data:skygrid": "node scripts/build-skygrid.mjs"
```
(Add a comma after the `data:tree` value.)

- [ ] **Step 4: Generate the data file**

Run: `npm run data:skygrid`
Expected: prints `SkyGrid: 10001 states -> 9001 kept (burn-in 0.1), 23 points, cutOff 0.4603y` and writes the file.

- [ ] **Step 5: Sanity-check the output**

Run: `node -e "const d=require('./public/data/skygrid.json'); console.log(d.points.length, d.gridPoints, d.points[0], d.points[d.points.length-1])"`
Expected: `23 22 { date:'2026-06-23', tBP:0, neMedian:~5, ... } { date:'2026-01-05', tBP:~0.46, ... }`. Medians decrease into the past; `neLower <= neMedian <= neUpper`.

- [ ] **Step 6: Commit**
```bash
git add data-raw/Ituri2026.DRC_trimmed_n134_GTR_SG.log scripts/build-skygrid.mjs package.json public/data/skygrid.json
git commit -m "Add build-skygrid script + generated skygrid.json (10% burn-in default)"
```

---

## Task 3: Log-scale helpers (pure, TDD)

**Files:**
- Create: `src/log-scale.js`
- Test: `src/log-scale.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/log-scale.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { niceLogRange, logTicks, fmtNe } from './log-scale.js';

describe('niceLogRange', () => {
  it('rounds out to enclosing decades', () => {
    expect(niceLogRange(0.02, 600)).toEqual([0.01, 1000]);
  });
  it('never returns a zero-width range', () => {
    expect(niceLogRange(1, 1)).toEqual([1, 10]);
  });
  it('falls back for non-positive input', () => {
    expect(niceLogRange(0, 5)).toEqual([1, 10]);
  });
});

describe('logTicks', () => {
  it('returns one tick per decade inclusive', () => {
    expect(logTicks(0.01, 1000)).toEqual([0.01, 0.1, 1, 10, 100, 1000]);
  });
});

describe('fmtNe', () => {
  it('integers >= 1, decimals below', () => {
    expect(fmtNe(1000)).toBe('1000');
    expect(fmtNe(1)).toBe('1');
    expect(fmtNe(0.1)).toBe('0.1');
    expect(fmtNe(0.01)).toBe('0.01');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- log-scale`
Expected: FAIL — `niceLogRange is not a function`.

- [ ] **Step 3: Implement the helpers**

Create `src/log-scale.js`:
```js
// Pure helpers for a base-10 log y-axis. No DOM — unit-tested in log-scale.test.js.

/** Round a positive [lo,hi] out to the enclosing powers of ten; never zero-width. */
export function niceLogRange(lo, hi) {
  if (!(lo > 0) || !(hi > 0)) return [1, 10];
  const a = Math.pow(10, Math.floor(Math.log10(Math.min(lo, hi))));
  let b = Math.pow(10, Math.ceil(Math.log10(Math.max(lo, hi))));
  if (b <= a) b = a * 10;
  return [a, b];
}

/** One tick per decade across [min,max] (both expected to be exact powers of ten). */
export function logTicks(min, max) {
  const lo = Math.round(Math.log10(min)), hi = Math.round(Math.log10(max));
  const ticks = [];
  for (let d = lo; d <= hi; d++) ticks.push(Math.pow(10, d));
  return ticks;
}

/** Axis label: integers at/above 1, plain decimals below. */
export function fmtNe(v) {
  return v >= 1 ? String(Math.round(v)) : String(v);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- log-scale`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/log-scale.js src/log-scale.test.js
git commit -m "Add log-scale axis helpers (niceLogRange, logTicks, fmtNe)"
```

---

## Task 4: The Ne panel component

**Files:**
- Create: `src/ne-panel.js`

(DOM rendering; verified live in Task 9. No unit test — the numeric parts are covered by Tasks 1 & 3, matching how `timeseries-panel.js`/`map-panel.js` are untested for DOM.)

- [ ] **Step 1: Write the panel**

Create `src/ne-panel.js`:
```js
// Effective population size (SkyGrid) panel: a log-scale Ne trajectory (median line + 95% HPD
// ribbon) over a calendar x-axis, defaulting to the tree window. A header control reveals the
// full SkyGrid extent while hovered/focused. Reads the summarised public/data/skygrid.json.
import { logTicks, niceLogRange, fmtNe } from './log-scale.js';

const SVNS = 'http://www.w3.org/2000/svg';
const PAD = { left: 42, right: 12, top: 12, bottom: 22 };
const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const MAROON = '#7c1d1d';
const BAND = 'rgba(124,29,29,0.15)';

const el = (name, attrs) => {
  const n = document.createElementNS(SVNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const fmtDay = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * @param {string} containerId  the panel body element id ('ne-body')
 * @param {object} skygrid      parsed public/data/skygrid.json
 * @param {{minDate:string,maxDate:string}} domain  tree window (root -> most-recent)
 * @param {{revealButtonId?:string}} [opts]
 */
export function createNePanel(containerId, skygrid, domain, { revealButtonId } = {}) {
  const host = document.getElementById(containerId);
  host.replaceChildren();
  const holder = document.createElement('div');
  holder.className = 'ne-svg';
  const tip = document.createElement('div');
  tip.className = 'ne-tip';
  tip.style.display = 'none';
  host.append(holder, tip);

  const pts = skygrid.points.map((p) => ({ t: +new Date(p.date), med: p.neMedian, lo: p.neLower, hi: p.neUpper }));

  const treeMin = +new Date(domain.minDate), treeMax = +new Date(domain.maxDate);
  const fullMax = +new Date(skygrid.mostRecentDate);
  const fullMin = fullMax - skygrid.cutOffYears * YEAR_MS;

  // Fixed y-domain from the ribbon within the default (tree) window (spec §3).
  const inTree = pts.filter((p) => p.t >= treeMin && p.t <= treeMax);
  const loData = Math.min(...inTree.map((p) => p.lo).filter((v) => v > 0));
  const hiData = Math.max(...inTree.map((p) => p.hi));
  const [yMin, yMax] = niceLogRange(loData, hiData);

  let xMin = treeMin, xMax = treeMax;   // current x-domain (animated by the reveal)
  let W = 0, H = 0;

  const xOf = (t) => PAD.left + ((t - xMin) / (xMax - xMin)) * (W - PAD.left - PAD.right);
  const yOf = (ne) => {
    const lo = Math.log10(yMin), hi = Math.log10(yMax);
    const v = Math.log10(Math.max(ne, Number.MIN_VALUE));
    return (H - PAD.bottom) - ((v - lo) / (hi - lo)) * ((H - PAD.bottom) - PAD.top);
  };
  const dateTicks = () => {
    const n = Math.max(2, Math.min(6, Math.floor((W - PAD.left) / 80)));
    return Array.from({ length: n + 1 }, (_, i) => xMin + ((xMax - xMin) * i) / n);
  };

  function render() {
    W = host.clientWidth || 360; H = host.clientHeight || 160;
    holder.replaceChildren();
    const svg = el('svg', { width: W, height: H });
    holder.appendChild(svg);

    // clip so a revealed wide band clips at the plot rect rather than overflowing
    const clip = el('clipPath', { id: 'ne-clip' });
    clip.appendChild(el('rect', {
      x: PAD.left, y: PAD.top,
      width: Math.max(0, W - PAD.left - PAD.right), height: Math.max(0, H - PAD.top - PAD.bottom),
    }));
    svg.appendChild(clip);

    // y gridlines + labels (log decades)
    for (const tk of logTicks(yMin, yMax)) {
      const y = yOf(tk);
      svg.appendChild(el('line', { x1: PAD.left, y1: y, x2: W - PAD.right, y2: y, stroke: '#eee', 'stroke-width': 1 }));
      const lbl = el('text', { x: PAD.left - 4, y: y + 3, 'font-size': 9, fill: '#9c968b', 'text-anchor': 'end' });
      lbl.textContent = fmtNe(tk);
      svg.appendChild(lbl);
    }

    // x baseline + ticks
    const baseY = H - PAD.bottom;
    svg.appendChild(el('line', { x1: PAD.left, y1: baseY, x2: W - PAD.right, y2: baseY, stroke: '#c9c7c2', 'stroke-width': 1 }));
    for (const t of dateTicks()) {
      const x = xOf(t);
      svg.appendChild(el('line', { x1: x, y1: baseY, x2: x, y2: baseY + 3, stroke: '#c9c7c2', 'stroke-width': 1 }));
      const lbl = el('text', { x, y: baseY + 13, 'font-size': 9, fill: '#9c968b', 'text-anchor': 'middle' });
      lbl.textContent = fmtDay(t);
      svg.appendChild(lbl);
    }

    // ribbon + median (clipped to the plot rect)
    const g = el('g', { 'clip-path': 'url(#ne-clip)' });
    let d = '';
    pts.forEach((p, i) => { d += `${i ? 'L' : 'M'}${xOf(p.t)},${yOf(p.hi)} `; });
    for (let i = pts.length - 1; i >= 0; i--) d += `L${xOf(pts[i].t)},${yOf(pts[i].lo)} `;
    g.appendChild(el('path', { d: `${d}Z`, fill: BAND, stroke: 'none' }));
    let m = '';
    pts.forEach((p, i) => { m += `${i ? 'L' : 'M'}${xOf(p.t)},${yOf(p.med)} `; });
    g.appendChild(el('path', { d: m, fill: 'none', stroke: MAROON, 'stroke-width': 1.6 }));
    svg.appendChild(g);

    svg.addEventListener('mousemove', onMove);
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }

  function onMove(ev) {
    const rect = holder.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    let best = null, bd = Infinity;
    for (const p of pts) { const dd = Math.abs(xOf(p.t) - mx); if (dd < bd) { bd = dd; best = p; } }
    if (!best || best.t < xMin || best.t > xMax) { tip.style.display = 'none'; return; }
    tip.innerHTML = `<div class="ne-tip-d">${fmtDay(best.t)}</div>`
      + `<div><b>${best.med.toPrecision(3)}</b> N<sub>e</sub></div>`
      + `<div class="ne-tip-ci">95% ${best.lo.toPrecision(2)} – ${best.hi.toPrecision(2)}</div>`;
    tip.style.display = '';
    tip.style.left = `${Math.min(xOf(best.t) + 8, W - 96)}px`;
    tip.style.top = `${PAD.top + 4}px`;
  }

  // reveal animation: ease the x-domain between the tree window and the full extent
  let raf = 0;
  function animateTo(tMin, tMax) {
    const sMin = xMin, sMax = xMax, dur = 260, t0 = performance.now();
    cancelAnimationFrame(raf);
    const stepFn = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      xMin = sMin + (tMin - sMin) * e; xMax = sMax + (tMax - sMax) * e;
      render();
      if (k < 1) raf = requestAnimationFrame(stepFn);
    };
    raf = requestAnimationFrame(stepFn);
  }

  if (revealButtonId) {
    const btn = document.getElementById(revealButtonId);
    if (btn) {
      const show = () => animateTo(fullMin, fullMax);
      const hide = () => animateTo(treeMin, treeMax);
      btn.addEventListener('pointerenter', show);
      btn.addEventListener('pointerleave', hide);
      btn.addEventListener('focus', show);
      btn.addEventListener('blur', hide);
    }
  }

  const ro = new ResizeObserver(render);
  ro.observe(host);
  render();

  return { revealFull: () => animateTo(fullMin, fullMax), reset: () => animateTo(treeMin, treeMax) };
}
```

- [ ] **Step 2: Verify it type-checks by building**

Run: `npm run build`
Expected: build succeeds (module compiles; it is not imported yet, so nothing renders).

- [ ] **Step 3: Commit**
```bash
git add src/ne-panel.js
git commit -m "Add Ne panel component (log-y median + HPD ribbon, hover reveal)"
```

---

## Task 5: Panel + reveal + tooltip CSS

**Files:**
- Modify: `src/style.css`

- [ ] **Step 1: Add the `#ne` panel layout (flex-body pattern, header-height agnostic)**

In `src/style.css`, immediately after the `#timeseries > .panel-body { … }` rule (near the top layout block), add:
```css
/* Effective population size panel — follows the flex-body pattern (no hardcoded header offset). */
#ne { flex: 2 1 0; min-height: 90px; display: flex; flex-direction: column; }
#ne > .panel-body { position: relative; inset: auto; flex: 1 1 0; min-height: 0; }
.ne-svg { position: absolute; inset: 0; }
.ne-svg svg { display: block; }
.ne-tip {
  position: absolute; z-index: 5; pointer-events: none;
  background: rgba(255, 255, 255, 0.97); border: 1px solid var(--border); border-radius: 6px;
  padding: 4px 7px; font-size: 10.5px; color: var(--ink); white-space: nowrap;
  box-shadow: 0 1px 3px rgba(30, 25, 18, 0.14);
}
.ne-tip-d { font-weight: 700; color: var(--maroon); margin-bottom: 1px; }
.ne-tip-ci { color: var(--muted); }
```

- [ ] **Step 2: Give the Ne collapse chevron the same icon→title gap as the tree header**

Find the rule `#tree-collapse { margin-right: 8px; }` and extend its selector:
```css
#tree-collapse, #ne-collapse { margin-right: 8px; }
```

- [ ] **Step 3: Build + commit**

Run: `npm run build`
Expected: build succeeds.
```bash
git add src/style.css
git commit -m "style: Ne panel layout + tooltip; share collapse-chevron gap"
```
(The `⤢ Full extent` control reuses the existing `.tree-toggle` pill styling — no new rule needed.)

---

## Task 6: Generalise the splitter to adjacent-pair resizing (TDD for the math)

**Files:**
- Modify: `src/splitter.js`

- [ ] **Step 1: Write the failing test**

Create `src/splitter.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { resizeAdjacent } from './splitter.js';

describe('resizeAdjacent', () => {
  it('honours the desired first size when within bounds', () => {
    expect(resizeAdjacent(300, 200, 50, 50)).toEqual([200, 100]);
  });
  it('clamps to the first pane min', () => {
    expect(resizeAdjacent(300, 10, 50, 50)).toEqual([50, 250]);
  });
  it('clamps to the second pane min', () => {
    expect(resizeAdjacent(300, 290, 50, 50)).toEqual([250, 50]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- splitter`
Expected: FAIL — `resizeAdjacent is not a function`.

- [ ] **Step 3: Add `resizeAdjacent` + `makeColumnSplitters` to `src/splitter.js`**

Append to `src/splitter.js` (keep the existing `makeSplitter` export unchanged):
```js
/** Clamp a pair of adjacent panes sharing `combined` px so neither drops below its min.
 *  Returns [firstPx, secondPx] summing to `combined`. Pure — unit-tested. */
export function resizeAdjacent(combined, desiredFirst, minFirst, minSecond) {
  const first = Math.max(minFirst, Math.min(combined - minSecond, desiredFirst));
  return [first, combined - first];
}

/**
 * Wire each gutter to resize only its two adjacent panes in a vertical column (their combined
 * height held constant; other panes untouched), honouring per-pane min heights. `gutters[j]` sits
 * between `panes[j]` and `panes[j+1]`; `mins[j]` is pane j's min px (default 120).
 *
 * On drag start every *expanded* pane is snapshotted to a pixel-proportional flex-grow
 * (`<px> 1 0`) so grows are comparable across the column; collapsed panes (`.collapsed`, flex
 * `0 0 auto`) are left alone. Draggable gutters are only those between two expanded panes
 * (the collapse controller locks the rest), so this stays consistent.
 */
export function makeColumnSplitters(panes, gutters, mins = []) {
  gutters.forEach((gutter, j) => {
    const before = panes[j], after = panes[j + 1];
    const minB = mins[j] ?? 120, minA = mins[j + 1] ?? 120;
    let startY = 0, combined = 0, beforeH = 0;
    const onMove = (e) => {
      const [b, a] = resizeAdjacent(combined, beforeH + (e.clientY - startY), minB, minA);
      before.style.flex = `${b} 1 0`;
      after.style.flex = `${a} 1 0`;
    };
    const onUp = (e) => {
      try { gutter.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      gutter.classList.remove('dragging');
      document.body.style.cursor = '';
      gutter.removeEventListener('pointermove', onMove);
      gutter.removeEventListener('pointerup', onUp);
      gutter.removeEventListener('pointercancel', onUp);
    };
    gutter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Convert every expanded pane to a pixel-proportional grow so the pair math is consistent.
      panes.forEach((p) => {
        if (!p.classList.contains('collapsed')) p.style.flex = `${p.getBoundingClientRect().height} 1 0`;
      });
      const rb = before.getBoundingClientRect(), ra = after.getBoundingClientRect();
      beforeH = rb.height; combined = rb.height + ra.height; startY = e.clientY;
      gutter.setPointerCapture(e.pointerId);
      gutter.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      gutter.addEventListener('pointermove', onMove);
      gutter.addEventListener('pointerup', onUp);
      gutter.addEventListener('pointercancel', onUp);
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- splitter`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/splitter.js src/splitter.test.js
git commit -m "splitter: adjacent-pair column resizing (makeColumnSplitters + resizeAdjacent)"
```

---

## Task 7: Extend the collapse controller to N panes + per-gutter locks

**Files:**
- Modify: `src/panel-collapse.js`, `src/panel-collapse.test.js`

- [ ] **Step 1: Update the test to the new (array) gutter-lock shape**

Replace the whole body of `src/panel-collapse.test.js` with:
```js
import { describe, it, expect } from 'vitest';
import { collapseGroupState } from './panel-collapse.js';

describe('collapseGroupState', () => {
  it('all expanded: no gutter locked, every button enabled', () => {
    expect(collapseGroupState([false, false, false])).toEqual({
      gutterDisabled: [false, false],
      buttonDisabled: [false, false, false],
    });
  });

  it('locks only the gutters adjacent to a collapsed pane', () => {
    // middle pane collapsed -> both its gutters (0 and 1) lock
    expect(collapseGroupState([false, true, false])).toEqual({
      gutterDisabled: [true, true],
      buttonDisabled: [false, false, false],   // two still expanded, none forced
    });
    // first pane collapsed -> only gutter 0 locks
    expect(collapseGroupState([true, false, false])).toEqual({
      gutterDisabled: [true, false],
      buttonDisabled: [false, false, false],
    });
  });

  it('disables the sole remaining expanded panel so >=1 stays open', () => {
    expect(collapseGroupState([true, true, false])).toEqual({
      gutterDisabled: [true, true],
      buttonDisabled: [true, true, false],   // the one expanded pane cannot be collapsed
    });
  });

  it('still works for a two-pane group', () => {
    expect(collapseGroupState([true, false])).toEqual({
      gutterDisabled: [true],
      buttonDisabled: [false, true],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- panel-collapse`
Expected: FAIL — `gutterDisabled` is currently a boolean, not an array.

- [ ] **Step 3: Update `collapseGroupState` + the controller**

In `src/panel-collapse.js`, replace the `collapseGroupState` function with:
```js
/**
 * Pure UI-enable policy for a vertical panel group, given each panel's collapsed flag.
 * @param {boolean[]} collapsed  collapsed flag per panel, in order
 * @returns {{ gutterDisabled: boolean[], buttonDisabled: boolean[] }}
 *   gutterDisabled[j] — gutter between panes j and j+1 is locked when either neighbour is collapsed.
 *   buttonDisabled[i] — panel i's collapse button is disabled when it is the only expanded panel.
 */
export function collapseGroupState(collapsed) {
  const expandedCount = collapsed.filter((c) => !c).length;
  const gutterDisabled = [];
  for (let j = 0; j < collapsed.length - 1; j++) gutterDisabled.push(collapsed[j] || collapsed[j + 1]);
  return {
    gutterDisabled,
    buttonDisabled: collapsed.map((c) => !c && expandedCount === 1),
  };
}
```

Then replace the `makeCollapsibleColumn` signature line and its `syncPolicy` so it takes a **gutters array**. Change:
```js
export function makeCollapsibleColumn({ panels, gutter }) {
```
to:
```js
export function makeCollapsibleColumn({ panels, gutters = [] }) {
```
and replace the `syncPolicy` function body with:
```js
  const syncPolicy = () => {
    const { gutterDisabled, buttonDisabled } = collapseGroupState(collapsed);
    gutters.forEach((g, j) => { if (g) g.classList.toggle('disabled', gutterDisabled[j]); });
    panels.forEach(({ button }, i) => {
      button.disabled = buttonDisabled[i];
      button.title = buttonDisabled[i]
        ? 'At least one panel must stay expanded'
        : (collapsed[i] ? 'Expand panel' : 'Minimise panel');
    });
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- panel-collapse`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/panel-collapse.js src/panel-collapse.test.js
git commit -m "panel-collapse: N-pane groups with per-gutter locks"
```

---

## Task 8: Integrate — DOM, data fetch, and wiring

**Files:**
- Modify: `index.html`, `src/main.js`

- [ ] **Step 1: Insert the `#ne` panel + second gutter in `index.html`**

In `index.html`, replace this block:
```html
      <div id="gutter-h" class="gutter gutter-h" title="Drag to resize"><span class="grip grip-h"></span></div>
      <div id="timeseries" class="panel">
```
with:
```html
      <div id="gutter-h" class="gutter gutter-h" title="Drag to resize"><span class="grip grip-h"></span></div>
      <div id="ne" class="panel"><h3><button id="ne-collapse" class="panel-collapse" type="button" title="Minimise panel" aria-expanded="true">▼</button>Effective population size<button id="ne-fullextent" class="tree-toggle" type="button" title="Hover to show the full SkyGrid time extent">⤢ Full extent</button></h3><div id="ne-body" class="panel-body"></div></div>
      <div id="gutter-h2" class="gutter gutter-h" title="Drag to resize"><span class="grip grip-h"></span></div>
      <div id="timeseries" class="panel">
```

- [ ] **Step 2: Import the new modules in `src/main.js`**

Change:
```js
import { makeSplitter } from './splitter.js';
import { makeCollapsibleColumn } from './panel-collapse.js';
```
to:
```js
import { makeSplitter, makeColumnSplitters } from './splitter.js';
import { makeCollapsibleColumn } from './panel-collapse.js';
import { createNePanel } from './ne-panel.js';
```

- [ ] **Step 3: Fetch `skygrid.json` in the initial load**

In `src/main.js`, change the `Promise.all` block:
```js
const [tips, meta, linelistText, aliasText] = await Promise.all([
  fetch(`${BASE}data/ituri-tips.json`).then(r => r.json()),
  fetch(`${BASE}data/ituri-meta.json`).then(r => r.json()),
  fetch(`${BASE}data/${linelistSource.file}`).then(r => r.text()),
  fetch(`${BASE}data/aliases.csv`).then(r => r.text()).catch(() => ''),   // crosswalk (optional)
]);
```
to add the skygrid fetch:
```js
const [tips, meta, linelistText, aliasText, skygrid] = await Promise.all([
  fetch(`${BASE}data/ituri-tips.json`).then(r => r.json()),
  fetch(`${BASE}data/ituri-meta.json`).then(r => r.json()),
  fetch(`${BASE}data/${linelistSource.file}`).then(r => r.text()),
  fetch(`${BASE}data/aliases.csv`).then(r => r.text()).catch(() => ''),   // crosswalk (optional)
  fetch(`${BASE}data/skygrid.json`).then(r => r.json()),
]);
```

- [ ] **Step 4: Create the Ne panel**

In `src/main.js`, immediately after the `tsPanel = ts;` line (the late-bind comment block), add:
```js
// Effective population size (SkyGrid) — standalone panel below the phylogeny.
createNePanel('ne-body', skygrid, { minDate: meta.rootDate, maxDate: meta.mostRecentDate }, { revealButtonId: 'ne-fullextent' });
```

- [ ] **Step 5: Swap the vertical splitter + collapse group to the 3-pane versions**

In `src/main.js`, replace:
```js
makeSplitter(document.getElementById('gutter-h'), document.getElementById('tree'), document.getElementById('timeseries'), 'y', { minBefore: 260, minAfter: 170 });
```
with:
```js
// Three-pane vertical column: phylogeny · Ne · sample distribution. Each gutter resizes only its
// two neighbours.
makeColumnSplitters(
  [document.getElementById('tree'), document.getElementById('ne'), document.getElementById('timeseries')],
  [document.getElementById('gutter-h'), document.getElementById('gutter-h2')],
  [260, 90, 170],
);
```

Then replace the collapse block:
```js
makeCollapsibleColumn({
  panels: [
    { panel: document.getElementById('tree'), button: document.getElementById('tree-collapse') },
    { panel: document.getElementById('timeseries'), button: document.getElementById('dist-collapse') },
  ],
  gutter: document.getElementById('gutter-h'),
});
```
with:
```js
makeCollapsibleColumn({
  panels: [
    { panel: document.getElementById('tree'), button: document.getElementById('tree-collapse') },
    { panel: document.getElementById('ne'), button: document.getElementById('ne-collapse') },
    { panel: document.getElementById('timeseries'), button: document.getElementById('dist-collapse') },
  ],
  gutters: [document.getElementById('gutter-h'), document.getElementById('gutter-h2')],
});
```

- [ ] **Step 6: Build + commit**

Run: `npm run build`
Expected: build succeeds.
```bash
git add index.html src/main.js
git commit -m "Integrate Ne panel: DOM, skygrid fetch, 3-pane splitter + collapse group"
```

---

## Task 9: Full verification

- [ ] **Step 1: Unit tests + build**

Run: `npm test && npm run build`
Expected: all tests pass (incl. `skygrid-lib`, `log-scale`, `splitter`, `panel-collapse`); build succeeds.

- [ ] **Step 2: Browser check**

Run: `npm run dev`, open the app. Confirm:
- A third panel **"Effective population size"** sits directly below Phylogeny, above Sample distribution.
- It shows a **maroon median line + translucent maroon HPD ribbon**, log-y axis (power-of-ten labels), calendar x-axis over the tree window (~14 Mar → 23 Jun); hovering the curve shows a date / Ne / 95%-CI tooltip.
- Hovering **⤢ Full extent** eases the x-axis out to ~5 Jan (older, wider band clipping at the axis edges); moving away eases back. No auto-play.
- **Collapse:** each of the three panels minimises to its header; when one is collapsed its neighbouring dividers lock (faded, not draggable) and, when only one panel remains expanded, the other collapse buttons disable.
- **Resize:** dragging either divider resizes just its two neighbours; the third panel keeps its height.
- Tree, map, and Sample-distribution behaviour are unchanged.

- [ ] **Step 3: Regenerate check (burn-in flag)**

Run: `npm run data:skygrid -- --burnin=0.2`
Expected: prints `... kept (burn-in 0.2) ...` and rewrites `public/data/skygrid.json`. Then restore the default:
Run: `npm run data:skygrid`
Expected: back to `burn-in 0.1`. Leave the 10% file committed.

---

## Self-review notes

- **Spec coverage:** data processing + JSON (Tasks 1–2) · log-space HPD + median (Task 1) · configurable burn-in default 10% (Task 2) · log-y panel with ribbon + median (Tasks 3–4) · standalone calendar axis defaulting to the tree window (Task 4) · hover-to-reveal full extent, y fixed (Task 4) · placement below Phylogeny (Task 8) · 3-pane splitter + N-pane collapse with per-gutter locks (Tasks 6–8) · maroon styling (Tasks 4–5) · tests (Tasks 1, 3, 6, 7).
- **Naming consistency:** `createNePanel('ne-body', …, { revealButtonId: 'ne-fullextent' })`; DOM ids `ne`, `ne-body`, `ne-collapse`, `ne-fullextent`, `gutter-h2`; `makeColumnSplitters(panes, gutters, mins)`; `makeCollapsibleColumn({ panels, gutters })`; `collapseGroupState` returns `{ gutterDisabled: [], buttonDisabled: [] }` — used identically across Tasks 6–8.
- **Deferred (spec §9):** locking the Ne axis to the tree's live pan/zoom transform; in-browser MCMC; step-style median.
```
