"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";

interface ViewStateSnapshot {
  readonly selectedTabs: Readonly<Record<BlockId, BlockId>>;
  readonly collapsed: ReadonlySet<BlockId>;
}

export interface FirstDraftViewStateStore {
  getSnapshot(): ViewStateSnapshot;
  getSelectedTab(containerId: BlockId): BlockId | null;
  isBlockCollapsed(blockId: BlockId): boolean;
  setBlockCollapsed(blockId: BlockId, collapsed: boolean): void;
  deleteBlockState(blockId: BlockId): void;
  subscribe(listener: () => void): () => void;
  selectTab(containerId: BlockId, childId: BlockId): void;
  toggleCollapsed(blockId: BlockId): void;
}

export function resolveEffectiveFirstDraftTabPaneId(
  store: Pick<FirstDraftViewStateStore, "getSelectedTab">,
  tabsId: BlockId,
  directPaneIds: readonly BlockId[],
): BlockId | null {
  const selected = store.getSelectedTab(tabsId);
  return selected && directPaneIds.includes(selected)
    ? selected
    : directPaneIds[0] ?? null;
}

interface FirstDraftViewStateOptions {
  readonly selectedTabs?: Readonly<Record<BlockId, BlockId>>;
  readonly collapsedBlockIds?: Iterable<BlockId>;
}

export function createFirstDraftViewStateStore(
  options: FirstDraftViewStateOptions = {},
): FirstDraftViewStateStore {
  const selected = { ...options.selectedTabs } as Record<BlockId, BlockId>;
  const collapsed = new Set(options.collapsedBlockIds ?? []);
  const listeners = new Set<() => void>();
  let snapshot = makeSnapshot(selected, collapsed);
  const publish = () => {
    snapshot = makeSnapshot(selected, collapsed);
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => snapshot,
    getSelectedTab(containerId) {
      return selected[containerId] ?? null;
    },
    isBlockCollapsed(blockId) {
      return collapsed.has(blockId);
    },
    setBlockCollapsed(blockId, next) {
      if (collapsed.has(blockId) === next) return;
      if (next) collapsed.add(blockId);
      else collapsed.delete(blockId);
      publish();
    },
    deleteBlockState(blockId) {
      let changed = collapsed.delete(blockId);
      if (Object.prototype.hasOwnProperty.call(selected, blockId)) {
        delete selected[blockId];
        changed = true;
      }
      for (const [containerId, childId] of Object.entries(selected)) {
        if (childId !== blockId) continue;
        delete selected[containerId as BlockId];
        changed = true;
      }
      if (!changed) return;
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectTab(containerId, childId) {
      if (selected[containerId] === childId) return;
      selected[containerId] = childId;
      publish();
    },
    toggleCollapsed(blockId) {
      if (collapsed.has(blockId)) collapsed.delete(blockId);
      else collapsed.add(blockId);
      publish();
    },
  };
}

function makeSnapshot(
  selectedTabs: Readonly<Record<BlockId, BlockId>>,
  collapsed: ReadonlySet<BlockId>,
): ViewStateSnapshot {
  return Object.freeze({
    selectedTabs: Object.freeze({ ...selectedTabs }),
    collapsed: new Set(collapsed),
  });
}

const Context = createContext<FirstDraftViewStateStore | null>(null);

export function FirstDraftViewStateProvider({
  store,
  children,
}: {
  readonly store: FirstDraftViewStateStore;
  readonly children: ReactNode;
}) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

function useStore(): FirstDraftViewStateStore {
  const store = useContext(Context);
  if (!store) throw new Error("First Draft view-state provider is missing");
  return store;
}

export function useFirstDraftViewStateStore(): FirstDraftViewStateStore {
  return useStore();
}

export function useSelectedTab(containerId: BlockId): BlockId | null {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSelectedTab(containerId),
    () => store.getSelectedTab(containerId),
  );
}

export function useSelectTab(containerId: BlockId) {
  const store = useStore();
  return useCallback(
    (childId: BlockId) => store.selectTab(containerId, childId),
    [containerId, store],
  );
}

export function useCollapsed(blockId: BlockId): readonly [boolean, () => void] {
  const store = useStore();
  const collapsed = useSyncExternalStore(
    store.subscribe,
    () => store.isBlockCollapsed(blockId),
    () => store.isBlockCollapsed(blockId),
  );
  const toggle = useCallback(
    () => store.toggleCollapsed(blockId),
    [blockId, store],
  );
  return [collapsed, toggle] as const;
}
