import type { BlockId } from "@repo/editor-core/kernel";
import {
  isEditorSelectionTextAnchor,
  type EditorKeyboardSelectionKey,
  type EditorLogicalSelectionPoint,
} from "@repo/editor-react/selection";
import type { EditorBlockDomRegistryReader } from "../../blocks/block-dom-registry.ts";
import { textDomPointForOffset } from "../hit-testing/text-hit-testing.ts";
import { editorTextRootSelector } from "../../dom-markers.ts";

const GLOBAL_SELECTION_KEYBOARD_SCROLL_MARGIN_PX = 192;

type KeyboardSelectionScrollAlignment = "start" | "end" | "nearest";

export function resolveGlobalSelectionScrollRoot(
  list: HTMLElement,
): HTMLElement {
  const view = list.ownerDocument.defaultView;
  for (
    let current: HTMLElement | null = list;
    current;
    current = current.parentElement
  ) {
    const style = view?.getComputedStyle(current);
    const overflow = `${style?.overflowY ?? ""} ${style?.overflow ?? ""} ${current.style.overflowY} ${current.style.overflow}`;
    const scrollableOverflow = /auto|scroll|overlay/.test(overflow);
    if (scrollableOverflow) return current;
  }
  const scrollingElement = list.ownerDocument.scrollingElement;
  if (scrollingElement instanceof HTMLElement) return scrollingElement;
  return list.ownerDocument.documentElement;
}

export function scrollKeyboardSelectionFocusIntoView(
  blockDom: EditorBlockDomRegistryReader,
  list: HTMLElement,
  focus: EditorLogicalSelectionPoint,
  key: EditorKeyboardSelectionKey,
): void {
  const shell = resolveKeyboardSelectionFocusShell(
    blockDom,
    list,
    focus.blockId,
  );
  if (!shell) return;
  const targetRect =
    measureKeyboardSelectionFocusRect(shell, focus) ??
    shell.getBoundingClientRect();
  if (!isKeyboardSelectionScrollRect(targetRect)) return;
  scrollRectIntoView(resolveGlobalSelectionScrollRoot(list), targetRect, {
    block: keyboardSelectionScrollBlockAlignment(key),
    inline: keyboardSelectionScrollInlineAlignment(key),
  });
}

function scrollRectIntoView(
  scrollRoot: HTMLElement,
  targetRect: Pick<
    DOMRect,
    "left" | "top" | "right" | "bottom" | "width" | "height"
  >,
  alignment: {
    block: KeyboardSelectionScrollAlignment;
    inline: KeyboardSelectionScrollAlignment;
  },
): void {
  const viewportRect = readKeyboardSelectionScrollViewportRect(scrollRoot);
  if (!isKeyboardSelectionScrollRect(viewportRect)) return;
  const verticalMargin = boundedScrollMargin(
    viewportRect.bottom - viewportRect.top,
  );
  const horizontalMargin = boundedScrollMargin(
    viewportRect.right - viewportRect.left,
  );
  const deltaY = axisDeltaToRevealRange({
    start: targetRect.top,
    end: targetRect.bottom,
    viewportStart: viewportRect.top,
    viewportEnd: viewportRect.bottom,
    margin: verticalMargin,
    alignment: alignment.block,
  });
  const deltaX = axisDeltaToRevealRange({
    start: targetRect.left,
    end: targetRect.right,
    viewportStart: viewportRect.left,
    viewportEnd: viewportRect.right,
    margin: horizontalMargin,
    alignment: alignment.inline,
  });
  if (deltaY !== 0) {
    scrollRoot.scrollTop = clampScrollOffset(
      scrollRoot.scrollTop + deltaY,
      maxKeyboardSelectionScrollTop(scrollRoot),
    );
  }
  if (deltaX !== 0) {
    scrollRoot.scrollLeft = clampScrollOffset(
      scrollRoot.scrollLeft + deltaX,
      maxKeyboardSelectionScrollLeft(scrollRoot),
    );
  }
}

function axisDeltaToRevealRange({
  start,
  end,
  viewportStart,
  viewportEnd,
  margin,
  alignment,
}: {
  start: number;
  end: number;
  viewportStart: number;
  viewportEnd: number;
  margin: number;
  alignment: KeyboardSelectionScrollAlignment;
}): number {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(viewportStart) ||
    !Number.isFinite(viewportEnd)
  )
    return 0;
  if (viewportEnd <= viewportStart) return 0;
  const revealStart = viewportStart + margin;
  const revealEnd = viewportEnd - margin;
  const targetSize = Math.max(0, end - start);
  const revealSize = Math.max(1, revealEnd - revealStart);
  if (targetSize > revealSize) {
    return alignedScrollDelta(start, end, revealStart, revealEnd, alignment);
  }
  if (start < revealStart) return start - revealStart;
  if (end > revealEnd) return end - revealEnd;
  return 0;
}

function alignedScrollDelta(
  start: number,
  end: number,
  revealStart: number,
  revealEnd: number,
  alignment: KeyboardSelectionScrollAlignment,
): number {
  const startDelta = start - revealStart;
  const endDelta = end - revealEnd;
  if (alignment === "start") return startDelta;
  if (alignment === "end") return endDelta;
  return Math.abs(startDelta) <= Math.abs(endDelta) ? startDelta : endDelta;
}

function boundedScrollMargin(viewportSize: number): number {
  if (!Number.isFinite(viewportSize) || viewportSize <= 0) return 0;
  return Math.min(
    GLOBAL_SELECTION_KEYBOARD_SCROLL_MARGIN_PX,
    Math.max(0, viewportSize / 3),
  );
}

function keyboardSelectionScrollBlockAlignment(
  key: EditorKeyboardSelectionKey,
): KeyboardSelectionScrollAlignment {
  return key === "ArrowUp" || key === "ArrowLeft" ? "start" : "end";
}

function keyboardSelectionScrollInlineAlignment(
  key: EditorKeyboardSelectionKey,
): KeyboardSelectionScrollAlignment {
  if (key === "ArrowLeft") return "start";
  if (key === "ArrowRight") return "end";
  return "nearest";
}

function readKeyboardSelectionScrollViewportRect(
  scrollRoot: HTMLElement,
): Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height"> {
  const doc = scrollRoot.ownerDocument;
  const view = doc.defaultView;
  const rootScroller =
    scrollRoot === doc.scrollingElement ||
    scrollRoot === doc.documentElement ||
    scrollRoot === doc.body;
  if (view && rootScroller) {
    const viewport = view.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? view.innerWidth;
    const height = viewport?.height ?? view.innerHeight;
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    };
  }
  return scrollRoot.getBoundingClientRect();
}

function measureKeyboardSelectionFocusRect(
  shell: HTMLElement,
  focus: EditorLogicalSelectionPoint,
): DOMRect | null {
  if (!isEditorSelectionTextAnchor(focus.textAnchor)) return null;
  const textRoot = resolveKeyboardSelectionTextRoot(shell);
  if (!textRoot) return null;
  const textLength = textRoot.textContent?.length ?? 0;
  if (textLength <= 0) return null;
  const startOffset =
    focus.textOffset >= textLength
      ? textLength - 1
      : Math.max(0, focus.textOffset);
  const start = textDomPointForOffset(textRoot, startOffset, textLength);
  const end = textDomPointForOffset(textRoot, startOffset + 1, textLength);
  if (!start || !end) return null;
  const range = textRoot.ownerDocument.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (typeof range.getClientRects !== "function") return null;
    return (
      Array.from(range.getClientRects()).find(isKeyboardSelectionScrollRect) ??
      null
    );
  } finally {
    range.detach?.();
  }
}

function resolveKeyboardSelectionFocusShell(
  blockDom: EditorBlockDomRegistryReader,
  list: HTMLElement,
  blockId: BlockId,
): HTMLElement | null {
  const shell = blockDom.getBlockShell(blockId);
  return shell && list.contains(shell) ? shell : null;
}

function resolveKeyboardSelectionTextRoot(
  shell: HTMLElement,
): HTMLElement | null {
  if (shell.matches(editorTextRootSelector)) return shell;
  return shell.querySelector<HTMLElement>(editorTextRootSelector);
}

function isKeyboardSelectionScrollRect(
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">,
): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.bottom) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    (rect.width > 0 || rect.height > 0)
  );
}

function maxKeyboardSelectionScrollTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function maxKeyboardSelectionScrollLeft(element: HTMLElement): number {
  return Math.max(0, element.scrollWidth - element.clientWidth);
}

function clampScrollOffset(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), max);
}
