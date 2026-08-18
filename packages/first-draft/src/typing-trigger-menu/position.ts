import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditor } from "@repo/editor-web/editor";

export interface FirstDraftTypingTriggerCaretRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface FirstDraftTypingTriggerViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface FirstDraftTypingTriggerMenuPosition {
  readonly left: number;
  readonly top: number;
  readonly availableHeight: number;
  readonly placement: "top" | "bottom";
}

export const FIRST_DRAFT_TYPING_TRIGGER_VIEWPORT_MARGIN = 8;
export const FIRST_DRAFT_TYPING_TRIGGER_ANCHOR_GAP = 6;

export function placeFirstDraftTypingTriggerMenu(
  caret: FirstDraftTypingTriggerCaretRect,
  menu: { readonly width: number; readonly height: number },
  viewport: FirstDraftTypingTriggerViewport,
): FirstDraftTypingTriggerMenuPosition | null {
  if (menu.width <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }
  const minimumTop = viewport.top + FIRST_DRAFT_TYPING_TRIGGER_VIEWPORT_MARGIN;
  const maximumBottom =
    viewport.top +
    viewport.height -
    FIRST_DRAFT_TYPING_TRIGGER_VIEWPORT_MARGIN;
  const caretBottom = caret.top + caret.height;
  if (caretBottom < viewport.top || caret.top > viewport.top + viewport.height) {
    return null;
  }
  const availableTop = Math.max(
    0,
    caret.top - FIRST_DRAFT_TYPING_TRIGGER_ANCHOR_GAP - minimumTop,
  );
  const availableBottom = Math.max(
    0,
    maximumBottom - caretBottom - FIRST_DRAFT_TYPING_TRIGGER_ANCHOR_GAP,
  );
  const placement = availableTop > availableBottom ? "top" : "bottom";
  const availableHeight = placement === "top" ? availableTop : availableBottom;
  const renderedHeight = Math.min(menu.height, availableHeight);
  const top =
    placement === "top"
      ? caret.top - FIRST_DRAFT_TYPING_TRIGGER_ANCHOR_GAP - renderedHeight
      : caretBottom + FIRST_DRAFT_TYPING_TRIGGER_ANCHOR_GAP;
  const minimumLeft = viewport.left + FIRST_DRAFT_TYPING_TRIGGER_VIEWPORT_MARGIN;
  const maximumLeft = Math.max(
    minimumLeft,
    viewport.left +
      viewport.width -
      FIRST_DRAFT_TYPING_TRIGGER_VIEWPORT_MARGIN -
      menu.width,
  );
  return {
    left: clamp(caret.left, minimumLeft, maximumLeft),
    top,
    availableHeight,
    placement,
  };
}

export function useFirstDraftTypingTriggerMenuPosition(
  geometry: EditableEditor["geometry"],
  blockId: BlockId | null,
  offset: number | null,
): {
  readonly menuRef: RefObject<HTMLDivElement | null>;
  readonly position: FirstDraftTypingTriggerMenuPosition | null;
} {
  const menuRef = useRef<HTMLDivElement>(null);
  const [measurement, setMeasurement] = useState<{
    readonly blockId: BlockId;
    readonly offset: number;
    readonly position: FirstDraftTypingTriggerMenuPosition;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const geometryRevision = useSyncExternalStore(
    blockId ? geometry.subscribe : subscribeNever,
    blockId ? geometry.getRevision : readZero,
    readZero,
  );
  const measure = useCallback(() => {
    frame.current = null;
    const element = menuRef.current;
    if (!element || !blockId || offset === null) {
      setMeasurement(null);
      return;
    }
    const caret = geometry.readViewportTextCaretRect(blockId, offset, "forward");
    if (!caret) {
      setMeasurement(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    const visual = window.visualViewport;
    const position = placeFirstDraftTypingTriggerMenu(
      caret,
      { width: rect.width, height: rect.height },
      visual
        ? {
            left: visual.offsetLeft,
            top: visual.offsetTop,
            width: visual.width,
            height: visual.height,
          }
        : {
            left: 0,
            top: 0,
            width: window.innerWidth,
            height: window.innerHeight,
          },
    );
    setMeasurement(
      position ? { blockId, offset, position } : null,
    );
  }, [blockId, geometry, offset]);
  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(measure);
  }, [measure]);

  useLayoutEffect(() => {
    schedule();
  }, [geometryRevision, schedule]);

  useEffect(() => {
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    const visual = window.visualViewport;
    const element = menuRef.current;
    if (element) observer?.observe(element);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    visual?.addEventListener("resize", schedule);
    visual?.addEventListener("scroll", schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      visual?.removeEventListener("resize", schedule);
      visual?.removeEventListener("scroll", schedule);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [schedule]);

  const position =
    measurement?.blockId === blockId && measurement.offset === offset
      ? measurement.position
      : null;
  return { menuRef, position };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

const subscribeNever = () => () => undefined;
const readZero = () => 0;
