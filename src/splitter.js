// A draggable divider that splits two sibling flex panes *proportionally*.
// Dragging sets each pane's flex-grow to its pixel size, so the panes keep their
// ratio as the container (window) resizes — both respond to the divider AND to
// browser-size changes.
//
// Uses Pointer Events with setPointerCapture so the drag keeps receiving moves
// even when the pointer passes over the tree canvas or the Leaflet map (which
// otherwise capture mouse events and freeze a plain window-listener drag).

/**
 * @param {HTMLElement} gutterEl  the divider element between the two panes
 * @param {HTMLElement} beforeEl  pane before the gutter (left / top)
 * @param {HTMLElement} afterEl   pane after the gutter (right / bottom)
 * @param {'x'|'y'} axis          'x' → widths, 'y' → heights
 * @param {{minBefore?:number,minAfter?:number}} [opts]  per-pane min size in px
 */
export function makeSplitter(gutterEl, beforeEl, afterEl, axis, opts = {}) {
  const isX = axis === 'x';
  const minBefore = opts.minBefore ?? 120;   // px, smallest the before pane may become
  const minAfter  = opts.minAfter  ?? 120;   // px, smallest the after pane may become

  const onMove = (e) => {
    const c = beforeEl.parentElement.getBoundingClientRect();
    const g = gutterEl.getBoundingClientRect();
    const total = (isX ? c.width : c.height) - (isX ? g.width : g.height);
    const pointer = (isX ? e.clientX - c.left : e.clientY - c.top);
    const before = Math.max(minBefore, Math.min(total - minAfter, pointer));
    beforeEl.style.flex = `${before} 1 0`;
    afterEl.style.flex  = `${total - before} 1 0`;
  };

  const onUp = (e) => {
    try { gutterEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    gutterEl.classList.remove('dragging');
    document.body.style.cursor = '';
    gutterEl.removeEventListener('pointermove', onMove);
    gutterEl.removeEventListener('pointerup', onUp);
    gutterEl.removeEventListener('pointercancel', onUp);
  };

  gutterEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    gutterEl.setPointerCapture(e.pointerId);
    gutterEl.classList.add('dragging');
    document.body.style.cursor = isX ? 'col-resize' : 'row-resize';
    gutterEl.addEventListener('pointermove', onMove);
    gutterEl.addEventListener('pointerup', onUp);
    gutterEl.addEventListener('pointercancel', onUp);
  });
}

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
      // MEASURE all first, THEN set all: doing it in one interleaved pass reflows mid-loop — a pane
      // given a pixel grow while its siblings still hold their small unitless CSS grow balloons to
      // fill the column, which both jumps the layout and corrupts the remaining measurements.
      const heights = panes.map((p) => (p.classList.contains('collapsed') ? null : p.getBoundingClientRect().height));
      panes.forEach((p, i) => { if (heights[i] != null) p.style.flex = `${heights[i]} 1 0`; });
      beforeH = heights[j]; combined = heights[j] + heights[j + 1]; startY = e.clientY;
      gutter.setPointerCapture(e.pointerId);
      gutter.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      gutter.addEventListener('pointermove', onMove);
      gutter.addEventListener('pointerup', onUp);
      gutter.addEventListener('pointercancel', onUp);
    });
  });
}
