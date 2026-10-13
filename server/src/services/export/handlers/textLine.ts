/**
 * Text export helpers.
 *
 * Text export formats are line-oriented, so any user-controlled value that
 * contains a line break could inject extra lines (for example a forged
 * `Policy:` line). Collapse line breaks before interpolating.
 */

/**
 * Replace CRLF and every other line terminator (CR, LF, VT, FF, NEL, U+2028,
 * U+2029) with a single space. An absent optional field renders as an empty
 * string.
 */
export function singleLine(value: string | undefined): string {
  return (value ?? '').replace(/\r\n|[\r\n\v\f\u0085\u2028\u2029]/g, ' ');
}
