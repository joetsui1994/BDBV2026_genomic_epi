// Effective population size panel: one or more inferred Ne trajectories (median line + 95% HPD
// ribbon) over a shared log-y / calendar-x axis. Each dataset (e.g. SkyGrid, exponential growth)
// has its own colour and a header toggle; at least one stays visible. The x-axis is locked to the
// phylogeny's live view transform and shares its brushed window + selected-tip markers. A header
// control reveals the full time extent while hovered.
import { logTicks, niceLogRange, fmtNe } from './log-scale.js';
import { scaleFromAnchors } from './time-scale.js';
import { brushWindow, isUsableTransform } from './timeseries-panel.js';

const SVNS = 'http://www.w3.org/2000/svg';
const PAD = { left: 42, right: 12, top: 12, bottom: 22 };
const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const WIN_FILL = 'rgba(124,29,29,0.10)'; // shared brushed-window highlight (matches tree/map/dist)
const WIN_STROKE = 'rgba(124,29,29,0.45)';
const SEL_MARKER_COLOR = '#f2c84b';      // selected-tip date markers (matches the distribution panel)

const el = (name, attrs) => {
  const n = document.createElementNS(SVNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const fmtDay = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * @param {string} containerId  the panel body element id ('ne-body')
 * @param {{key:string,label:string,color:string,band:string,data:object,toggleId?:string}[]} datasets
 *   each `data` is a parsed public/data/<model>.json (points + cutOffYears + mostRecentDate)
 * @param {{minDate:string,maxDate:string}} domain  tree window (root -> most-recent)
 * @param {{revealButtonId?:string, onWindowChange?:(d0:?number,d1:?number)=>void}} [opts]
 */
export function createNePanel(containerId, datasets, domain, { revealButtonId, onWindowChange = () => {} } = {}) {
  const host = document.getElementById(containerId);
  host.replaceChildren();
  const holder = document.createElement('div');
  holder.className = 'ne-svg';
  const tip = document.createElement('div');
  tip.className = 'ne-tip';
  tip.style.display = 'none';
  host.append(holder, tip);

  // Prepare each dataset: mapped points + visibility flag + its header toggle button.
  for (const ds of datasets) {
    ds.pts = ds.data.points.map((p) => ({ t: +new Date(p.date), med: p.neMedian, lo: p.neLower, hi: p.neUpper }));
    ds.visible = true;
  }

  const treeMin = +new Date(domain.minDate), treeMax = +new Date(domain.maxDate);
  const fullMax = +new Date(datasets[0].data.mostRecentDate);
  const fullMin = fullMax - Math.max(...datasets.map((d) => d.data.cutOffYears)) * YEAR_MS;

  // Fixed y-domain from ALL datasets' ribbons within the default (tree) window, so toggling a
  // dataset never rescales the plot.
  const inTree = datasets.flatMap((d) => d.pts).filter((p) => p.t >= treeMin && p.t <= treeMax);
  const loData = Math.min(...inTree.map((p) => p.lo).filter((v) => v > 0));
  const hiData = Math.max(...inTree.map((p) => p.hi));
  const [yMin, yMax] = niceLogRange(loData, hiData);

  let W = 0, H = 0;
  let reveal = 0;          // 0 = tree-locked scale, 1 = full extent (eased on hover)
  let transform = null;    // the tree's view transform (aligns x with the phylogeny)
  let win = null;          // shared brushed window { d0, d1 } in ms, or null
  let markerDates = [];    // selected-tip dates (ms) → yellow vertical dashed lines
  let scale = null;        // current date<->x scale (rebuilt each render)

  const treeX0 = () => (transform ? transform.offsetX : PAD.left);
  const treeX1 = () => (transform ? transform.offsetX + transform.maxX * transform.scaleX : W - PAD.right);
  const fullX = (t) => PAD.left + ((t - fullMin) / (fullMax - fullMin)) * (W - PAD.left - PAD.right);
  function buildScale() {
    const x0 = treeX0() * (1 - reveal) + fullX(treeMin) * reveal;
    const x1 = treeX1() * (1 - reveal) + fullX(treeMax) * reveal;
    return scaleFromAnchors({ date0: treeMin, x0, date1: treeMax, x1 });
  }
  const yOf = (ne) => {
    const lo = Math.log10(yMin), hi = Math.log10(yMax);
    const v = Math.log10(Math.max(ne, Number.MIN_VALUE));
    return (H - PAD.bottom) - ((v - lo) / (hi - lo)) * ((H - PAD.bottom) - PAD.top);
  };
  const dateTicks = () => {
    const dL = +scale.xToDate(PAD.left), dR = +scale.xToDate(W - PAD.right);
    const n = Math.max(2, Math.min(6, Math.floor((W - PAD.left) / 80)));
    return Array.from({ length: n + 1 }, (_, i) => dL + ((dR - dL) * i) / n);
  };

  function render() {
    W = host.clientWidth || 360; H = host.clientHeight || 160;
    scale = buildScale();
    holder.replaceChildren();
    const svg = el('svg', { width: W, height: H });
    holder.appendChild(svg);

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
      const x = scale.dateToX(t);
      if (x < PAD.left - 1 || x > W - PAD.right + 1) continue;
      svg.appendChild(el('line', { x1: x, y1: baseY, x2: x, y2: baseY + 3, stroke: '#c9c7c2', 'stroke-width': 1 }));
      const lbl = el('text', { x, y: baseY + 13, 'font-size': 9, fill: '#9c968b', 'text-anchor': 'middle' });
      lbl.textContent = fmtDay(t);
      svg.appendChild(lbl);
    }

    const g = el('g', { 'clip-path': 'url(#ne-clip)' });
    // each visible dataset: HPD ribbon then median line
    for (const ds of datasets) {
      if (!ds.visible) continue;
      let d = '';
      ds.pts.forEach((p, i) => { d += `${i ? 'L' : 'M'}${scale.dateToX(p.t)},${yOf(p.hi)} `; });
      for (let i = ds.pts.length - 1; i >= 0; i--) d += `L${scale.dateToX(ds.pts[i].t)},${yOf(ds.pts[i].lo)} `;
      g.appendChild(el('path', { d: `${d}Z`, fill: ds.band, stroke: 'none' }));
      let m = '';
      ds.pts.forEach((p, i) => { m += `${i ? 'L' : 'M'}${scale.dateToX(p.t)},${yOf(p.med)} `; });
      g.appendChild(el('path', { d: m, fill: 'none', stroke: ds.color, 'stroke-width': 1.6 }));
    }

    // shared brushed window highlight
    if (win) {
      const bx0 = scale.dateToX(win.d0), bx1 = scale.dateToX(win.d1);
      g.appendChild(el('rect', {
        x: Math.min(bx0, bx1), y: PAD.top, width: Math.max(1, Math.abs(bx1 - bx0)), height: baseY - PAD.top,
        fill: WIN_FILL, stroke: WIN_STROKE, 'stroke-width': 1, 'pointer-events': 'none',
      }));
    }
    // selected-tip date markers (yellow dashed, matches the distribution panel)
    for (const t of markerDates) {
      const x = scale.dateToX(t);
      g.appendChild(el('line', {
        x1: x, y1: PAD.top, x2: x, y2: baseY,
        stroke: SEL_MARKER_COLOR, 'stroke-width': 1.2, 'stroke-dasharray': '4 3', 'stroke-opacity': 0.9, 'pointer-events': 'none',
      }));
    }
    svg.appendChild(g);

    svg.addEventListener('mousemove', onMove);
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }

  const nearest = (pts, dateMs) => {
    let best = null, bd = Infinity;
    for (const p of pts) { const dd = Math.abs(p.t - dateMs); if (dd < bd) { bd = dd; best = p; } }
    return best;
  };
  function onMove(ev) {
    if (drag) return;
    const mx = ev.clientX - holder.getBoundingClientRect().left;
    const vis = datasets.filter((d) => d.visible);
    if (!vis.length || mx < PAD.left || mx > W - PAD.right) { tip.style.display = 'none'; return; }
    const dateMs = +scale.xToDate(mx);
    let html = `<div class="ne-tip-d">${fmtDay(dateMs)}</div>`;
    for (const ds of vis) {
      const p = nearest(ds.pts, dateMs);
      if (!p) continue;
      html += `<div><span class="ne-tip-k" style="color:${ds.color}">${ds.label}</span> <b>${p.med.toPrecision(3)}</b>`
        + ` <span class="ne-tip-ci">(${p.lo.toPrecision(2)}–${p.hi.toPrecision(2)})</span></div>`;
    }
    tip.innerHTML = html;
    tip.style.display = '';
    tip.style.left = `${Math.min(mx + 8, W - 130)}px`;
    tip.style.top = `${PAD.top + 4}px`;
  }

  // Horizontal brush: drag to pick a time window; a click clears it. Emits the shared window.
  let drag = null;
  const relX = (ev) => ev.clientX - holder.getBoundingClientRect().left;
  holder.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0 || !scale) return;
    tip.style.display = 'none';
    const svgEl = holder.querySelector('svg');
    const rect = svgEl ? el('rect', { x: relX(ev), y: PAD.top, width: 0, height: H - PAD.bottom - PAD.top,
      fill: WIN_FILL, stroke: WIN_STROKE, 'stroke-width': 1, 'pointer-events': 'none' }) : null;
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
    onWindowChange(next ? next.d0 : null, next ? next.d1 : null);
  });

  // reveal animation: ease `reveal` (hence the x-scale) between tree-locked and full extent
  let raf = 0;
  function animateTo(target) {
    const s = reveal, dur = 260, t0 = performance.now();
    cancelAnimationFrame(raf);
    const stepFn = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      reveal = s + (target - s) * e;
      render();
      if (k < 1) raf = requestAnimationFrame(stepFn);
    };
    raf = requestAnimationFrame(stepFn);
  }
  if (revealButtonId) {
    const btn = document.getElementById(revealButtonId);
    if (btn) {
      btn.addEventListener('pointerenter', () => animateTo(1));
      btn.addEventListener('pointerleave', () => animateTo(0));
      btn.addEventListener('focus', () => animateTo(1));
      btn.addEventListener('blur', () => animateTo(0));
    }
  }

  // Per-dataset visibility toggles (at least one stays on).
  const styleToggle = (ds) => {
    const b = ds.btn; if (!b) return;
    b.classList.toggle('active', ds.visible);
    b.style.color = ds.visible ? ds.color : '';
    b.style.borderColor = ds.visible ? ds.color : '';
    b.style.background = ds.visible ? ds.band : '';
    b.setAttribute('aria-pressed', String(ds.visible));
  };
  for (const ds of datasets) {
    ds.btn = ds.toggleId ? document.getElementById(ds.toggleId) : null;
    if (!ds.btn) continue;
    styleToggle(ds);
    ds.btn.addEventListener('click', (e) => {
      e.preventDefault();
      const visCount = datasets.filter((d) => d.visible).length;
      if (ds.visible && visCount <= 1) return;   // keep at least one dataset visible
      ds.visible = !ds.visible;
      styleToggle(ds);
      render();
    });
  }

  const ro = new ResizeObserver(render);
  ro.observe(host);
  render();

  return {
    /** Align the x-axis to the phylogeny's live view transform. */
    setTransform(t) { if (isUsableTransform(t)) { transform = t; render(); } },
    /** Draw (or clear) the shared brushed time window. `d0`/`d1` are ms, or null to clear. */
    setWindow(d0, d1) { win = (d0 != null && d1 != null) ? { d0: +d0, d1: +d1 } : null; render(); },
    /** Vertical dashed markers at the selected tips' dates (Date[] or ms[]); [] clears them. */
    setMarkers(dates) { markerDates = (dates || []).filter(Boolean).map((d) => +new Date(d)); render(); },
    revealFull: () => animateTo(1),
    reset: () => animateTo(0),
  };
}
