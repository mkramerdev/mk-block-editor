/** Increments string metadata versions while preserving non-numeric fallback behavior. */
export function incrementVersion(value: string): string {
  const version = Number(value);
  return Number.isFinite(version) ? String(version + 1) : "2";
}
