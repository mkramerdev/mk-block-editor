/** Canonical editor text offsets count Unicode code points, not UTF-16 units. */
export function canonicalTextLength(text: string): number {
  return Array.from(text).length;
}

/** Converts a canonical code-point offset to a DOM text-node UTF-16 offset. */
export function canonicalOffsetToUtf16Offset(
  text: string,
  canonicalOffset: number,
): number {
  const target = Math.max(0, Math.trunc(canonicalOffset));
  let codePoints = 0;
  let utf16Offset = 0;
  for (const character of text) {
    if (codePoints >= target) break;
    codePoints += 1;
    utf16Offset += character.length;
  }
  return utf16Offset;
}
