// Pure geometry for the phylogeny's shaded time-window band. No DOM — unit-tested in
// tree-band.test.js. The tree's date->x mapping puts the root (t0) at x0 and the most-recent
// tip (t1) at x0+span; the histogram/Ne panels share this mapping.

/**
 * Pixel [left, right] for a time window under the tree's date->x mapping, or null if invisible.
 * The window may extend *before* the root or *past* the most-recent tip: the right edge
 * extrapolates into the "beyond" strip, and the left edge extends toward the container's left
 * edge (clamped to 0) rather than stopping at the root — so a window selected before the root
 * (e.g. via the Ne panel's brush) is drawn to its true extent.
 * @param {number} d0 window start (ms)  @param {number} d1 window end (ms)
 * @param {number} t0 root date (ms)     @param {number} t1 most-recent date (ms)
 * @param {number} x0 root pixel x       @param {number} span pixel width root->present
 * @returns {[number, number] | null}
 */
export function bandPixels(d0, d1, t0, t1, x0, span) {
  if (t1 <= t0) return null;
  const dToX = (ms) => x0 + ((ms - t0) / (t1 - t0)) * span;
  const xL = Math.max(0, dToX(d0));
  const xR = dToX(d1);
  if (xR - xL < 0.5) return null;
  return [xL, xR];
}
