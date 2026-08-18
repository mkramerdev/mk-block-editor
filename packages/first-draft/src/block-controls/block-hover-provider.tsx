"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  createFirstDraftBlockHoverStore,
  type FirstDraftBlockHoverStore,
  type FirstDraftHoveredBlockId,
} from "./block-hover-store.ts";

const FirstDraftBlockHoverStoreContext =
  createContext<FirstDraftBlockHoverStore | null>(null);

const disabledFirstDraftBlockHoverStore: FirstDraftBlockHoverStore =
  Object.freeze({
    getHoveredBlockId: () => null,
    setHoveredBlockId: () => undefined,
    subscribeBlock: () => () => undefined,
  });

export function FirstDraftBlockHoverProvider({
  children,
  enabled = true,
}: {
  readonly children: ReactNode;
  readonly enabled?: boolean;
}) {
  const storeRef = useRef<FirstDraftBlockHoverStore | null>(null);
  storeRef.current ??= createFirstDraftBlockHoverStore();
  const store = enabled ? storeRef.current : disabledFirstDraftBlockHoverStore;
  useEffect(() => {
    if (!enabled) storeRef.current?.setHoveredBlockId(null);
  }, [enabled]);
  return (
    <FirstDraftBlockHoverStoreContext.Provider value={store}>
      {children}
    </FirstDraftBlockHoverStoreContext.Provider>
  );
}

export function useFirstDraftEditingControlsEnabled(): boolean {
  return (
    useContext(FirstDraftBlockHoverStoreContext) !==
    disabledFirstDraftBlockHoverStore
  );
}

export function useFirstDraftBlockHoverStore(): FirstDraftBlockHoverStore {
  const store = useContext(FirstDraftBlockHoverStoreContext);
  if (!store) {
    throw new Error(
      "First Draft block hover hooks require FirstDraftBlockHoverProvider.",
    );
  }
  return store;
}

export function useIsHoveredFirstDraftBlock(blockId: BlockId): boolean {
  const store = useFirstDraftBlockHoverStore();
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeBlock(blockId, listener),
    [blockId, store],
  );
  const getSnapshot = useCallback(
    () => store.getHoveredBlockId() === blockId,
    [blockId, store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useSetHoveredFirstDraftBlockId(): (
  blockId: FirstDraftHoveredBlockId,
) => void {
  return useFirstDraftBlockHoverStore().setHoveredBlockId;
}
