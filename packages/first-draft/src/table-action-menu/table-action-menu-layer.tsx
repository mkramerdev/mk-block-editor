"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { EditableEditor } from "@repo/editor-web/editor";
import type { EditorDocumentLayerInteractionPort } from "@repo/editor-web/document-runtime";
import { resolveFirstDraftTableActionTarget } from "../blocks/table/action-target.ts";
import { useFirstDraftFixedActionMenuPosition } from "../action-menu/fixed-action-menu-position.ts";
import { firstDraftTableActionCatalog } from "./catalog.ts";
import type { FirstDraftTableAction } from "./catalog.ts";
import {
  dispatchFirstDraftTableAction,
  readFirstDraftTableActionAvailability,
} from "./dispatch.ts";
import { FirstDraftTableActionIcon } from "./table-action-icon.tsx";
import type {
  FirstDraftOpenTableActionMenuSession,
  FirstDraftTableActionMenuStore,
} from "./store.tsx";

export interface FirstDraftTableActionMenuLayerProps {
  readonly editor: EditableEditor;
  readonly geometry: EditableEditor["geometry"];
  readonly interactions: EditorDocumentLayerInteractionPort;
  readonly store: FirstDraftTableActionMenuStore;
}

export function FirstDraftTableActionMenuLayer({
  editor,
  geometry,
  interactions,
  store,
}: FirstDraftTableActionMenuLayerProps) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const session = snapshot.kind === "open" ? snapshot : null;
  const currentIndex = session
    ? resolveFirstDraftTableActionTargetIndex(editor, session)
    : null;
  const valid = Boolean(
    session && session.triggerElement.isConnected && currentIndex !== null,
  );
  const layerGeneration = useRef(0);

  const restoreSessionFocus = useCallback(
    (current: FirstDraftOpenTableActionMenuSession) => {
      if (current.triggerElement.isConnected) {
        current.triggerElement.focus({ preventScroll: true });
        return;
      }
      store.getTableGrid(current.tableId)?.focus({ preventScroll: true });
    },
    [store],
  );

  const close = useCallback(
    (restoreFocus: boolean) => {
      const current = store.getSnapshot();
      if (current.kind !== "open") return;
      store.close();
      if (restoreFocus) restoreSessionFocus(current);
    },
    [restoreSessionFocus, store],
  );

  const reconcile = useCallback(() => {
    const before = store.getSnapshot();
    const retained = store.reconcile(
      (current) =>
        resolveFirstDraftTableActionTargetIndex(editor, current) !== null,
    );
    if (!retained && before.kind === "open") {
      if (!before.triggerElement.isConnected) {
        restoreSessionFocus(before);
      } else {
        queueMicrotask(() => {
          if (!before.triggerElement.isConnected) {
            store.getTableGrid(before.tableId)?.focus({ preventScroll: true });
          }
        });
      }
    }
  }, [editor, restoreSessionFocus, store]);

  useLayoutEffect(() => {
    if (session) reconcile();
  }, [reconcile, session]);

  useEffect(() => {
    if (!session) return;
    const unsubscribers = [
      editor.subscribeBlock(session.tableId, reconcile),
      editor.subscribeChildBlockIds(session.tableId, reconcile),
    ];
    for (const rowId of editor.getChildBlockIds(session.tableId)) {
      unsubscribers.push(editor.subscribeBlock(rowId, reconcile));
      unsubscribers.push(editor.subscribeChildBlockIds(rowId, reconcile));
    }
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [editor, reconcile, session]);

  useEffect(() => {
    if (!session) return;
    const ownerDocument = session.triggerElement.ownerDocument;
    const interactionScope = session.triggerElement.closest(
      '[data-editor-interaction-scope="true"]',
    );
    const dismissOutside = (event: PointerEvent): void => {
      const current = store.getSnapshot();
      if (current.kind !== "open" || current !== session) return;
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      const targetScope =
        target instanceof Element
          ? target.closest('[data-editor-interaction-scope="true"]')
          : target.parentElement?.closest(
              '[data-editor-interaction-scope="true"]',
            );
      if (targetScope && targetScope !== interactionScope) return;
      const menu = ownerDocument.getElementById(store.menuId);
      if (current.triggerElement.contains(target) || menu?.contains(target)) {
        return;
      }
      close(true);
    };
    ownerDocument.addEventListener("pointerdown", dismissOutside, true);
    return () =>
      ownerDocument.removeEventListener("pointerdown", dismissOutside, true);
  }, [close, session, store]);

  useEffect(() => {
    const generation = ++layerGeneration.current;
    return () => {
      queueMicrotask(() => {
        // Strict Mode remounts the same layer before this microtask runs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (layerGeneration.current === generation) store.close();
      });
    };
  }, [store]);

  if (!session || !valid || currentIndex === null) return null;
  return (
    <FirstDraftTableActionMenu
      key={`${session.tableId}:${tableActionSessionKey(session)}`}
      editor={editor}
      geometry={geometry}
      interactions={interactions}
      session={session}
      store={store}
      close={close}
    />
  );
}

function FirstDraftTableActionMenu({
  editor,
  geometry,
  interactions,
  session,
  store,
  close,
}: {
  readonly editor: EditableEditor;
  readonly geometry: EditableEditor["geometry"];
  readonly interactions: EditorDocumentLayerInteractionPort;
  readonly session: FirstDraftOpenTableActionMenuSession;
  readonly store: FirstDraftTableActionMenuStore;
  readonly close: (restoreFocus: boolean) => void;
}) {
  const actions = firstDraftTableActionCatalog[session.target.kind];
  const [activeIndex, setActiveIndex] = useState(0);
  const [failure, setFailure] = useState<unknown | null>(null);
  const activeIndexRef = useRef(0);
  const activeCause = useRef<"keyboard" | "pointer">("keyboard");
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const setActive = useCallback(
    (index: number, cause: "keyboard" | "pointer") => {
      activeCause.current = cause;
      activeIndexRef.current = index;
      setActiveIndex(index);
    },
    [],
  );
  const activate = useCallback(
    (action: FirstDraftTableAction) => {
      setFailure(null);
      const result = dispatchFirstDraftTableAction(editor, session, action.id);
      switch (result.kind) {
        case "applied": {
          store.close();
          store.getTableGrid(session.tableId)?.focus({ preventScroll: true });
          return result;
        }
        case "disabled":
          return result;
        case "stale":
          store.close();
          store.getTableGrid(session.tableId)?.focus({ preventScroll: true });
          return result;
        case "rejected":
          setFailure(result.error);
          return result;
      }
    },
    [editor, session, store],
  );
  const keyboardState = useRef({ actions, activate, close });
  useLayoutEffect(() => {
    keyboardState.current = { actions, activate, close };
  });

  useLayoutEffect(
    () =>
      interactions.registerKeydownHandler((event) => {
        const current = keyboardState.current;
        if (
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        ) {
          return "unhandled";
        }
        if (event.key === "Tab") {
          current.close(false);
          return "unhandled";
        }
        if (event.key === "Escape") {
          current.close(true);
          return "handled";
        }
        let nextIndex: number | null = null;
        if (event.key === "ArrowDown") {
          nextIndex = (activeIndexRef.current + 1) % current.actions.length;
        } else if (event.key === "ArrowUp") {
          nextIndex =
            (activeIndexRef.current - 1 + current.actions.length) %
            current.actions.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = current.actions.length - 1;
        }
        if (nextIndex !== null) {
          setActive(nextIndex, "keyboard");
          return "handled";
        }
        if (event.key === "Enter" || event.key === " ") {
          const action = current.actions[activeIndexRef.current];
          if (action) current.activate(action);
          return "handled";
        }
        return "unhandled";
      }),
    [interactions, setActive],
  );

  useLayoutEffect(() => {
    const active = itemRefs.current.get(activeIndex);
    active?.focus({ preventScroll: true });
    if (activeCause.current === "keyboard") {
      active?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeIndex]);

  const { menuRef, position } = useFirstDraftFixedActionMenuPosition({
    geometry,
    triggerElement: session.triggerElement,
    onDisconnected: () => {
      const current = store.getSnapshot();
      if (current.kind !== "open") return;
      store.close();
      store.getTableGrid(current.tableId)?.focus({ preventScroll: true });
    },
  });
  const style: CSSProperties = position
    ? ({
        left: position.left,
        top: position.top,
        visibility: "visible",
        "--first-draft-table-menu-available-block-size": `${position.availableHeight}px`,
      } as CSSProperties)
    : { visibility: "hidden" };

  return (
    <div
      ref={menuRef}
      id={store.menuId}
      className="first-draft-table-action-menu"
      role="menu"
      aria-label={`${session.target.kind === "row" ? "Row" : "Column"} ${resolveFirstDraftTableActionTargetIndex(editor, session)! + 1} actions`}
      data-editor-ui="true"
      data-editor-preserve-selection="true"
      data-first-draft-table-action-menu="true"
      data-table-id={session.tableId}
      data-table-action-axis={session.target.kind}
      data-placement={position?.placement}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {actions.map((action, index) => {
        const availability = readFirstDraftTableActionAvailability(
          editor,
          session,
          action.id,
        );
        const disabled = availability.kind === "disabled";
        return (
          <button
            ref={(element) => {
              if (element) itemRefs.current.set(index, element);
              else itemRefs.current.delete(index);
            }}
            key={action.id}
            type="button"
            role="menuitem"
            aria-disabled={disabled ? "true" : undefined}
            tabIndex={index === activeIndex ? 0 : -1}
            className="first-draft-table-action-menu__item"
            data-active={index === activeIndex || undefined}
            onPointerEnter={() => {
              setActive(index, "pointer");
              itemRefs.current.get(index)?.focus({ preventScroll: true });
            }}
            onClick={(event) => {
              event.stopPropagation();
              activate(action);
            }}
          >
            <FirstDraftTableActionIcon action={action} />
            <span className="first-draft-table-action-menu__label">
              {action.label}
            </span>
          </button>
        );
      })}
      {failure !== null ? (
        <p
          className="first-draft-table-action-menu__error"
          role="alert"
          data-table-action-error="true"
        >
          The table action could not be completed. Try again or dismiss this
          menu.
        </p>
      ) : null}
    </div>
  );
}

export function resolveFirstDraftTableActionTargetIndex(
  editor: EditableEditor,
  session: FirstDraftOpenTableActionMenuSession,
): number | null {
  try {
    return resolveFirstDraftTableActionTarget(
      editor,
      session.tableId,
      session.target,
    ).targetIndex;
  } catch {
    return null;
  }
}

function tableActionSessionKey(
  session: FirstDraftOpenTableActionMenuSession,
): string {
  if (session.target.kind === "row") return `row:${session.target.rowId}`;
  return session.target.identity.kind === "canonical"
    ? `column:canonical:${session.target.identity.columnId}`
    : `column:synthetic:${session.target.identity.presentationId}:${session.target.identity.indexAtOpen}:${session.target.identity.columnCountAtOpen}`;
}
