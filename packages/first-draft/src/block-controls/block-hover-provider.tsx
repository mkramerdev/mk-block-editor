"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type PointerEvent,
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

export const FIRST_DRAFT_BLOCK_SHELL_SELECTOR =
  '[data-editor-block-shell="true"][data-editor-block-id]';

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
  const ownedStore = storeRef.current;
  const store = enabled ? ownedStore : disabledFirstDraftBlockHoverStore;
  const clear = useCallback(
    () => ownedStore.setHoveredBlockId(null),
    [ownedStore],
  );
  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!enabled) {
        clear();
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        clear();
        return;
      }
      const shell = target.closest<HTMLElement>(
        FIRST_DRAFT_BLOCK_SHELL_SELECTOR,
      );
      if (!shell || !event.currentTarget.contains(shell)) {
        clear();
        return;
      }
      const blockId = shell.dataset.editorBlockId as BlockId | undefined;
      ownedStore.setHoveredBlockId(blockId?.length ? blockId : null);
    },
    [clear, enabled, ownedStore],
  );
  const handlePointerLeave = useCallback(() => clear(), [clear]);

  useEffect(() => {
    if (!enabled) clear();
  }, [clear, enabled]);
  useEffect(() => {
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("blur", clear);
      clear();
    };
  }, [clear]);

  return (
    <FirstDraftBlockHoverStoreContext.Provider value={store}>
      <div
        className="first-draft-block-hover-boundary"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        {children}
      </div>
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
