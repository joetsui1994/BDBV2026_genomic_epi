// Pure line-list privacy filter: keep only positive cases. Shared by the `data:linelist` script
// (cleans the committed public/data CSVs) and the Vite build plugin (filters the deployed copy),
// so no non-positive individual records can be published. Unit-tested in linelist-lib.test.js.
//
// These line lists have no quoted fields containing commas, so a naive split is safe.

/** Return `csvText` with only the header and rows whose `status` column is 'Positive'.
 *  Idempotent. A CSV without a `status` column is returned unchanged. Trailing newline preserved. */
export function filterCsvToPositives(csvText) {
  const eol = csvText.includes('\r\n') ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(csvText);
  const lines = csvText.replace(/\r?\n$/, '').split(/\r?\n/);
  if (!lines.length || lines[0] === '') return csvText;
  const s = lines[0].split(',').indexOf('status');
  if (s < 0) return csvText;   // not a status-bearing line list — leave untouched
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] && lines[i].split(',')[s] === 'Positive') out.push(lines[i]);
  }
  return out.join(eol) + (trailing ? eol : '');
}
