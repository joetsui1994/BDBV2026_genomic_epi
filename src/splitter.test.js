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
