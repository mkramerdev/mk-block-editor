"use client";

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";

export interface FirstDraftOpenTabsActionMenuSession {
  readonly kind: "open";
  readonly tabsId: BlockId;
  readonly paneId: BlockId;
  readonly triggerElement: HTMLElement;
}

export interface FirstDraftTabsRenameSession {
  readonly kind: "rename";
  readonly tabsId: BlockId;
  readonly paneId: BlockId;
  readonly initialCanonicalTitle: string | null;
  readonly initialDisplayedTitle: string;
}

export type FirstDraftTabsActionUiSnapshot =
  | { readonly kind: "closed" }
  | FirstDraftOpenTabsActionMenuSession
  | FirstDraftTabsRenameSession;

export interface FirstDraftTabsActionUiStore {
  readonly menuId: string;
  getSnapshot(): FirstDraftTabsActionUiSnapshot;
  subscribe(listener: () => void): () => void;
  openMenu(session: FirstDraftOpenTabsActionMenuSession): boolean;
  closeMenu(): boolean;
  beginRename(session: FirstDraftTabsRenameSession): boolean;
  finishRename(): boolean;
  cancelRename(): boolean;
  reconcile(
    validate: (
      session: Exclude<FirstDraftTabsActionUiSnapshot, { kind: "closed" }>,
    ) => boolean,
  ): boolean;
  registerTabsRoot(tabsId: BlockId, element: HTMLElement): () => void;
  getTabsRoot(tabsId: BlockId): HTMLElement | null;
}

const closedSnapshot = Object.freeze({ kind: "closed" } as const);
let nextStoreId = 1;

export function createFirstDraftTabsActionUiStore(): FirstDraftTabsActionUiStore {
  const listeners = new Set<() => void>();
  const roots = new Map<
    BlockId,
    { readonly element: HTMLElement; readonly token: symbol }
  >();
  let snapshot: FirstDraftTabsActionUiSnapshot = closedSnapshot;
  const publish = (next: FirstDraftTabsActionUiSnapshot): void => {
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) listener();
  };
  const store: FirstDraftTabsActionUiStore = {
    menuId: `first-draft-tabs-action-menu-${nextStoreId++}`,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openMenu(session) {
      if (!session.triggerElement.isConnected) {
        if (snapshot.kind !== "closed") publish(closedSnapshot);
        return false;
      }
      publish({ ...session });
      return true;
    },
    closeMenu() {
      if (snapshot.kind !== "open") return false;
      publish(closedSnapshot);
      return true;
    },
    beginRename(session) {
      if (
        snapshot.kind !== "open" ||
        snapshot.tabsId !== session.tabsId ||
        snapshot.paneId !== session.paneId
      ) {
        return false;
      }
      publish({ ...session });
      return true;
    },
    finishRename() {
      if (snapshot.kind !== "rename") return false;
      publish(closedSnapshot);
      return true;
    },
    cancelRename() {
      if (snapshot.kind !== "rename") return false;
      publish(closedSnapshot);
      return true;
    },
    reconcile(validate) {
      if (snapshot.kind === "closed") return true;
      const current = snapshot;
      if (
        (current.kind === "open" && !current.triggerElement.isConnected) ||
        !validate(current)
      ) {
        publish(closedSnapshot);
        return false;
      }
      return true;
    },
    registerTabsRoot(tabsId, element) {
      const registration = { element, token: Symbol("tabs-root") };
      roots.set(tabsId, registration);
      return () => {
        if (roots.get(tabsId)?.token === registration.token)
          roots.delete(tabsId);
      };
    },
    getTabsRoot(tabsId) {
      const element = roots.get(tabsId)?.element ?? null;
      return element?.isConnected ? element : null;
    },
  };
  return Object.freeze(store);
}

const Context = createContext<FirstDraftTabsActionUiStore | null>(null);

export function FirstDraftTabsActionUiProvider({
  store,
  children,
}: {
  readonly store: FirstDraftTabsActionUiStore;
  readonly children: ReactNode;
}) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useOptionalFirstDraftTabsActionUiStore(): FirstDraftTabsActionUiStore | null {
  return useContext(Context);
}

export function useFirstDraftTabsActionUiStore(): FirstDraftTabsActionUiStore {
  const store = useOptionalFirstDraftTabsActionUiStore();
  if (!store) throw new Error("First Draft tabs-action UI provider is missing");
  return store;
}

export function useFirstDraftTabsActionUiSnapshot(): FirstDraftTabsActionUiSnapshot {
  const store = useFirstDraftTabsActionUiStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

export function useOptionalFirstDraftTabsActionUiSnapshot(): FirstDraftTabsActionUiSnapshot {
  const store = useOptionalFirstDraftTabsActionUiStore();
  return useSyncExternalStore(
    store?.subscribe ?? subscribeClosed,
    store?.getSnapshot ?? readClosed,
    store?.getSnapshot ?? readClosed,
  );
}

function subscribeClosed(): () => void {
  return () => undefined;
}

function readClosed(): FirstDraftTabsActionUiSnapshot {
  return closedSnapshot;
}
