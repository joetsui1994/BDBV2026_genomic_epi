import { createTimeScale, scaleFromAnchors } from './time-scale.js';

// "Sample distribution" panel: a bar chart of confirmed cases by onset date — one
// bar per day. The x-axis is locked to the tree's view transform (stays aligned with
// the phylogeny regardless of the subset plotted); the y-axis rescales to the data.
// A province <select> + zone selection (driven by the map/coordinator) re-scope the
// daily-count series the bars are drawn from.

const SVNS = 'http://www.w3.org/2000/svg';
const PAD = { left: 34, right: 20, top: 14, bottom: 22 };
const DAY_MS = 86400000;

const CONFIRMED_COLOR = '#9e2b2b';   // confirmed-case bars (maroon)

/** Latest dated day with a positive count + the tree-width fraction it implies.
 *  series: Map<dateStr, count>; t0/t1: domain ms; on: showBeyond. Returns { effMax (ms), f∈[F_MIN,1] }. */
export function extentFraction(series, t0, t1, on, F_MIN = 0.4) {
  let effMax = t1;
  if (on) for (const [ds, n] of series) {
    if (!n) continue;
    const t = +new Date(ds);
    if (!isNaN(t) && t > effMax) effMax = t;
  }
  const f = effMax > t0 ? Math.max(F_MIN, Math.min(1, (t1 - t0) / (effMax - t0))) : 1;
  return { effMax, f };
}

/** Convert a drag's start/end x (svg px) to an ordered time window, or null if the drag was
 *  too short to be a brush (a click → clear). `scale` exposes xToDate. */
export function brushWindow(x0, x1, scale, minPx = 3) {
  if (Math.abs(x1 - x0) < minPx) return null;
  return { d0: +scale.xToDate(Math.min(x0, x1)), d1: +scale.xToDate(Math.max(x0, x1)) };
}

/** Whether a PearTree view transform is usable for locking the chart's x-axis. The chart's
 *  drawn span is `maxX * scaleX` (root→x=offsetX, tip→x=offsetX+span); a collapsed / zero-size
 *  tree emits `maxX>0` but `scaleX≈0` (span→0), which would map every bar onto a single x and
 *  make the histogram vanish. Require finite anchors and at least a pixel of span. */
export function isUsableTransform(t) {
  return !!t && Number.isFinite(t.offsetX) && Number.isFinite(t.scaleX)
    && t.maxX > 0 && t.maxX * t.scaleX > 1;
}

const SEQ_COLOR = '#5b86b3';   // sequence-availability track (genomic samples) — matches the outbreak-map sequence markers (muted blue)
const SEL_MARKER_COLOR = '#f2c84b'; // selected-node date markers — matches the outbreak-map selected marker (yellow/orange)

const el = (name, attrs) => {
  const n = document.createElementNS(SVNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

// Adaptive time-axis ticks: pick a "nice" interval (day → weekly → monthly) so
// labels are as dense as the pixel width allows (~70px apart) without packing.
function timeTicks(pxWidth, t0, t1) {
  const spanDays = Math.max(1, (t1 - t0) / DAY_MS);
  const target = Math.max(2, Math.min(14, Math.floor((pxWidth || 0) / 58)));
  const rawStep = spanDays / target;                        // desired step, in days
  const multiYear = new Date(t0).getFullYear() !== new Date(t1).getFullYear();
  const dayFmt = multiYear ? { day: 'numeric', month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
  const monFmt = { month: 'short', year: 'numeric' };

  const ticks = [];
  const step = [1, 2, 3, 7, 14].find((s) => s >= rawStep);
  if (step) {                                               // day / week steps
    let d = new Date(t0); d.setHours(0, 0, 0, 0);
    if (step >= 7) { const mon = (d.getDay() + 6) % 7; if (mon) d = new Date(+d + (7 - mon) * DAY_MS); } // anchor on Monday
    for (let t = +d; t <= t1; t += step * DAY_MS) ticks.push({ date: new Date(t), fmt: dayFmt });
  } else {                                                  // month steps
    const ms = [1, 2, 3, 6, 12].find((s) => s >= rawStep / 30) || 12;
    let d = new Date(t0); d = new Date(d.getFullYear(), d.getMonth() + (d.getDate() > 1 ? 1 : 0), 1);
    while (+d <= t1) { ticks.push({ date: new Date(d), fmt: monFmt }); d = new Date(d.getFullYear(), d.getMonth() + ms, 1); }
  }
  return ticks;
}

/**
 * @param {string} containerId
 * @param {{minDate:string,maxDate:string}} domain  tree time domain (root → most-recent)
 * @param {(scope:{zones:string[],province:?string})=>{series:Map<string,number>,tips:object[]}} resolveSeries
 * @param {object} [opts]
 */
export function createTimeseriesPanel(containerId, domain, resolveSeries, { provinceNames = [], onDeselect = () => {}, onExtentChange = () => {}, onWindowChange = () => {}, onSettling = () => {}, onTransform = () => {} } = {}) {
  const host = document.getElementById(containerId);
  host.replaceChildren();

  // Current geographic scope + resolved data (bars series + sequence-track tips).
  let scope = { zones: [], province: null };
  let resolved = resolveSeries(scope);
  let series = resolved.series;      // Map<dateStr, confirmed count>
  let selTips = resolved.tips;       // tree tips for the sequence track, filtered to the scope

  // Province selector (national default) — a scope control in the panel's top-left.
  const left = document.createElement('div');
  left.className = 'dist-controls-left';
  const provSel = document.createElement('select');
  provSel.className = 'dist-province';
  provSel.append(new Option('National', ''));
  for (const p of provinceNames) provSel.append(new Option(p, p));
  provSel.addEventListener('change', () => setProvince(provSel.value || null));
  left.append(provSel);

  // Header "clear" button (in index.html, after the not-shown note): drops the active location
  // selection. Hidden unless a zone/tip location is selected (toggled in reresolve()).
  const clearBtn = document.getElementById('dist-clear');
  if (clearBtn) clearBtn.onclick = () => onDeselect();

  const legend = document.createElement('div');
  legend.className = 'dist-legend';
  legend.innerHTML = `<span><i style="background:${CONFIRMED_COLOR}"></i>Confirmed</span>`
    + `<span><i class="seq-dot" style="background:${SEQ_COLOR}"></i>Sequences</span>`;

  const controls = document.createElement('div');   // top-left row: [province selector] + legend
  controls.className = 'dist-controls';
  controls.append(left, legend);

  const holder = document.createElement('div');
  holder.className = 'dist-svg';
  const tip = document.createElement('div');
  tip.className = 'dist-tip';
  tip.style.display = 'none';
  // Persistent summary card for the brushed window (bottom-left). Like `tip`, it lives on
  // host (not holder) so the per-render SVG wipe doesn't remove it; pointer-events:none so it
  // never blocks brushing/hover on the bars beneath. Hidden until a window is brushed.
  const summary = document.createElement('div');
  summary.className = 'dist-window-summary';
  summary.style.display = 'none';
  host.append(controls, holder, tip, summary);   // tip/summary on host (holder is wiped each render)

  function showTip(ev, dateStr, count) {
    const d = new Date(dateStr);
    let html = `<div class="tip-date">${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>`;
    html += `<div class="tip-row"><i style="background:${CONFIRMED_COLOR}"></i>Confirmed<b>${count}</b></div>`;
    const seqN = seqMap.get(dateStr) || 0;
    if (seqN) html += `<div class="tip-row"><i class="seq-dot" style="background:${SEQ_COLOR}"></i>Sequences<b>${seqN}</b></div>`;
    tip.innerHTML = html;
    tip.style.display = 'block';
    const rect = host.getBoundingClientRect();
    const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = cx + 12; if (left + tw > rect.width) left = cx - tw - 12; if (left < 0) left = 2;
    let top = cy + 12;  if (top + th > rect.height) top = cy - th - 12; if (top < 0) top = 2;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  const hideTip = () => { tip.style.display = 'none'; };

  const note = document.getElementById('dist-note');   // "N not shown (…)" in the panel header
  let markerDates = [];
  let transform = null;
  let scale, markerLayer, H;
  let seqMap = new Map();   // date → #sequences (current scope), for the track + tooltip

  const t0 = +new Date(domain.minDate);
  const t1 = +new Date(domain.maxDate);

  let showBeyond = false;            // toggle: extend the axis past the tree's latest date
  let win = null;                    // brushed time window { d0, d1 } in ms, or null
  let effMaxMs = t1;                 // current effective right-edge date (ms); = t1 when off
  let extentRaf = 0;                 // rAF handle, coalesces tree-resize requests
  let lastF = 1;                     // tree width-fraction the tree is currently at (for prediction)
  let autoCorr = 0;                  // consecutive calibration re-sends since the last user action
  let settling = false, settleTimer = 0;   // hide tree+chart while a relayout recalibration settles

  // A tree relayout (tip labels / node-bars / legend) invalidates the width-fraction calibration,
  // so beyond mode briefly re-probes and re-converges — visibly flickering. Mask it: hide the
  // chart + tree on the first recalibration step and fade them back once no fraction has been sent
  // for a short, quiet window (i.e. it has settled).
  const armReveal = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settling = false;
      holder.style.transition = 'opacity 0.18s ease'; holder.style.opacity = '';   // fade back in
      onSettling(false);
    }, 200);
  };
  function beginSettle() {   // called only when a relayout actually invalidates the calibration
    if (!settling) {
      settling = true;
      holder.style.transition = 'none'; holder.style.opacity = '0';   // hide instantly (no fade through the flicker)
      onSettling(true);
    }
    armReveal();
  }

  // The naïve fill fraction f = (t1-t0)/(effMax-t0) assumes compressing the tree keeps its left
  // edge fixed, but PearTree shifts the whole tree (offsetX moves), so the post-tree tail lands
  // short of the right edge — a gap. We instead learn the tree's φ→geometry response (offsetX and
  // right-edge x1, both ~linear in φ at a given width) and solve for the φ that makes the uniform
  // axis fill exactly. Calibration is per-width; ≥2 samples at distinct φ are needed to fit.
  let calib = { W: 0, samples: [] };   // [{ phi, offsetX, x1 }]
  function recordCalib(phi, t) {
    const W = host.clientWidth || 0; if (!W) return;
    if (W !== calib.W) calib = { W, samples: [] };
    const s = { phi, offsetX: t.offsetX, x1: t.offsetX + t.maxX * t.scaleX };
    const i = calib.samples.findIndex((p) => Math.abs(p.phi - phi) < 0.015);
    if (i >= 0) {
      // Same fraction but the tree reports a different geometry → its layout changed (tip labels,
      // node-bars, legend…). The other samples are now stale: drop them and recalibrate from this.
      const old = calib.samples[i];
      if (Math.abs(old.offsetX - s.offsetX) > 2 || Math.abs(old.x1 - s.x1) > 2) {
        calib = { W, samples: [s] }; autoCorr = 0; beginSettle(); return;
      }
      calib.samples[i] = s;
    } else {
      calib.samples.push(s);
      if (calib.samples.length > 5) calib.samples.shift();
    }
  }
  function fitLine(key) {   // least-squares y = m·phi + b
    const s = calib.samples, n = s.length;
    let sx=0, sy=0, sxx=0, sxy=0;
    for (const p of s) { sx+=p.phi; sy+=p[key]; sxx+=p.phi*p.phi; sxy+=p.phi*p[key]; }
    const den = n*sxx - sx*sx;
    if (Math.abs(den) < 1e-9) return null;
    const m = (n*sxy - sx*sy)/den;
    return { m, b: (sy - m*sx)/n };
  }
  const clampF = (f) => Math.max(0.4, Math.min(1, f));   // F_MIN matches extentFraction
  // φ to ask the tree for: 1 when not extending; the corrected fill fraction once calibrated;
  // the naïve f0 meanwhile (which also gathers the second calibration sample).
  function desiredFraction() {
    if (!showBeyond || effMaxMs <= t1) return 1;
    const f0 = clampF((t1 - t0) / (effMaxMs - t0));
    const W = host.clientWidth || 0;
    if (calib.W !== W || calib.samples.length < 2) return f0;
    const fo = fitLine('offsetX'), fx = fitLine('x1');
    if (!fo || !fx) return f0;
    const X_R = W - PAD.right, k = (effMaxMs - t1) / (t1 - t0);
    // want xMax(φ) = x1(φ)·(1+k) − k·offsetX(φ) = X_R
    const den = fx.m * (1 + k) - k * fo.m;
    if (Math.abs(den) < 1e-9) return f0;
    return clampF((X_R - (fx.b * (1 + k) - k * fo.b)) / den);
  }
  // Push the desired fraction to the tree if it differs from the current one (coalesced via rAF),
  // predicting the transform so this synchronous render is already close to the refit result.
  function syncTreeFraction() {
    const phi = desiredFraction();
    if (Math.abs(phi - lastF) <= 0.005) return;
    // Predict the tree's transform at the new fraction so this synchronous render already matches
    // the upcoming refit — otherwise the beyond region flashes un-squashed for a frame. When
    // calibrated, predict both offsetX and the right edge (the tree shifts left, not just scales).
    if (transform && transform.maxX > 0) {
      const fo = (calib.W === (host.clientWidth || 0) && calib.samples.length >= 2) ? fitLine('offsetX') : null;
      const fx = fo ? fitLine('x1') : null;
      if (fo && fx) {
        const offsetX = fo.m * phi + fo.b, x1 = fx.m * phi + fx.b;
        transform = { ...transform, offsetX, scaleX: (x1 - offsetX) / transform.maxX };
      } else if (lastF > 0) {
        transform = { ...transform, scaleX: transform.scaleX * (phi / lastF) };
      }
    }
    lastF = phi;
    if (settling) armReveal();   // still converging → keep it hidden until things go quiet
    if (extentRaf) cancelAnimationFrame(extentRaf);
    extentRaf = requestAnimationFrame(() => { extentRaf = 0; onExtentChange(phi); });
  }

  // Recompute the effective max from the current scope, sync the tree fraction, re-render.
  function applyExtent() {
    const ext = extentFraction(series, t0, t1, showBeyond);
    effMaxMs = ext.effMax;
    autoCorr = 0;            // user action: allow the calibration loop to re-converge
    syncTreeFraction();
    render();
  }

  // ── CSV export ─────────────────────────────────────────────────────────────
  // One row per date: the confirmed-case count. Honours the geographic scope and the
  // brushed window (when set, dates are clipped to it; otherwise to the visible axis).
  const EXPORT_COLS = ['date', 'confirmed'];
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  function exportWindow() { return win ? { lo: Math.min(win.d0, win.d1), hi: Math.max(win.d0, win.d1) } : null; }
  function exportRows() {
    const w = exportWindow();
    const inRange = (ds) => { const t = +new Date(ds); if (isNaN(t)) return false; return w ? (t >= w.lo && t <= w.hi) : (t >= t0 && t <= effMaxMs); };
    const out = [];
    for (const [ds, n] of series) if (n && inRange(ds)) out.push({ date: ds, confirmed: n });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  const buildCsvText = (rows) =>
    [EXPORT_COLS.join(','), ...rows.map((r) => EXPORT_COLS.map((k) => r[k]).join(','))].join('\n') + '\n';

  // Human-readable description of the active scope + a default (editable) filename.
  function exportFacts() {
    const location = scope.zones.length ? `${scope.zones.join(', ')} (health zone${scope.zones.length > 1 ? 's' : ''})`
      : scope.province ? `${scope.province} (province)` : 'National';
    const w = exportWindow();
    const timeRange = w ? `${fmtDay(w.lo)} – ${fmtDay(w.hi)} (selected window)`
      : showBeyond ? `${fmtDay(t0)} – ${fmtDay(effMaxMs)} (incl. beyond tree)`
      : `${fmtDay(t0)} – ${fmtDay(t1)} (full range)`;
    const locTag = scope.zones.length ? scope.zones.join('-') : scope.province || 'national';
    const rangeTag = w ? `${ymd(w.lo)}_${ymd(w.hi)}` : (showBeyond ? `${ymd(t0)}_${ymd(effMaxMs)}` : 'full');
    const filename = `confirmed-cases_${locTag}_${rangeTag}`.replace(/[^\w.-]+/g, '_') + '.csv';
    return { location, timeRange, filename };
  }

  // Confirmation dialog: shows what's being exported, lets the user edit the filename, downloads.
  let exportModal = null;
  function ensureExportModal() {
    if (exportModal) return exportModal;
    const overlay = document.createElement('div');
    overlay.className = 'export-modal-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="export-modal" role="dialog" aria-modal="true" aria-label="Download confirmed cases">
        <h4>Download data</h4>
        <dl class="export-summary">
          <dt>Location</dt><dd data-k="location"></dd>
          <dt>Time range</dt><dd data-k="time"></dd>
        </dl>
        <label class="export-filename">Filename<input type="text" spellcheck="false"></label>
        <div class="export-actions">
          <button type="button" class="export-cancel">Cancel</button>
          <button type="button" class="export-go">Download CSV</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.style.display = 'none'; };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.export-cancel').onclick = close;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.style.display !== 'none') close(); });
    exportModal = {
      overlay, close,
      val: (k) => overlay.querySelector(`[data-k="${k}"]`),
      input: overlay.querySelector('.export-filename input'),
      go: overlay.querySelector('.export-go'),
    };
    return exportModal;
  }
  function openExportDialog() {
    const m = ensureExportModal();
    const facts = exportFacts();
    const rows = exportRows();
    m.val('location').textContent = facts.location;
    m.val('time').textContent = facts.timeRange;
    m.input.value = facts.filename;
    m.go.disabled = rows.length === 0;
    m.go.onclick = () => {
      let name = (m.input.value || '').trim() || 'confirmed-cases';
      if (!/\.csv$/i.test(name)) name += '.csv';
      const blob = new Blob([buildCsvText(rows)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      m.close();
    };
    m.overlay.style.display = '';
    m.input.focus(); m.input.select();
  }
  const downloadEl = document.getElementById('dist-download');
  if (downloadEl) downloadEl.onclick = openExportDialog;
  const beyondEl = document.getElementById('dist-beyond');
  if (beyondEl) beyondEl.onclick = () => {
    showBeyond = !showBeyond;
    beyondEl.classList.toggle('active', showBeyond);
    beyondEl.textContent = showBeyond ? '←' : '→';   // → extend right · ← collapse back
    beyondEl.title = showBeyond ? 'Hide samples beyond the tree’s latest date'
                                : 'Show samples dated after the tree’s latest tip';
    beginSettle();   // mask the squash/unsquash transition (fades back once the refit settles)
    applyExtent();
  };

  // Confirmed cases the chart can't show for the current scope: dated outside the tree
  // window. (The map choropleth counts all of them, hence the difference.)
  const fmtDay = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  function updateNote() {
    if (!note) return;
    let after = 0, before = 0;
    for (const [ds, n] of series) {
      if (!n) continue;
      const t = +new Date(ds);
      if (isNaN(t)) continue;
      if (t > effMaxMs) after += n; else if (t < t0) before += n;
    }
    const total = after + before;
    if (!total) { note.style.display = 'none'; note.textContent = ''; return; }
    const parts = [];
    if (after)  parts.push(`${after} after ${fmtDay(effMaxMs)}`);
    if (before) parts.push(`${before} before ${fmtDay(t0)}`);
    note.innerHTML = `· ${total} not shown (${parts.join(', ')})`;
    note.title = `${total} confirmed cases not shown — ${parts.join(', ')}`;
    note.style.display = '';
  }

  // Summary card for the brushed window — recomputed in render(), so it tracks the window and
  // the geographic scope automatically. Hidden when no window is set.
  function updateWindowSummary() {
    if (!win) { summary.style.display = 'none'; return; }
    const lo = Math.min(win.d0, win.d1), hi = Math.max(win.d0, win.d1);
    const inWin = (v) => { const t = +new Date(v); return !isNaN(t) && t >= lo && t <= hi; };
    let cases = 0; for (const [ds, n] of series) if (inWin(ds)) cases += n;
    let seq = 0;   for (const tp of selTips) if (inWin(tp.date)) seq++;
    const days = Math.max(1, Math.round((hi - lo) / 86400000));
    const seqPct = cases ? Math.round((seq / cases) * 100) : null;
    summary.innerHTML =
      `<div class="ws-range">${fmtDay(lo)} – ${fmtDay(hi)} · ${days} d</div>` +
      `<div class="ws-cases"><b>${cases}</b> confirmed case${cases === 1 ? '' : 's'}</div>` +
      `<div class="ws-seq"><b>${seq}</b> sequence${seq === 1 ? '' : 's'}${seqPct == null ? '' : ` (${seqPct}% of cases)`}</div>`;
    summary.style.display = '';
  }

  // Bars come straight from the resolved daily series, clipped to the (possibly extended) axis.
  function aggregate() {
    const byDay = new Map();
    for (const [ds, n] of series) {
      if (!n) continue;
      const t = +new Date(ds);
      if (isNaN(t) || t < t0 || t > effMaxMs) continue;
      byDay.set(ds, n);
    }
    return byDay;   // Map<dateStr, confirmed count>
  }

  function seqByDate() {
    const m = new Map();
    for (const tp of selTips) {
      const ts = +new Date(tp.date);
      if (isNaN(ts) || ts < t0 || ts > t1) continue;
      m.set(tp.date, (m.get(tp.date) || 0) + 1);
    }
    return m;
  }

  function buildScale(W) {
    if (transform && transform.maxX > 0) {
      const x1 = transform.offsetX + transform.maxX * transform.scaleX;
      return scaleFromAnchors({ date0: domain.minDate, x0: transform.offsetX, date1: domain.maxDate, x1 });
    }
    return createTimeScale({ minDate: domain.minDate, maxDate: domain.maxDate, width: W, padLeft: PAD.left, padRight: PAD.right });
  }

  function drawMarkers() {
    if (!markerLayer) return;
    markerLayer.replaceChildren();
    for (const d of markerDates) {
      if (!d) continue;
      const x = scale.dateToX(d);
      markerLayer.appendChild(el('line', {
        x1: x, y1: PAD.top, x2: x, y2: H - PAD.bottom,
        stroke: SEL_MARKER_COLOR, 'stroke-width': 1.2, 'stroke-dasharray': '4 3', 'stroke-opacity': 0.9,
      }));
    }
  }

  function render() {
    const W = host.clientWidth || 400;
    H = host.clientHeight || 200;
    holder.replaceChildren();

    const svg = el('svg', { width: W, height: H });
    holder.appendChild(svg);

    scale = buildScale(W);
    const baseY = H - PAD.bottom;
    const xMin = scale.dateToX(domain.minDate);
    const dx = (d) => scale.dateToX(d);   // uniform scale; beyond-fill is handled by the tree fraction
    const xMax = dx(new Date(effMaxMs));   // extends past the tree when showBeyond

    const byDay = aggregate();
    seqMap = seqByDate();
    let yMax = 1;
    for (const n of byDay.values()) if (n > yMax) yMax = n;
    // Reserve a band below the legend for the sequence-availability dot track (blue) when the
    // current scope has sequences; the bars start below it so no line crosses them.
    const trackY = PAD.top + 24;                          // sequences (blue)
    const plotTop = trackY + 8;
    const plotH = baseY - plotTop;
    const yToPx = (v) => baseY - (v / yMax) * plotH;
    const barW = Math.max(1, Math.abs(scale.dateToX(new Date(t0 + DAY_MS)) - xMin) - 1);

    for (const v of [...new Set([0, Math.round(yMax / 2), yMax])]) {
      const y = yToPx(v);
      svg.appendChild(el('line', { x1: PAD.left, y1: y, x2: xMax, y2: y, stroke: '#eee', 'stroke-width': 1 }));
      const lbl = el('text', { x: PAD.left - 4, y: y + 3, 'font-size': 9, fill: '#9c968b', 'text-anchor': 'end' });
      lbl.textContent = String(v);
      svg.appendChild(lbl);
    }

    svg.appendChild(el('line', { x1: xMin, y1: baseY, x2: xMax, y2: baseY, stroke: '#c9c7c2', 'stroke-width': 1 }));
    for (const { date, fmt } of timeTicks(Math.abs(xMax - xMin), t0, effMaxMs)) {
      const tx = dx(date);
      if (tx < PAD.left - 1 || tx > W - 2) continue;        // keep labels inside the plot
      svg.appendChild(el('line', { x1: tx, y1: baseY, x2: tx, y2: baseY + 3, stroke: '#c9c7c2', 'stroke-width': 1 }));
      const lbl = el('text', { x: tx, y: baseY + 13, 'font-size': 9, fill: '#9c968b', 'text-anchor': 'middle' });
      lbl.textContent = date.toLocaleDateString('en-GB', fmt);
      svg.appendChild(lbl);
    }

    // Brushed time-window band (behind the bars; persists across re-renders, tracks the scale).
    if (win) {
      const bx0 = dx(new Date(win.d0)), bx1 = dx(new Date(win.d1));
      svg.appendChild(el('rect', { x: Math.min(bx0, bx1), y: PAD.top, width: Math.max(1, Math.abs(bx1 - bx0)),
        height: baseY - PAD.top, fill: 'rgba(124,29,29,0.10)', stroke: 'rgba(124,29,29,0.45)', 'stroke-width': 1, 'pointer-events': 'none' }));
    }

    for (const [dateStr, count] of byDay) {
      if (!count) continue;
      const x = dx(dateStr) - barW / 2;
      const h = (count / yMax) * plotH;
      svg.appendChild(el('rect', { x, y: baseY - h, width: barW, height: h, fill: CONFIRMED_COLOR }));
    }

    // Sequence-availability track: a dashed blue line + circles sized by #sequences/day.
    // Hidden entirely when the current scope has no sequences.
    if (seqMap.size) {
      svg.appendChild(el('line', {
        x1: xMin, y1: trackY, x2: xMax, y2: trackY,
        stroke: SEQ_COLOR, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'stroke-opacity': 0.5,
      }));
      for (const [dateStr, n] of seqMap) {
        const cx = dx(dateStr);
        if (cx < PAD.left - 1 || cx > W - 1) continue;
        const r = Math.min(6, 2 + 1.6 * Math.sqrt(n));
        svg.appendChild(el('circle', { cx, cy: trackY, r, fill: SEQ_COLOR, 'fill-opacity': 0.45 }));
      }
    }

    markerLayer = el('g', {});
    svg.appendChild(markerLayer);
    drawMarkers();

    // transparent per-day hit-areas (full height: track + bars) drive the hover tooltip;
    // include sequence-only dates so their circles are hoverable too.
    const dayPx = Math.abs(scale.dateToX(new Date(t0 + DAY_MS)) - xMin);
    for (const dateStr of new Set([...byDay.keys(), ...seqMap.keys()])) {
      const count = byDay.get(dateStr) || 0;
      const hit = el('rect', {
        x: dx(dateStr) - dayPx / 2, y: PAD.top,
        width: Math.max(2, dayPx), height: baseY - PAD.top, fill: 'transparent',
      });
      hit.addEventListener('mousemove', (ev) => showTip(ev, dateStr, count));
      svg.appendChild(hit);
    }
    svg.addEventListener('mouseleave', hideTip);

    updateNote();
    updateWindowSummary();
    // Share the effective x-axis transform (tree's, or the beyond-mode compressed prediction) so
    // the Ne panel stays aligned even when the phylogeny is collapsed and can't emit its own.
    if (transform) onTransform(transform);
  }

  // Horizontal brush: drag on the chart to pick a time window; a click (tiny drag) clears it.
  // Listeners live on `holder` (persistent) since the svg is rebuilt each render; a live <rect>
  // is drawn directly during the drag (no re-render), finalised on mouseup.
  let drag = null;   // { x0, rect } while dragging
  const relX = (ev) => ev.clientX - holder.getBoundingClientRect().left;
  holder.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0 || !scale) return;
    hideTip();
    const svgEl = holder.querySelector('svg');
    const rect = svgEl ? el('rect', { x: relX(ev), y: PAD.top, width: 0, height: H - PAD.bottom - PAD.top,
      fill: 'rgba(124,29,29,0.10)', stroke: 'rgba(124,29,29,0.45)', 'stroke-width': 1, 'pointer-events': 'none' }) : null;
    if (rect && svgEl) svgEl.appendChild(rect);
    drag = { x0: relX(ev), rect };
    ev.preventDefault();
  });
  window.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    const x = relX(ev), xl = Math.min(drag.x0, x), w = Math.abs(x - drag.x0);
    if (drag.rect) { drag.rect.setAttribute('x', xl); drag.rect.setAttribute('width', Math.max(0, w)); }
  });
  window.addEventListener('mouseup', (ev) => {
    if (!drag) return;
    const next = brushWindow(drag.x0, relX(ev), scale);
    drag = null;
    win = next;
    onWindowChange(next ? next.d0 : null, next ? next.d1 : null);
    render();   // draw the persistent band (or none) and drop the live rect
  });

  render();
  // On resize the width changes → calibration resets and the tree refits (→ setTransform), so
  // re-sync the fraction for the new width rather than just re-rendering at the stale one.
  const ro = new ResizeObserver(() => applyExtent());
  ro.observe(host);

  // Re-resolve the daily series + sequence tips for the current scope, then recompute the extent.
  function reresolve() {
    resolved = resolveSeries(scope); series = resolved.series; selTips = resolved.tips;
    const scopeEl = document.getElementById('dist-scope');
    if (scopeEl) scopeEl.textContent = scope.zones.length ? `· ${scope.zones.join(', ')}` : scope.province ? `· ${scope.province}` : '';
    if (clearBtn) clearBtn.style.visibility = scope.zones.length ? 'visible' : 'hidden';   // reserve space; toggle paint only
    applyExtent();
  }
  function setProvince(name) { scope = { zones: [], province: name || null }; if (provSel.value !== (name || '')) provSel.value = name || ''; reresolve(); }
  function setZones(zones) {
    const zs = [...new Set(zones || [])];
    scope = zs.length ? { zones: zs, province: null } : { zones: [], province: scope.province };
    if (zs.length && provSel.value !== '') provSel.value = '';
    // A map/tree location selection overrides province scope, so disable the selector while one is
    // active (re-enabled when the selection is cleared → setZones([])).
    provSel.disabled = zs.length > 0;
    reresolve();
  }

  return {
    setMarkers(dates) { markerDates = (dates || []).filter(Boolean); drawMarkers(); },
    /** Set (or clear) the brushed time window from an external source (e.g. the Ne panel's brush),
     *  without re-emitting onWindowChange. `d0`/`d1` are ms, or null to clear. */
    setWindow(d0, d1) {
      win = (d0 != null && d1 != null) ? { d0: +d0, d1: +d1 } : null;
      updateWindowSummary();
      render();
    },
    setTransform(t) {
      // Ignore degenerate transforms (e.g. the tree panel is collapsed → 0-size canvas emits
      // maxX>0 but scaleX≈0). Accepting one would collapse the x-scale onto a single column and
      // the histogram would vanish — and latch, so it would stay gone after expanding. Keep the
      // last good transform instead; the chart's own ResizeObserver still re-renders on height
      // changes, so it stays correct while the tree is minimised.
      if (!isUsableTransform(t)) return;
      transform = t;
      // Learn the tree's geometry at the fraction we last asked for, then re-evaluate the desired
      // fraction (the first beyond toggle sends f0, this second pass solves the corrected φ).
      recordCalib(lastF, transform);
      if (autoCorr < 4) { const prev = lastF; syncTreeFraction(); if (lastF !== prev) autoCorr++; }
      render();
    },
    /** Filter the bars + sequence track to a set of health zones ([] = clear to province/national). */
    setZones,
    /** Filter to a province ('' / null = national); clears any zone selection. */
    setProvince,
  };
}
