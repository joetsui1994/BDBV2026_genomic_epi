// src/panel-collapse.js
// Minimise/expand the vertically-stacked, gutter-separated panels in a column (here the
// Phylogeny + Sample-distribution pair). Collapsing shrinks a panel to just its header bar
// (its body is hidden via the `.collapsed` class in CSS); the sibling then flexes to fill.
//
// Two invariants are enforced across the group:
//   1. At least one panel stays expanded — the collapse button of the sole expanded panel
//      is disabled, so you can never collapse them all.
//   2. The divider is only draggable when every panel is expanded — resizing a header-only
//      panel is meaningless, so the gutter is locked (pointer-events off) while any is collapsed.
//
// A panel's flex-grow and min-height are driven inline so this wins over both the stylesheet's
// `#tree`/`#timeseries { flex; min-height }` and any inline flex a gutter drag left behind,
// without a specificity fight. Expanding restores the panel's previous flex sizing.

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
    // Disable an expanded panel's collapse button when it is the only one still expanded
    // (collapsing it would leave none) — a collapsed panel's button stays enabled so it can expand.
    buttonDisabled: collapsed.map((c) => !c && expandedCount === 1),
  };
}

/**
 * @param {object} opts
 * @param {{ panel: HTMLElement, button: HTMLButtonElement }[]} opts.panels  the stacked panels + their header toggles
 * @param {HTMLElement[]} [opts.gutters]  dividers between adjacent panels; gutters[j] sits between
 *   panels[j] and panels[j+1] and is locked while either neighbour is collapsed.
 */
export function makeCollapsibleColumn({ panels, gutters = [] }) {
  const collapsed = panels.map(() => false);
  const saved = panels.map(() => ({ flex: '', minH: '' }));

  const applyPanel = (i) => {
    const { panel, button } = panels[i];
    const c = collapsed[i];
    panel.classList.toggle('collapsed', c);
    button.classList.toggle('collapsed', c);
    button.setAttribute('aria-expanded', String(!c));
    button.textContent = c ? '▶' : '▼';
  };

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

  panels.forEach(({ panel, button }, i) => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (button.disabled) return;   // invariant: can't collapse the last expanded panel
      collapsed[i] = !collapsed[i];
      if (collapsed[i]) {
        saved[i].flex = panel.style.flex;
        saved[i].minH = panel.style.minHeight;
        panel.style.flex = '0 0 auto';
        panel.style.minHeight = '0';
      } else {
        panel.style.flex = saved[i].flex;
        panel.style.minHeight = saved[i].minH;
      }
      applyPanel(i);
      syncPolicy();
      // The tree (PearTree) and chart size themselves off their container; nudge them to re-fit
      // now the column heights changed. Their ResizeObservers also fire, but a window resize
      // covers any consumer that only listens to that.
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
    applyPanel(i);
  });

  syncPolicy();
}
