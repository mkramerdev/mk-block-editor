import type {
  EditorExternalStore,
  EditorSessionState,
  EditorStoreListener,
  EditorStoreSelectorEquality,
} from "./contracts.ts";

export function createEditorExternalStore(
  initialState: EditorSessionState,
): EditorExternalStore {
  let state = initialState;
  const listeners = new Set<EditorStoreListener>();
  const selectorListeners = new Set<{
    selector: (state: EditorSessionState) => unknown;
    isEqual: EditorStoreSelectorEquality<unknown>;
    listener: EditorStoreListener;
    value: unknown;
  }>();

  const emit = () => {
    for (const listener of [...listeners]) {
      listener();
    }
    for (const entry of [...selectorListeners]) {
      const nextValue = entry.selector(state);
      if (entry.isEqual(entry.value, nextValue)) continue;
      entry.value = nextValue;
      entry.listener();
    }
  };

  return {
    getSnapshot() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeSelector(selector, isEqual, listener) {
      const entry = {
        selector: selector as (state: EditorSessionState) => unknown,
        isEqual: isEqual as EditorStoreSelectorEquality<unknown>,
        listener,
        value: selector(state),
      };
      selectorListeners.add(entry);
      return () => {
        selectorListeners.delete(entry);
      };
    },
    setState(updater) {
      const nextState = updater(state);
      if (Object.is(nextState, state)) return state;
      state = nextState;
      emit();
      return state;
    },
    replaceState(nextState) {
      if (Object.is(nextState, state)) return state;
      state = nextState;
      emit();
      return state;
    },
  };
}
