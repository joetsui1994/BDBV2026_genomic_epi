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
