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
      buttonDisabled: [false, false, true],   // only the lone expanded pane (idx 2) cannot be collapsed
    });
  });

  it('still works for a two-pane group', () => {
    expect(collapseGroupState([true, false])).toEqual({
      gutterDisabled: [true],
      buttonDisabled: [false, true],
    });
  });
});
