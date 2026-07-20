import { describe, it, expect } from 'vitest';
import { bandPixels } from './tree-band.js';

// date->x mapping used by the cases below: t0=100 -> x0=50 (root), t1=200 -> 150 (present),
// span=100. So dToX(ms) = 50 + (ms - 100).
const T0 = 100, T1 = 200, X0 = 50, SPAN = 100;

describe('bandPixels', () => {
  it('a window inside [root, present] maps within the tree', () => {
    expect(bandPixels(120, 180, T0, T1, X0, SPAN)).toEqual([70, 130]);
  });

  it('a window extending BEFORE the root reaches past the root position (regression)', () => {
    // time 50 maps to x=0; must NOT clamp to the root x (50).
    expect(bandPixels(50, 180, T0, T1, X0, SPAN)).toEqual([0, 130]);
  });

  it('clamps the left edge to the container edge (0) when the window starts off-screen left', () => {
    // time 0 -> x=-50 -> clamped to 0.
    expect(bandPixels(0, 150, T0, T1, X0, SPAN)).toEqual([0, 100]);
  });

  it('a window past the present extrapolates into the beyond strip (no upper clamp)', () => {
    expect(bandPixels(120, 250, T0, T1, X0, SPAN)).toEqual([70, 200]);
  });

  it('returns null when it would be invisible (degenerate or off-screen)', () => {
    expect(bandPixels(120, 120, T0, T1, X0, SPAN)).toBeNull();   // zero width
    expect(bandPixels(120, 180, T0, T0, X0, SPAN)).toBeNull();   // t1 <= t0
  });
});
