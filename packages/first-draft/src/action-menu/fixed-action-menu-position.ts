"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { fixedPopoverPositionForAnchor } from "@repo/editor-web/block-renderer";
import type { EditableEditor } from "@repo/editor-web/editor";

export interface FirstDraftFixedActionMenuPosition {
  readonly left: number;
  readonly top: number;
  readonly placement: "top" | "bottom";
  readonly availableHeight: number;
}

interface FirstDraftActionMenuPlacementViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const documentScrollBoundarySelector = ".first-draft-example__document-scroll";
const actionMenuGap = 6;
const actionMenuMargin = 8;

export function useFirstDraftFixedActionMenuPosition({
  geometry,
  triggerElement,
  onDisconnected,
}: {
  readonly geometry: EditableEditor["geometry"];
  readonly triggerElement: HTMLElement;
  readonly onDisconnected: () => void;
}): {
  readonly menuRef: RefObject<HTMLDivElement | null>;
  readonly position: FirstDraftFixedActionMenuPosition | null;
} {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] =
    useState<FirstDraftFixedActionMenuPosition | null>(null);
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
    const menu = menuRef.current;
    if (!triggerElement.isConnected) {
      setPosition(null);
      disconnected.current();
      return;
    }
    if (!menu?.isConnected) {
      setPosition(null);
      return;
    }
    const ownerWindow = triggerElement.ownerDocument.defaultView;
    const menuRect = menu.getBoundingClientRect();
    if (!ownerWindow || menuRect.width <= 0 || menuRect.height <= 0) {
      setPosition(null);
      return;
    }
    const viewport = actionMenuPlacementViewport(triggerElement, ownerWindow);
    if (
      viewport.width <= actionMenuMargin * 2 ||
      viewport.height <= actionMenuMargin * 2
    ) {
      setPosition(null);
      return;
    }
    const measuredPosition = fixedPopoverPositionForAnchor(
      triggerElement,
      ownerWindow,
      {
        width: menuRect.width,
        height: menuRect.height,
        gap: actionMenuGap,
        margin: actionMenuMargin,
        viewport,
      },
    );
    setPosition((current) =>
      equalActionMenuPositions(current, measuredPosition)
        ? current
        : measuredPosition,
    );
  }, [triggerElement]);
  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    const ownerWindow = triggerElement.ownerDocument.defaultView;
    if (typeof ownerWindow?.requestAnimationFrame === "function") {
      frame.current = ownerWindow.requestAnimationFrame(measure);
    } else {
      frame.current = -1;
      queueMicrotask(() => {
        if (frame.current === -1) measure();
      });
    }
  }, [measure, triggerElement]);

  useLayoutEffect(() => {
    void geometryRevision;
    schedule();
  }, [geometryRevision, schedule]);

  useEffect(() => {
    const ownerWindow = triggerElement.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const visual = ownerWindow.visualViewport;
    const boundary = owningDocumentScrollBoundary(triggerElement);
    const Observer = ownerWindow.ResizeObserver ?? globalThis.ResizeObserver;
    const observer =
      typeof Observer === "function" ? new Observer(schedule) : null;
    observer?.observe(triggerElement);
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
  }, [schedule, triggerElement]);

  return { menuRef, position };
}

function owningDocumentScrollBoundary(
  trigger: HTMLElement,
): HTMLElement | null {
  return trigger.closest<HTMLElement>(documentScrollBoundarySelector);
}

function actionMenuPlacementViewport(
  trigger: HTMLElement,
  ownerWindow: Window,
): FirstDraftActionMenuPlacementViewport {
  const visual = ownerWindow.visualViewport;
  const browserViewport: FirstDraftActionMenuPlacementViewport = visual
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
  const boundary = owningDocumentScrollBoundary(trigger);
  if (!boundary) return browserViewport;
  const boundaryRect = boundary.getBoundingClientRect();
  const left = Math.max(browserViewport.left, boundaryRect.left);
  const top = Math.max(browserViewport.top, boundaryRect.top);
  const right = Math.min(
    browserViewport.left + browserViewport.width,
    boundaryRect.right,
  );
  const bottom = Math.min(
    browserViewport.top + browserViewport.height,
    boundaryRect.bottom,
  );
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function equalActionMenuPositions(
  left: FirstDraftFixedActionMenuPosition | null,
  right: FirstDraftFixedActionMenuPosition,
): boolean {
  return (
    left !== null &&
    left.left === right.left &&
    left.top === right.top &&
    left.placement === right.placement &&
    left.availableHeight === right.availableHeight
  );
}

function readZero(): number {
  return 0;
}
