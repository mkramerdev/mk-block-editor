export interface EditorSessionState {
  blockGraphVersion: number;
  createdAt: number;
  updatedAt: number;
}

export type EditorStateUpdater = (
  state: EditorSessionState,
) => EditorSessionState;
export type EditorStoreListener = () => void;
export type EditorStoreSelectorEquality<T> = (previous: T, next: T) => boolean;

export interface EditorExternalStore {
  getSnapshot(): EditorSessionState;
  subscribe(listener: EditorStoreListener): () => void;
  subscribeSelector?<T>(
    selector: (state: EditorSessionState) => T,
    isEqual: EditorStoreSelectorEquality<T>,
    listener: EditorStoreListener,
  ): () => void;
  setState(updater: EditorStateUpdater): EditorSessionState;
  replaceState(nextState: EditorSessionState): EditorSessionState;
}
