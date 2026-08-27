"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";
import type { EditorDocumentLayerInteractionPort } from "@repo/editor-web/document-runtime";
import { fixedPopoverPositionForAnchor } from "@repo/editor-web/block-renderer";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";
import {
  deleteFirstDraftTab,
  readFirstDraftTabActionAvailability,
  resolveFirstDraftTabsTarget,
} from "../blocks/layout/tabs-mutations.ts";
import type {
  FirstDraftOpenTabsActionMenuSession,
  FirstDraftTabsActionUiStore,
} from "./store.tsx";

export interface FirstDraftTabsActionMenuLayerProps {
  readonly editor: FirstDraftEditor;
  readonly geometry: FirstDraftEditor["geometry"];
  readonly interactions: EditorDocumentLayerInteractionPort;
  readonly store: FirstDraftTabsActionUiStore;
  readonly selectTab: (
    tabsId: import("@repo/editor-core/kernel").BlockId,
    paneId: import("@repo/editor-core/kernel").BlockId,
  ) => void;
}

export function FirstDraftTabsActionMenuLayer({
  editor,
  geometry,
  interactions,
  store,
  selectTab,
}: FirstDraftTabsActionMenuLayerProps) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const openSession = snapshot.kind === "open" ? snapshot : null;
  const generation = useRef(0);

  const restoreFocus = useCallback(
    (session: FirstDraftOpenTabsActionMenuSession) => {
      if (session.triggerElement.isConnected) {
        session.triggerElement.focus({ preventScroll: true });
      } else {
        store.getTabsRoot(session.tabsId)?.focus({ preventScroll: true });
      }
    },
    [store],
  );
  const close = useCallback(
    (restore: boolean) => {
      const current = store.getSnapshot();
      if (current.kind !== "open") return;
      store.closeMenu();
      if (restore) restoreFocus(current);
    },
    [restoreFocus, store],
  );
  const reconcile = useCallback(() => {
    const before = store.getSnapshot();
    const retained = store.reconcile(
      (current) =>
        resolveFirstDraftTabsTarget(editor, current.tabsId, current.paneId) !==
        null,
    );
    if (!retained && before.kind === "open") {
      queueMicrotask(() => restoreFocus(before));
    }
  }, [editor, restoreFocus, store]);

  useLayoutEffect(() => {
    if (snapshot.kind !== "closed") reconcile();
  }, [reconcile, snapshot]);

  useEffect(() => {
    if (snapshot.kind === "closed") return;
    return combineUnsubscribers([
      editor.subscribeBlock(snapshot.tabsId, reconcile),
      editor.subscribeChildBlockIds(snapshot.tabsId, reconcile),
      editor.subscribeBlock(snapshot.paneId, reconcile),
    ]);
  }, [editor, reconcile, snapshot]);

  useEffect(() => {
    if (!openSession) return;
    const ownerDocument = openSession.triggerElement.ownerDocument;
    const interactionScope = openSession.triggerElement.closest(
      '[data-editor-interaction-scope="true"]',
    );
    const dismissOutside = (event: PointerEvent): void => {
      const current = store.getSnapshot();
      if (current !== openSession) return;
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
  }, [close, openSession, store]);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    return () => {
      queueMicrotask(() => {
        // Strict Mode remounts the same layer before this microtask runs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (generation.current !== currentGeneration) return;
        const current = store.getSnapshot();
        if (current.kind === "open") store.closeMenu();
        else if (current.kind === "rename") store.cancelRename();
      });
    };
  }, [store]);

  if (
    !openSession ||
    !openSession.triggerElement.isConnected ||
    !resolveFirstDraftTabsTarget(editor, openSession.tabsId, openSession.paneId)
  ) {
    return null;
  }
  return (
    <TabsActionMenu
      key={`${openSession.tabsId}:${openSession.paneId}`}
      editor={editor}
      geometry={geometry}
      interactions={interactions}
      session={openSession}
      store={store}
      selectTab={selectTab}
      close={close}
    />
  );
}

function TabsActionMenu({
  editor,
  geometry,
  interactions,
  session,
  store,
  selectTab,
  close,
}: {
  readonly editor: FirstDraftEditor;
  readonly geometry: FirstDraftEditor["geometry"];
  readonly interactions: EditorDocumentLayerInteractionPort;
  readonly session: FirstDraftOpenTabsActionMenuSession;
  readonly store: FirstDraftTabsActionUiStore;
  readonly selectTab: FirstDraftTabsActionMenuLayerProps["selectTab"];
  readonly close: (restore: boolean) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const activeIndexRef = useRef(0);
  const activeCause = useRef<"keyboard" | "pointer">("keyboard");
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const setActive = useCallback(
    (index: number, cause: "keyboard" | "pointer") => {
      activeIndexRef.current = index;
      activeCause.current = cause;
      setActiveIndex(index);
    },
    [],
  );
  const activate = useCallback(
    (action: "rename" | "delete") => {
      setFailure(null);
      const target = resolveFirstDraftTabsTarget(
        editor,
        session.tabsId,
        session.paneId,
      );
      if (!target) {
        setFailure("This tab is no longer available.");
        return;
      }
      if (action === "rename") {
        store.beginRename({
          kind: "rename",
          tabsId: session.tabsId,
          paneId: session.paneId,
          initialCanonicalTitle: target.canonicalTitle,
          initialDisplayedTitle: target.displayedTitle,
        });
        return;
      }
      const result = deleteFirstDraftTab(
        editor,
        session.tabsId,
        session.paneId,
      );
      if (result.kind === "applied") {
        store.closeMenu();
        selectTab(session.tabsId, result.paneId);
        store.getTabsRoot(session.tabsId)?.focus({ preventScroll: true });
      } else if (result.kind !== "disabled") {
        setFailure(result.reason);
      }
    },
    [editor, selectTab, session, store],
  );
  const keyboardState = useRef({ activate, close });
  useLayoutEffect(() => {
    keyboardState.current = { activate, close };
  });
  useLayoutEffect(
    () =>
      interactions.registerKeydownHandler((event) => {
        if (
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        ) {
          return "unhandled";
        }
        if (event.key === "Tab") {
          keyboardState.current.close(false);
          return "unhandled";
        }
        if (event.key === "Escape") {
          keyboardState.current.close(true);
          return "handled";
        }
        let next: number | null = null;
        if (event.key === "ArrowDown") next = (activeIndexRef.current + 1) % 2;
        else if (event.key === "ArrowUp")
          next = (activeIndexRef.current + 1) % 2;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = 1;
        if (next !== null) {
          setActive(next, "keyboard");
          return "handled";
        }
        if (event.key === "Enter" || event.key === " ") {
          keyboardState.current.activate(
            activeIndexRef.current === 0 ? "rename" : "delete",
          );
          return "handled";
        }
        return "unhandled";
      }),
    [interactions, setActive],
  );
  useLayoutEffect(() => {
    const item = itemRefs.current.get(activeIndex);
    item?.focus({ preventScroll: true });
    if (activeCause.current === "keyboard") {
      item?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeIndex]);

  const { menuRef, position } = useFirstDraftTabsActionMenuPosition(
    geometry,
    session,
    () => close(true),
  );
  const style: CSSProperties = position
    ? ({
        left: position.left,
        top: position.top,
        visibility: "visible",
        "--first-draft-tabs-menu-available-block-size": `${position.availableHeight}px`,
      } as CSSProperties)
    : { visibility: "hidden" };
  const availability = readFirstDraftTabActionAvailability(
    editor,
    session.tabsId,
    session.paneId,
  );
  const actions = ["rename", "delete"] as const;
  return (
    <div
      ref={menuRef}
      id={store.menuId}
      className="first-draft-tabs-action-menu"
      role="menu"
      aria-label="Tab actions"
      data-editor-ui="true"
      data-editor-preserve-selection="true"
      data-first-draft-tabs-action-menu="true"
      data-placement={position?.placement}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {actions.map((action, index) => {
        const disabled = action === "delete" && !availability?.delete;
        return (
          <button
            ref={(element) => {
              if (element) itemRefs.current.set(index, element);
              else itemRefs.current.delete(index);
            }}
            key={action}
            type="button"
            role="menuitem"
            aria-disabled={disabled ? "true" : undefined}
            tabIndex={activeIndex === index ? 0 : -1}
            className="first-draft-tabs-action-menu__item"
            data-action={action}
            data-active={activeIndex === index || undefined}
            onPointerEnter={() => {
              setActive(index, "pointer");
              itemRefs.current.get(index)?.focus({ preventScroll: true });
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (!disabled) activate(action);
            }}
          >
            {action === "rename" ? "Rename" : "Delete"}
          </button>
        );
      })}
      {failure ? (
        <p className="first-draft-tabs-action-menu__error" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

interface TabsActionMenuPosition {
  readonly left: number;
  readonly top: number;
  readonly placement: "top" | "bottom";
  readonly availableHeight: number;
}

interface PlacementViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const boundarySelector = ".first-draft-example__document-scroll";
const gap = 6;
const margin = 8;

export function useFirstDraftTabsActionMenuPosition(
  geometry: FirstDraftEditor["geometry"],
  session: FirstDraftOpenTabsActionMenuSession,
  onDisconnected: () => void,
): {
  readonly menuRef: RefObject<HTMLDivElement | null>;
  readonly position: TabsActionMenuPosition | null;
} {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<TabsActionMenuPosition | null>(null);
  const frame = useRef<number | null>(null);
  const geometryRevision = useSyncExternalStore(
    geometry.subscribe,
    geometry.getRevision,
    readZero,
  );
  const disconnected = useRef(onDisconnected);
  useLayoutEffect(() => {
    disconnected.current = onDisconnected;
  }, [onDisconnected]);
  const measure = useCallback(() => {
    frame.current = null;
    const trigger = session.triggerElement;
    const menu = menuRef.current;
    if (!trigger.isConnected) {
      setPosition(null);
      disconnected.current();
      return;
    }
    if (!menu?.isConnected) {
      setPosition(null);
      return;
    }
    const ownerWindow = trigger.ownerDocument.defaultView;
    const menuRect = menu.getBoundingClientRect();
    if (!ownerWindow || menuRect.width <= 0 || menuRect.height <= 0) {
      setPosition(null);
      return;
    }
    const viewport = placementViewport(trigger, ownerWindow);
    if (viewport.width <= margin * 2 || viewport.height <= margin * 2) {
      setPosition(null);
      return;
    }
    const measured = fixedPopoverPositionForAnchor(trigger, ownerWindow, {
      width: menuRect.width,
      height: menuRect.height,
      gap,
      margin,
      viewport,
    });
    setPosition((current) =>
      current &&
      current.left === measured.left &&
      current.top === measured.top &&
      current.placement === measured.placement &&
      current.availableHeight === measured.availableHeight
        ? current
        : measured,
    );
  }, [session]);
  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    const ownerWindow = session.triggerElement.ownerDocument.defaultView;
    if (typeof ownerWindow?.requestAnimationFrame === "function") {
      frame.current = ownerWindow.requestAnimationFrame(measure);
    } else {
      frame.current = -1;
      queueMicrotask(() => {
        if (frame.current === -1) measure();
      });
    }
  }, [measure, session.triggerElement]);
  useLayoutEffect(() => {
    void geometryRevision;
    schedule();
  }, [geometryRevision, schedule]);
  useEffect(() => {
    const ownerWindow = session.triggerElement.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const visual = ownerWindow.visualViewport;
    const boundary = owningBoundary(session.triggerElement);
    const Observer = ownerWindow.ResizeObserver ?? globalThis.ResizeObserver;
    const observer =
      typeof Observer === "function" ? new Observer(schedule) : null;
    observer?.observe(session.triggerElement);
    if (menuRef.current) observer?.observe(menuRef.current);
    if (boundary) observer?.observe(boundary);
    ownerWindow.addEventListener("resize", schedule);
    ownerWindow.addEventListener("scroll", schedule, true);
    boundary?.addEventListener("scroll", schedule);
    visual?.addEventListener("resize", schedule);
    visual?.addEventListener("scroll", schedule);
    return () => {
      observer?.disconnect();
      ownerWindow.removeEventListener("resize", schedule);
      ownerWindow.removeEventListener("scroll", schedule, true);
      boundary?.removeEventListener("scroll", schedule);
      visual?.removeEventListener("resize", schedule);
      visual?.removeEventListener("scroll", schedule);
      if (frame.current !== null && frame.current >= 0) {
        ownerWindow.cancelAnimationFrame(frame.current);
      }
      frame.current = null;
    };
  }, [schedule, session.triggerElement]);
  return { menuRef, position };
}

function owningBoundary(trigger: HTMLElement): HTMLElement | null {
  return trigger.closest<HTMLElement>(boundarySelector);
}

function placementViewport(
  trigger: HTMLElement,
  ownerWindow: Window,
): PlacementViewport {
  const visual = ownerWindow.visualViewport;
  const browser: PlacementViewport = visual
    ? {
        left: visual.offsetLeft,
        top: visual.offsetTop,
        width: visual.width,
        height: visual.height,
      }
    : {
        left: 0,
        top: 0,
        width: ownerWindow.innerWidth,
        height: ownerWindow.innerHeight,
      };
  const boundary = owningBoundary(trigger);
  if (!boundary) return browser;
  const rect = boundary.getBoundingClientRect();
  const left = Math.max(browser.left, rect.left);
  const top = Math.max(browser.top, rect.top);
  const right = Math.min(browser.left + browser.width, rect.right);
  const bottom = Math.min(browser.top + browser.height, rect.bottom);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function combineUnsubscribers(unsubscribers: readonly (() => void)[]) {
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

function readZero(): number {
  return 0;
}
