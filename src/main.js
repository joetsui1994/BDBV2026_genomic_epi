import './style.css';
import { createTreePanel } from './tree-panel.js';
import { createMapPanel } from './map-panel.js';
import { createTimeseriesPanel } from './timeseries-panel.js';
import { startCoordinator } from './coordinator.js';
import { createNodeInfo } from './node-info.js';
import { makeSplitter, makeColumnSplitters } from './splitter.js';
import { makeCollapsibleColumn } from './panel-collapse.js';
import { createNePanel } from './ne-panel.js';
import { tallyZones } from './zone-tally.js';
import { parseStatus, toZoneDaily } from './status-data.js';

// Parse the health-zone alias crosswalk (observed_name → canonical_nom) into a
// normaliser. Health-zone names in the mobility / tree data are mapped onto
// the geojson's canonical `Nom` so every source joins. Unknown names pass through.
// Columns: 0 observed_name, 1 canonical_nom, 2 source_dataset, 3 notes.
function makeCanon(text) {
  const map = new Map();
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [observed, canonical] = line.split(',');
    if (observed && canonical) map.set(observed.toUpperCase().trim(), canonical.trim());
  }
  return (name) => map.get((name || '').toUpperCase().trim()) || name;
}

// Parse the FlowMinder origin→destination matrix into per-zone flow lookups
// (keyed upper-case): outByZone[origin] = movement leaving, inByZone[dest] = arriving.
// Origin/dest names are normalised to canonical so they join the geojson centroids.
function parseMobilityMatrix(text, canon) {
  const lines = text.trim().split(/\r?\n/);
  const dests = lines[0].split(',').slice(1).map(canon);   // header: nom, dest1, dest2, …
  const outByZone = new Map(), inByZone = new Map();
  const add = (m, key, other, value) => {
    const k = key.toUpperCase().trim();
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ other, value });
  };
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const origin = canon(cells[0]);
    for (let j = 1; j < cells.length; j++) {
      const v = +cells[j];
      if (!(v > 0)) continue;
      add(outByZone, origin, dests[j - 1], v);          // origin → dest  (out of origin)
      add(inByZone, dests[j - 1], origin, v);           // origin → dest  (in to dest)
    }
  }
  return { outByZone, inByZone };
}

// Prefix runtime asset URLs with the Vite base so they resolve under the Pages
// subpath (BASE_URL is '/' in dev, '/DRC-Ebola-genomic-epi/' in the build).
const BASE = import.meta.env.BASE_URL;

const [tips, meta, statusText, aliasText, skygrid, exponential] = await Promise.all([
  fetch(`${BASE}data/ituri-tips.json`).then(r => r.json()),
  fetch(`${BASE}data/ituri-meta.json`).then(r => r.json()),
  fetch(`${BASE}data/status_confirmed.csv`).then(r => r.text()),   // derived aggregate (sole source)
  fetch(`${BASE}data/aliases.csv`).then(r => r.text()).catch(() => ''),   // crosswalk (optional)
  fetch(`${BASE}data/skygrid.json`).then(r => r.json()),
  fetch(`${BASE}data/exponential.json`).then(r => r.json()),
]);

const canon = makeCanon(aliasText);
const status = parseStatus(statusText);
const zoneDaily = toZoneDaily(status.zones);           // Map<UPPER Nom, Map<date,count>>
const { zoneCounts } = tallyZones(zoneDaily, null);    // seed per-zone confirmed totals
const up = (s) => (s || '').toUpperCase().trim();

// Zone → province (normalised) from the geojson, for filtering the sequence track under a province
// scope. Populated once the geojson loads (below); empty before then. Diacritics are stripped so the
// aggregate's province names (e.g. "Kasai") match the geojson's (e.g. "Kasaï").
const zoneProvince = new Map();   // UPPER Nom → normalised province
const normProv = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

// Sequence (tree-tip) dates for the sample-distribution availability track — zone
// canonicalised so they filter with the same selection as the bars.
const seqTips = tips.filter(t => t.date).map(t => ({
  date: t.date,
  health_zone: (t.health_zone && t.health_zone !== 'null') ? canon(t.health_zone) : '',
  health_area: (t.health_area && t.health_area !== 'null') ? t.health_area : '',
}));

// Histogram scope resolver: given a scope ({zones, province}), return the daily confirmed-case
// series — Map<date, {observed, imputed}>, split by onset-date imputation so the histogram can stack
// imputed on top — plus the sequence-track tips filtered to match. Zones merge (summing each split
// separately); province falls back to the province series; national is the default. The status maps
// already hold the {observed, imputed} split, so national/province are returned directly.
function resolveSeries(scope) {
  if (scope.zones && scope.zones.length) {
    const merged = new Map();
    const wanted = new Set(scope.zones.map(z => up(canon(z))));
    for (const z of wanted) {
      const dc = status.zones.get(z);
      if (dc) for (const [d, cell] of dc) {
        const cur = merged.get(d) || { observed: 0, imputed: 0 };
        merged.set(d, { observed: cur.observed + cell.observed, imputed: cur.imputed + cell.imputed });
      }
    }
    const tipsF = seqTips.filter(t => wanted.has(up(t.health_zone)));
    return { series: merged, tips: tipsF };
  }
  if (scope.province) {
    const dc = status.provinces.get(scope.province);
    const want = normProv(scope.province);
    const tipsF = seqTips.filter((t) => zoneProvince.get(up(t.health_zone)) === want);
    return { series: dc || new Map(), tips: tipsF };
  }
  return { series: status.national, tips: seqTips };
}

// Markers are built from the tips themselves (grouped by health_area → zone).
let tsPanel = null;
const map = createMapPanel('map-body', tips);

// Health-zone risk choropleth + mobility arrows (standalone layers, under the
// markers). Mobility loads after the risk layer because it reuses the zone
// centroids built there.
fetch(`${BASE}data/health-zones.geojson`)
  .then(r => r.json())
  .then(zones => {
    for (const f of zones.features) zoneProvince.set(up(f.properties.Nom), normProv(f.properties.PROVINCE));
    map.addZoneLayer(zones, zoneCounts, zoneDaily);
    return fetch(`${BASE}data/flowminder__inflow__static.matrix.csv`)
      .then(r => r.text())
      .then(text => map.addMobilityLayer(parseMobilityMatrix(text, canon)));
  })
  .catch(err => console.warn('risk/mobility layer not loaded:', err));
let treePanel = null;
let nePanel = null;
// Shared brushed time window: a brush in the distribution OR the Ne panel routes here, which
// highlights the same window across the map, tree, distribution and Ne panels.
function applyWindow(d0, d1) {
  map.setDateWindow(d0, d1);
  treePanel?.setTimeBand(d0, d1);
  tsPanel?.setWindow(d0, d1);
  nePanel?.setWindow(d0, d1);
}
let coordinator = null;   // late-bound below; lets the distribution panel's "clear" button drop the selection
const ts  = createTimeseriesPanel('timeseries-body', { minDate: meta.rootDate, maxDate: meta.mostRecentDate }, resolveSeries, {
  provinceNames: [...status.provinces.keys()],   // sequence-track tips flow through resolveSeries().tips, not an opt
  onDeselect: () => coordinator?.clearSelection(),   // "clear" button → same deselect as a map background click
  onExtentChange: (f) => treePanel?.setWidthFraction(f),
  onWindowChange: applyWindow,
  // Keep the Ne panel's x-axis aligned with the distribution's effective transform — this covers
  // "look beyond" mode even when the phylogeny is collapsed (the tree can't emit a transform then).
  onTransform: (t) => nePanel?.setTransform(t),
  // Hide the tree drawing (PearTree's #canvas-container — not its toolbar / status bar / palette)
  // while a relayout (tip labels / node-bars / legend) recalibrates the beyond width-fraction, so
  // its brief re-converge flicker is masked (the chart hides itself).
  onSettling: (on) => document.getElementById('canvas-container')?.classList.toggle('settling-hide', on),
});
tsPanel = ts;

// Effective population size — below the phylogeny; shares the tree x-axis + brush window. Two
// coalescent models overlaid, each toggleable (≥1 stays on): SkyGrid (green) + exponential (orange).
nePanel = createNePanel('ne-body', [
  { key: 'skygrid', label: 'SkyGrid', color: '#587e72', band: 'rgba(88,126,114,0.18)', data: skygrid, toggleId: 'ne-toggle-skygrid' },
  { key: 'exponential', label: 'Exp', color: '#c9772e', band: 'rgba(201,119,46,0.16)', data: exponential, toggleId: 'ne-toggle-exp' },
], { minDate: meta.rootDate, maxDate: meta.mostRecentDate }, {
  revealButtonId: 'ne-fullextent', onWindowChange: applyWindow,
});

const tree = await createTreePanel('tree-body', meta);
treePanel = tree;

// Floating node-info card pinned to the tree panel.
const nodeInfo = createNodeInfo('tree-body', { mostRecentDate: meta.mostRecentDate, canon });

coordinator = startCoordinator(tree, map, ts, meta, tips, canon, nodeInfo, nePanel);

// Lock the Ne panel's x-axis to the tree's live view transform (aligns it with the tree +
// distribution panels). Seed it with the current transform, then track every view change.
const seedTransform = tree.getViewTransform?.();
if (seedTransform) nePanel.setTransform(seedTransform);
tree.onViewChange?.((t) => nePanel.setTransform(t));

// Header "last updated" = latest commit touching public/data, injected at build
// time by Vite (see vite.config.js). Refreshes automatically on each deploy.
const luEl = document.getElementById('last-updated');
if (luEl) {
  luEl.textContent = new Date(__LAST_UPDATED__).toLocaleString('en-GB', {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

// Draggable dividers (proportional, so panes scale with the window too):
// vertical gutter splits left-column vs map; horizontal gutter splits tree vs
// time-series within the left column.
// Min widths match the #left / #map CSS min-width so the divider can't squash either side.
makeSplitter(document.getElementById('gutter-v'), document.getElementById('left'), document.getElementById('map'), 'x', { minBefore: 475, minAfter: 473 });
// Three-pane vertical column: phylogeny · Ne · sample distribution. Each gutter resizes only its
// two neighbours. The min heights MUST match the panels' CSS min-height (#tree 140, #ne 90,
// #timeseries 110): flexbox already keeps each pane ≥ its CSS min, so a larger value here would
// snap a pane up on the first drag (the tree's 3/7 share can start below an over-large min).
makeColumnSplitters(
  [document.getElementById('tree'), document.getElementById('ne'), document.getElementById('timeseries')],
  [document.getElementById('gutter-h'), document.getElementById('gutter-h2')],
  [140, 90, 110],
);

// Minimise/expand the three left-column panels down to their header bar. Managed as a group so
// at least one stays expanded and each divider locks while an adjacent panel is collapsed.
makeCollapsibleColumn({
  panels: [
    { panel: document.getElementById('tree'), button: document.getElementById('tree-collapse') },
    { panel: document.getElementById('ne'), button: document.getElementById('ne-collapse') },
    { panel: document.getElementById('timeseries'), button: document.getElementById('dist-collapse') },
  ],
  gutters: [document.getElementById('gutter-h'), document.getElementById('gutter-h2')],
});
