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
import type { EditorDocumentLayerInteractionPort } from "@repo/editor-web/document-runtime";
import { useFirstDraftFixedActionMenuPosition } from "../action-menu/fixed-action-menu-position.ts";
import { presentFirstDraftBlockOperationSelection } from "../block-operations/adjacent-paragraph.ts";
import type { FirstDraftViewStateStore } from "../blocks/view-state.tsx";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";
import { FirstDraftBlockActionIcon } from "./block-action-icon.tsx";
import {
  firstDraftBlockActionCatalog,
  type FirstDraftBlockAction,
} from "./catalog.ts";
import {
  dispatchFirstDraftBlockAction,
  readFirstDraftBlockActionAvailability,
} from "./dispatch.ts";
import type {
  FirstDraftBlockActionMenuStore,
  FirstDraftOpenBlockActionMenuSession,
} from "./store.tsx";

export interface FirstDraftBlockActionMenuLayerProps {
  readonly editor: FirstDraftEditor;
  readonly geometry: FirstDraftEditor["geometry"];
  readonly interactions: EditorDocumentLayerInteractionPort;
  readonly store: FirstDraftBlockActionMenuStore;
  readonly viewState: FirstDraftViewStateStore;
}

export function FirstDraftBlockActionMenuLayer({
  editor,
  geometry,
  interactions,
  store,
  viewState,
}: FirstDraftBlockActionMenuLayerProps) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const session = snapshot.kind === "open" ? snapshot : null;
  const valid = Boolean(session && isLiveBlock(editor, session.blockId));
  const layerGeneration = useRef(0);

  const restoreSessionFocus = useCallback(
    (current: FirstDraftOpenBlockActionMenuSession) => {
      if (current.triggerElement.isConnected) {
        current.triggerElement.focus({ preventScroll: true });
      } else {
        focusSafeEditorFallback(editor);
      }
    },
    [editor],
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
    const retained = store.reconcile((current) =>
      isLiveBlock(editor, current.blockId),
    );
    if (!retained && before.kind === "open") {
      queueMicrotask(() => focusSafeEditorFallback(editor));
    }
  }, [editor, store]);

  useLayoutEffect(() => {
    if (session) reconcile();
  }, [reconcile, session]);

  useEffect(() => {
    if (!session) return;
    return editor.subscribeBlock(session.blockId, reconcile);
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

  if (!session || !valid) return null;
  return (
    <FirstDraftBlockActionMenu
      key={session.blockId}
      editor={editor}
      geometry={geometry}
      interactions={interactions}
      session={session}
      store={store}
      viewState={viewState}
      close={close}
    />
  );
}

function FirstDraftBlockActionMenu({
  editor,
  geometry,
  interactions,
  session,
  store,
  viewState,
  close,
}: {
  readonly editor: FirstDraftEditor;
  readonly geometry: FirstDraftEditor["geometry"];
  readonly interactions: EditorDocumentLayerInteractionPort;
  readonly session: FirstDraftOpenBlockActionMenuSession;
  readonly store: FirstDraftBlockActionMenuStore;
  readonly viewState: FirstDraftViewStateStore;
  readonly close: (restoreFocus: boolean) => void;
}) {
  const actions = firstDraftBlockActionCatalog;
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
    (action: FirstDraftBlockAction) => {
      setFailure(null);
      const result = dispatchFirstDraftBlockAction(
        editor,
        viewState,
        session,
        action.id,
      );
      switch (result.kind) {
        case "applied":
          store.close();
          queueMicrotask(() =>
            presentFirstDraftBlockOperationSelection(editor, result.operation),
          );
          return result;
        case "disabled":
          return result;
        case "stale":
          store.close();
          queueMicrotask(() => focusSafeEditorFallback(editor));
          return result;
        case "rejected":
          setFailure(result.error);
          return result;
      }
    },
    [editor, session, store, viewState],
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
      queueMicrotask(() => focusSafeEditorFallback(editor));
    },
  });
  const style: CSSProperties = position
    ? ({
        left: position.left,
        top: position.top,
        visibility: "visible",
        "--first-draft-block-menu-available-block-size": `${position.availableHeight}px`,
      } as CSSProperties)
    : { visibility: "hidden" };

  return (
    <div
      ref={menuRef}
      id={store.menuId}
      className="first-draft-block-action-menu"
      role="menu"
      aria-label="Block actions"
      data-editor-ui="true"
      data-editor-preserve-selection="true"
      data-first-draft-block-action-menu="true"
      data-block-id={session.blockId}
      data-placement={position?.placement}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {actions.map((action, index) => {
        const availability = readFirstDraftBlockActionAvailability(
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
            className="first-draft-block-action-menu__item"
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
            <FirstDraftBlockActionIcon action={action} />
            <span className="first-draft-block-action-menu__label">
              {action.label}
            </span>
          </button>
        );
      })}
      {failure !== null ? (
        <p
          className="first-draft-block-action-menu__error"
          role="alert"
          data-block-action-error="true"
        >
          The block action could not be completed. Try again or dismiss this
          menu.
        </p>
      ) : null}
    </div>
  );
}

function isLiveBlock(
  editor: FirstDraftEditor,
  blockId: FirstDraftOpenBlockActionMenuSession["blockId"],
): boolean {
  const block = editor.getBlock(blockId);
  return Boolean(block && !block.tombstone);
}

function focusSafeEditorFallback(editor: FirstDraftEditor): void {
  const visit = (blockId: FirstDraftOpenBlockActionMenuSession["blockId"]): boolean => {
    const block = editor.getBlock(blockId);
    if (!block || block.tombstone) return false;
    const definition = editor.definition.blocks[block.type];
    if (definition?.kind === "text") {
      editor.focusText(block.id, { offset: 0, preventScroll: true });
      return true;
    }
    if (definition?.kind === "atomic") {
      editor.focusBlock(block.id, { preventScroll: true });
      return true;
    }
    for (const childId of editor.getChildBlockIds(block.id)) {
      if (visit(childId)) return true;
    }
    return false;
  };
  for (const blockId of editor.getRootBlockIds()) {
    if (visit(blockId)) return;
  }
  editor.blurEditor();
}
