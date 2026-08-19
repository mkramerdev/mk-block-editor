import { useCallback, useRef, useSyncExternalStore } from "react";
import type { EditorExternalStore, EditorSessionState } from "./contracts.ts";

export type EditorStoreSelectorEquality<T> = (previous: T, next: T) => boolean;

export function useEditorStoreSelector<T>(
  store: EditorExternalStore,
  selector: (state: EditorSessionState) => T,
  getServerSnapshot?: () => EditorSessionState,
  isEqual: EditorStoreSelectorEquality<T> = Object.is,
): T {
  const selectedRef = useRef<{ value: T } | null>(null);
  const selectStable = (state: EditorSessionState): T => {
    const next = selector(state);
    const previous = selectedRef.current;
    if (previous && isEqual(previous.value, next)) return previous.value;
    selectedRef.current = { value: next };
    return next;
  };
  const subscribe = useCallback(
    (listener: () => void) =>
      store.subscribeSelector
        ? store.subscribeSelector(selector, isEqual, listener)
        : store.subscribe(listener),
    [isEqual, selector, store],
  );

  return useSyncExternalStore(
    subscribe,
    () => selectStable(store.getSnapshot()),
    () => selectStable(getServerSnapshot?.() ?? store.getSnapshot()),
  );
}
