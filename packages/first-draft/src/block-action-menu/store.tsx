"use client";

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";

export type FirstDraftBlockActionMenuSnapshot =
  | { readonly kind: "closed" }
  | {
      readonly kind: "open";
      readonly blockId: BlockId;
      readonly triggerElement: HTMLButtonElement;
      readonly cause: "pointer" | "keyboard";
    };

export type FirstDraftOpenBlockActionMenuSession = Extract<
  FirstDraftBlockActionMenuSnapshot,
  { readonly kind: "open" }
>;

export interface FirstDraftBlockActionMenuStore {
  readonly menuId: string;
  getSnapshot(): FirstDraftBlockActionMenuSnapshot;
  subscribe(listener: () => void): () => void;
  open(session: FirstDraftOpenBlockActionMenuSession): boolean;
  close(): boolean;
  toggle(session: FirstDraftOpenBlockActionMenuSession): boolean;
  reconcile(
    validate: (session: FirstDraftOpenBlockActionMenuSession) => boolean,
  ): boolean;
  closeForDocumentDrag(blockId: BlockId): void;
  clearSuppressedTriggerClick(blockId: BlockId): void;
  consumeSuppressedTriggerClick(blockId: BlockId): boolean;
}

const closedSnapshot = Object.freeze({
  kind: "closed",
} as const) satisfies FirstDraftBlockActionMenuSnapshot;

let nextStoreId = 1;

export function createFirstDraftBlockActionMenuStore(): FirstDraftBlockActionMenuStore {
  const listeners = new Set<() => void>();
  const suppressedTriggerClicks = new Set<BlockId>();
  let snapshot: FirstDraftBlockActionMenuSnapshot = closedSnapshot;

  const publish = (next: FirstDraftBlockActionMenuSnapshot): void => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const store: FirstDraftBlockActionMenuStore = {
    menuId: `first-draft-block-action-menu-${nextStoreId++}`,
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
      publish(Object.freeze({ ...session }));
      return true;
    },
    close() {
      if (snapshot.kind === "closed") return false;
      publish(closedSnapshot);
      return true;
    },
    toggle(session) {
      if (
        snapshot.kind === "open" &&
        snapshot.blockId === session.blockId &&
        snapshot.triggerElement === session.triggerElement
      ) {
        publish(closedSnapshot);
        return false;
      }
      return store.open(session);
    },
    reconcile(validate) {
      if (snapshot.kind === "closed") return true;
      const current = snapshot;
      if (!current.triggerElement.isConnected || !validate(current)) {
        publish(closedSnapshot);
        return false;
      }
      return true;
    },
    closeForDocumentDrag(blockId) {
      suppressedTriggerClicks.add(blockId);
      store.close();
    },
    clearSuppressedTriggerClick(blockId) {
      suppressedTriggerClicks.delete(blockId);
    },
    consumeSuppressedTriggerClick(blockId) {
      return suppressedTriggerClicks.delete(blockId);
    },
  };
  return Object.freeze(store);
}

const Context = createContext<FirstDraftBlockActionMenuStore | null>(null);

export function FirstDraftBlockActionMenuProvider({
  store,
  children,
}: {
  readonly store: FirstDraftBlockActionMenuStore;
  readonly children: ReactNode;
}) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useFirstDraftBlockActionMenuStore(): FirstDraftBlockActionMenuStore {
  const store = useContext(Context);
  if (!store) {
    throw new Error("First Draft block-action-menu provider is missing");
  }
  return store;
}

export function useFirstDraftBlockActionMenuSnapshot(): FirstDraftBlockActionMenuSnapshot {
  const store = useFirstDraftBlockActionMenuStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
