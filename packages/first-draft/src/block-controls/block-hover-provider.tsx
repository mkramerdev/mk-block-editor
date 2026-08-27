"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  FirstDraftBlockDragAndDropProvider,
  useFirstDraftActiveDragGroup,
  type FirstDraftBlockDragAndDropBridge,
} from "../block-drag-and-drop/lifecycle-bridge.tsx";
import type { FirstDraftTableDragStore } from "../table-drag-and-drop/index.ts";
import {
  createFirstDraftBlockActionMenuStore,
  FirstDraftBlockActionMenuProvider,
  type FirstDraftBlockActionMenuStore,
} from "../block-action-menu/index.ts";
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
  blockDragAndDrop,
  tableDragStore,
  blockActionMenuStore,
}: {
  readonly children: ReactNode;
  readonly enabled?: boolean;
  readonly blockDragAndDrop?: FirstDraftBlockDragAndDropBridge;
  readonly tableDragStore?: FirstDraftTableDragStore;
  readonly blockActionMenuStore?: FirstDraftBlockActionMenuStore;
}) {
  const [ownedStore] = useState(createFirstDraftBlockHoverStore);
  const [ownedBlockActionMenuStore] = useState(
    createFirstDraftBlockActionMenuStore,
  );
  const actionMenuStore = blockActionMenuStore ?? ownedBlockActionMenuStore;
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
      const delegatedOwner = resolveDomHoverDelegate(target, shell);
      ownedStore.setHoveredBlockId(
        delegatedOwner ?? (blockId?.length ? blockId : null),
      );
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
    <FirstDraftBlockActionMenuProvider store={actionMenuStore}>
      <FirstDraftBlockDragAndDropProvider
        bridge={blockDragAndDrop}
        tableDragStore={tableDragStore}
      >
        <FirstDraftBlockHoverStoreContext.Provider value={store}>
          <FirstDraftBlockHoverBoundary
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
          >
            {children}
          </FirstDraftBlockHoverBoundary>
        </FirstDraftBlockHoverStoreContext.Provider>
      </FirstDraftBlockDragAndDropProvider>
    </FirstDraftBlockActionMenuProvider>
  );
}

function resolveDomHoverDelegate(
  target: Element,
  targetShell: HTMLElement,
): BlockId | null {
  const boundary = target.closest<HTMLElement>(
    "[data-first-draft-hover-primary-owner]",
  );
  if (!boundary) return null;
  const primaryShell = [...boundary.children].find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.matches(FIRST_DRAFT_BLOCK_SHELL_SELECTOR),
  );
  if (primaryShell !== targetShell) return null;
  const owner = boundary.dataset.firstDraftHoverPrimaryOwner;
  return owner?.length ? (owner as BlockId) : null;
}

function FirstDraftBlockHoverBoundary({
  children,
  onPointerMove,
  onPointerLeave,
}: {
  readonly children: ReactNode;
  readonly onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerLeave: () => void;
}) {
  const activeDragGroup = useFirstDraftActiveDragGroup();
  return (
    <div
      className="first-draft-block-hover-boundary"
      data-first-draft-active-drag-group={activeDragGroup ?? undefined}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>
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
