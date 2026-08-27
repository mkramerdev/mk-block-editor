"use client";

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import type { TableColumnDragItem } from "./contracts.ts";

export interface FirstDraftTablePresentationRow {
  readonly rowId: BlockId;
  readonly cellIds: readonly BlockId[];
}

export type FirstDraftTableDragPlaceholder =
  | {
      readonly axis: "row";
      readonly rowId: BlockId;
    }
  | {
      readonly axis: "column";
      readonly dragId: string;
    }
  | null;

export interface FirstDraftTablePresentation {
  readonly tableId: BlockId;
  readonly rows: readonly FirstDraftTablePresentationRow[];
  readonly columns: readonly TableColumnDragItem[];
  readonly dragPlaceholder: FirstDraftTableDragPlaceholder;
}

export interface FirstDraftTablePresentationStore {
  readonly getSnapshot: () => FirstDraftTablePresentation;
  readonly subscribe: (listener: () => void) => () => void;
  readonly publish: (value: FirstDraftTablePresentation) => void;
}

export function createFirstDraftTablePresentationStore(
  initial: FirstDraftTablePresentation,
): FirstDraftTablePresentationStore {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(value) {
      if (Object.is(snapshot, value)) return;
      snapshot = value;
      listeners.forEach((listener) => listener());
    },
  };
}

const Context = createContext<FirstDraftTablePresentationStore | null>(null);

export function FirstDraftTablePresentationProvider({
  store,
  children,
}: {
  readonly store: FirstDraftTablePresentationStore;
  readonly children: ReactNode;
}) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useFirstDraftTablePresentation(): FirstDraftTablePresentation {
  const store = useContext(Context);
  if (!store) {
    throw new Error("First Draft table presentation provider is missing");
  }
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
