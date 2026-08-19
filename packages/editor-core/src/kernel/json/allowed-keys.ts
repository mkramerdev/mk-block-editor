export function validateAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): string[] {
  const allowed = new Set(allowedKeys);
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .sort()
    .map((key) =>
      label ? `${label}.${key} is not supported` : `${key} is not supported`,
    );
}
