"use client";

import {
  createContext,
  type ReactNode,
} from "react";

export interface FirstDraftActiveDropTargetStore {
  getActiveDropTargetId(): string | null;
  setActiveDropTargetId(dropTargetId: string | null): void;
  subscribe(dropTargetId: string, listener: () => void): () => void;
}

const inactiveFirstDraftActiveDropTargetStore: FirstDraftActiveDropTargetStore =
  Object.freeze({
    getActiveDropTargetId: () => null,
    setActiveDropTargetId: () => undefined,
    subscribe: () => () => undefined,
  });

export const FirstDraftActiveDropTargetStoreContext = createContext(
  inactiveFirstDraftActiveDropTargetStore,
);

export function createFirstDraftActiveDropTargetStore(): FirstDraftActiveDropTargetStore {
  let activeDropTargetId: string | null = null;
  const listenersByTargetId = new Map<string, Set<() => void>>();
  return {
    getActiveDropTargetId: () => activeDropTargetId,
    setActiveDropTargetId(nextDropTargetId) {
      if (nextDropTargetId === activeDropTargetId) return;
      const previousDropTargetId = activeDropTargetId;
      activeDropTargetId = nextDropTargetId;
      notify(previousDropTargetId);
      notify(nextDropTargetId);
    },
    subscribe(dropTargetId, listener) {
      const listeners = listenersByTargetId.get(dropTargetId) ?? new Set();
      listeners.add(listener);
      listenersByTargetId.set(dropTargetId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) listenersByTargetId.delete(dropTargetId);
      };
    },
  };

  function notify(dropTargetId: string | null): void {
    if (dropTargetId === null) return;
    for (const listener of listenersByTargetId.get(dropTargetId) ?? []) {
      listener();
    }
  }
}

export function FirstDraftActiveDropTargetStoreProvider({
  store,
  children,
}: {
  readonly store: FirstDraftActiveDropTargetStore;
  readonly children: ReactNode;
}) {
  return (
    <FirstDraftActiveDropTargetStoreContext.Provider value={store}>
      {children}
    </FirstDraftActiveDropTargetStoreContext.Provider>
  );
}
