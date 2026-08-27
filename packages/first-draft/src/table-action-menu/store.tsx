"use client";

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import type { TableRangeSelection } from "../blocks/table/selection.ts";
import type { FirstDraftTableActionTarget } from "../blocks/table/action-target.ts";

export type { FirstDraftTableActionTarget } from "../blocks/table/action-target.ts";

export type FirstDraftTableActionMenuSnapshot =
  | { readonly kind: "closed" }
  | {
      readonly kind: "open";
      readonly tableId: BlockId;
      readonly target: FirstDraftTableActionTarget;
      readonly triggerElement: HTMLElement;
      readonly ownedTableRange: TableRangeSelection;
    };

export type FirstDraftOpenTableActionMenuSession = Extract<
  FirstDraftTableActionMenuSnapshot,
  { readonly kind: "open" }
>;

export interface FirstDraftTableActionMenuStore {
  readonly menuId: string;
  getSnapshot(): FirstDraftTableActionMenuSnapshot;
  subscribe(listener: () => void): () => void;
  open(session: FirstDraftOpenTableActionMenuSession): boolean;
  updateOwnedTableRange(
    session: FirstDraftOpenTableActionMenuSession,
    range: TableRangeSelection,
  ): boolean;
  close(): boolean;
  reconcile(
    validate: (session: FirstDraftOpenTableActionMenuSession) => boolean,
  ): boolean;
  registerTableGrid(tableId: BlockId, element: HTMLElement): () => void;
  getTableGrid(tableId: BlockId): HTMLElement | null;
}

const closedSnapshot = Object.freeze({
  kind: "closed",
} as const) satisfies FirstDraftTableActionMenuSnapshot;

let nextStoreId = 1;

export function createFirstDraftTableActionMenuStore(): FirstDraftTableActionMenuStore {
  const listeners = new Set<() => void>();
  const grids = new Map<
    BlockId,
    { readonly element: HTMLElement; readonly token: symbol }
  >();
  let snapshot: FirstDraftTableActionMenuSnapshot = closedSnapshot;

  const publish = (next: FirstDraftTableActionMenuSnapshot): void => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const store: FirstDraftTableActionMenuStore = {
    menuId: `first-draft-table-action-menu-${nextStoreId++}`,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    open(session) {
      if (!session.triggerElement.isConnected) {
        if (snapshot.kind === "open") publish(closedSnapshot);
        return false;
      }
      const target =
        session.target.kind === "row"
          ? Object.freeze({ ...session.target })
          : Object.freeze({
              ...session.target,
              identity: Object.freeze({ ...session.target.identity }),
            });
      publish(
        Object.freeze({
          ...session,
          target,
          ownedTableRange: Object.freeze({ ...session.ownedTableRange }),
        }),
      );
      return true;
    },
    updateOwnedTableRange(session, range) {
      if (snapshot !== session) return false;
      publish(
        Object.freeze({
          ...session,
          ownedTableRange: Object.freeze({ ...range }),
        }),
      );
      return true;
    },
    close() {
      if (snapshot.kind === "closed") return false;
      publish(closedSnapshot);
      return true;
    },
    reconcile(validate) {
      if (snapshot.kind === "closed") return true;
      const current = snapshot;
      if (!current.triggerElement.isConnected) {
        publish(closedSnapshot);
        return false;
      }
      if (!validate(current)) {
        publish(closedSnapshot);
        return false;
      }
      return true;
    },
    registerTableGrid(tableId, element) {
      const registration = { element, token: Symbol("table-grid") };
      grids.set(tableId, registration);
      return () => {
        if (grids.get(tableId)?.token === registration.token) {
          grids.delete(tableId);
        }
      };
    },
    getTableGrid(tableId) {
      const element = grids.get(tableId)?.element ?? null;
      return element?.isConnected ? element : null;
    },
  };
  return Object.freeze(store);
}

const Context = createContext<FirstDraftTableActionMenuStore | null>(null);

export function FirstDraftTableActionMenuProvider({
  store,
  children,
}: {
  readonly store: FirstDraftTableActionMenuStore;
  readonly children: ReactNode;
}) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useFirstDraftTableActionMenuStore(): FirstDraftTableActionMenuStore {
  const store = useContext(Context);
  if (!store) {
    throw new Error("First Draft table-action-menu provider is missing");
  }
  return store;
}

export function useFirstDraftTableActionMenuSnapshot(): FirstDraftTableActionMenuSnapshot {
  const store = useFirstDraftTableActionMenuStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
