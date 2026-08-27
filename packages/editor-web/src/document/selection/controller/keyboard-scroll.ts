import type { BlockId } from "@repo/editor-core/kernel";
import {
  isEditorSelectionTextAnchor,
  type EditorKeyboardSelectionKey,
  type EditorLogicalSelectionPoint,
} from "@repo/editor-react/selection";
import type { EditorBlockDomRegistryReader } from "../../blocks/block-dom-registry.ts";
import { textDomPointForOffset } from "../hit-testing/text-hit-testing.ts";
import { editorTextRootSelector } from "../../dom-markers.ts";
import {
  boundedEditorScrollMargin,
  readEditorScrollViewportRect,
  resolveEditorScrollRoot,
  scrollEditorViewportRectIntoView,
  type EditorScrollAlignment,
} from "./scroll-viewport.ts";

const GLOBAL_SELECTION_KEYBOARD_SCROLL_MARGIN_PX = 192;

export function resolveGlobalSelectionScrollRoot(
  list: HTMLElement,
): HTMLElement {
  return resolveEditorScrollRoot(list);
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
  const scrollRoot = resolveGlobalSelectionScrollRoot(list);
  const viewportRect = readEditorScrollViewportRect(scrollRoot);
  scrollEditorViewportRectIntoView(scrollRoot, targetRect, {
    block: {
      alignment: keyboardSelectionScrollBlockAlignment(key),
      margin: boundedEditorScrollMargin(
        viewportRect.height,
        GLOBAL_SELECTION_KEYBOARD_SCROLL_MARGIN_PX,
      ),
    },
    inline: {
      alignment: keyboardSelectionScrollInlineAlignment(key),
      margin: boundedEditorScrollMargin(
        viewportRect.width,
        GLOBAL_SELECTION_KEYBOARD_SCROLL_MARGIN_PX,
      ),
    },
  });
}

function keyboardSelectionScrollBlockAlignment(
  key: EditorKeyboardSelectionKey,
): EditorScrollAlignment {
  return key === "ArrowUp" || key === "ArrowLeft" ? "start" : "end";
}

function keyboardSelectionScrollInlineAlignment(
  key: EditorKeyboardSelectionKey,
): EditorScrollAlignment {
  if (key === "ArrowLeft") return "start";
  if (key === "ArrowRight") return "end";
  return "nearest";
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
