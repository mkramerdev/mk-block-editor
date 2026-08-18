export function getOrCreateEditorListenerSet<Key>(
  listenersByKey: Map<Key, Set<() => void>>,
  key: Key,
): Set<() => void> {
  const existing = listenersByKey.get(key);
  if (existing) return existing;
  const listeners = new Set<() => void>();
  listenersByKey.set(key, listeners);
  return listeners;
}

export function noop(): void {
  return undefined;
}
