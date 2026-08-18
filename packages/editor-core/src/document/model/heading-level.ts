export const MIN_HEADING_LEVEL = 1;
export const MAX_HEADING_LEVEL = 6;
export const DEFAULT_HEADING_LEVEL = 1;

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** Normalizes product-owned heading metadata for every presentation boundary. */
export function normalizeHeadingLevel(value: unknown): HeadingLevel {
  let numeric: number;
  try {
    numeric = Number(value ?? DEFAULT_HEADING_LEVEL);
  } catch {
    return DEFAULT_HEADING_LEVEL;
  }
  if (!Number.isFinite(numeric)) return DEFAULT_HEADING_LEVEL;
  return Math.min(
    MAX_HEADING_LEVEL,
    Math.max(MIN_HEADING_LEVEL, Math.trunc(numeric)),
  ) as HeadingLevel;
}
