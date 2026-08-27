import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorSelectionTextAffinity } from "@repo/editor-react/selection";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import {
  editorBlockShellSelector,
  editorDocumentRootSelector,
  editorTextRootSelector,
} from "../../dom-markers.ts";
import {
  boundedEditorScrollMargin,
  readEditorScrollViewportRect,
  resolveEditorScrollRoot,
  scrollEditorViewportRectIntoView,
  type EditorViewportRectLike,
} from "./scroll-viewport.ts";

const CARET_VISIBILITY_MARGIN_PX = 28;
const EMPTY_BLOCK_FALLBACK_HEIGHT_PX = 32;

interface CaretVisibilityFrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
}

interface CollapsedTextSelection {
  readonly blockId: BlockId;
  readonly offset: number;
  readonly affinity: EditorSelectionTextAffinity | null;
}

type LocalCaretTrigger =
  | { readonly kind: "text-activity" }
  | {
      readonly kind: "control-click";
      readonly selectionBefore: string | null;
    };

export interface EditorCaretVisibilityController {
  dispose(): void;
}

export function createEditorCaretVisibilityController({
  editor,
  list,
  frameScheduler = browserFrameScheduler(list),
}: {
  readonly editor: EditableEditorRuntimePort;
  readonly list: HTMLElement;
  readonly frameScheduler?: CaretVisibilityFrameScheduler;
}): EditorCaretVisibilityController {
  const documentRoot = list.closest<HTMLElement>(editorDocumentRootSelector);
  if (!documentRoot) return { dispose() {} };
  let disposed = false;
  let pendingFrame: number | null = null;
  let pendingAttempt: 0 | 1 = 0;
  let pendingTrigger: LocalCaretTrigger | null = null;

  const schedule = (trigger: LocalCaretTrigger) => {
    if (disposed) return;
    pendingTrigger = trigger;
    if (pendingFrame !== null && pendingAttempt === 0) return;
    if (pendingFrame !== null) frameScheduler.cancel(pendingFrame);
    pendingAttempt = 0;
    pendingFrame = frameScheduler.request(() => runFrame(0));
  };

  const scheduleRetry = (trigger: LocalCaretTrigger) => {
    if (disposed) return;
    pendingTrigger = trigger;
    pendingAttempt = 1;
    pendingFrame = frameScheduler.request(() => runFrame(1));
  };

  const runFrame = (attempt: 0 | 1) => {
    pendingFrame = null;
    const trigger = pendingTrigger;
    pendingTrigger = null;
    if (
      disposed ||
      !trigger ||
      !list.isConnected ||
      !documentRoot.isConnected ||
      !documentRoot.contains(list)
    )
      return;
    const selection = readCollapsedTextSelection(editor);
    if (!selection) return;
    if (
      trigger.kind === "control-click" &&
      selectionSignature(selection) === trigger.selectionBefore
    )
      return;
    const active = resolveActiveTextCaret(editor, list, selection);
    if (!active) return;
    const caretRect = editor.geometry.readViewportTextCaretRect(
      active.blockId,
      active.offset,
      active.affinity ?? undefined,
    );
    if (!caretRect) {
      if (attempt === 0) {
        scheduleRetry(trigger);
        return;
      }
      const fallback = readEmptyBlockFallbackRect(editor, active.blockId);
      if (fallback) revealRect(list, fallback);
      return;
    }
    revealRect(list, caretRect);
  };

  const handleInput = (event: Event) => {
    const target = event.target;
    if (!isOwnedActiveTextRoot(target, list)) return;
    schedule({ kind: "text-activity" });
  };
  const handleKeyDown = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== "Enter") return;
    if (!isOwnedActiveTextRoot(event.target, list)) return;
    schedule({ kind: "text-activity" });
  };
  const handleClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const textRoot = target.closest<HTMLElement>(editorTextRootSelector);
    if (textRoot && list.contains(textRoot)) {
      schedule({ kind: "text-activity" });
      return;
    }
    if (
      target.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
      ) ||
      !target.closest('[data-editor-ui="true"]')
    )
      return;
    schedule({
      kind: "control-click",
      selectionBefore: selectionSignature(readCollapsedTextSelection(editor)),
    });
  };

  documentRoot.addEventListener("input", handleInput, true);
  documentRoot.addEventListener("keydown", handleKeyDown, true);
  documentRoot.addEventListener("click", handleClick, true);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      documentRoot.removeEventListener("input", handleInput, true);
      documentRoot.removeEventListener("keydown", handleKeyDown, true);
      documentRoot.removeEventListener("click", handleClick, true);
      if (pendingFrame !== null) frameScheduler.cancel(pendingFrame);
      pendingFrame = null;
      pendingTrigger = null;
    },
  };
}

function resolveActiveTextCaret(
  editor: EditableEditorRuntimePort,
  list: HTMLElement,
  selection: CollapsedTextSelection | null,
): CollapsedTextSelection | null {
  if (!selection) return null;
  const activeElement = list.ownerDocument.activeElement;
  if (!isOwnedActiveTextRoot(activeElement, list)) return null;
  const shell = activeElement.closest<HTMLElement>(editorBlockShellSelector);
  if (
    !shell ||
    !list.contains(shell) ||
    shell.dataset.editorBlockId !== selection.blockId
  )
    return null;
  const block = editor.getBlock(selection.blockId);
  if (
    !block ||
    block.tombstone ||
    editor.definition.blocks[block.type]?.kind !== "text"
  )
    return null;
  return selection;
}

function isOwnedActiveTextRoot(
  target: EventTarget | null,
  list: HTMLElement,
): target is HTMLElement {
  return (
    target instanceof HTMLElement &&
    target === list.ownerDocument.activeElement &&
    target.matches(editorTextRootSelector) &&
    target.dataset.editorInputOwner === "true" &&
    list.contains(target)
  );
}

function readCollapsedTextSelection(
  editor: EditableEditorRuntimePort,
): CollapsedTextSelection | null {
  const canonical = editor.selectionController.getCanonicalSnapshot();
  if (canonical.kind !== "document") return null;
  const selection = canonical.snapshot.documentSelection;
  const anchor = selection.anchor;
  const focus = selection.focus;
  if (
    !anchor ||
    !focus ||
    anchor.blockId !== focus.blockId ||
    anchor.textOffset !== focus.textOffset
  )
    return null;
  return {
    blockId: focus.blockId,
    offset: focus.textOffset,
    affinity: focus.affinity,
  };
}

function selectionSignature(selection: CollapsedTextSelection | null): string | null {
  return selection
    ? `${selection.blockId}\u0000${selection.offset}\u0000${selection.affinity ?? ""}`
    : null;
}

function readEmptyBlockFallbackRect(
  editor: EditableEditorRuntimePort,
  blockId: BlockId,
): EditorViewportRectLike | null {
  const block = editor.getBlock(blockId);
  if (
    !block ||
    block.tombstone ||
    editor.definition.blocks[block.type]?.kind !== "text" ||
    editor.readBlockPlainText(block.id, block.type).length !== 0
  )
    return null;
  const shell = editor.geometry.readViewportBlockShellRect(blockId);
  if (!shell) return null;
  return {
    left: shell.left,
    top: shell.top,
    width: shell.width,
    height: Math.min(
      Math.max(1, shell.height),
      EMPTY_BLOCK_FALLBACK_HEIGHT_PX,
    ),
  };
}

function revealRect(list: HTMLElement, rect: EditorViewportRectLike): void {
  const scrollRoot = resolveEditorScrollRoot(list);
  const viewportHeight = readEditorScrollViewportRect(scrollRoot).height;
  scrollEditorViewportRectIntoView(scrollRoot, rect, {
    block: {
      alignment: "nearest",
      margin: boundedEditorScrollMargin(
        viewportHeight,
        CARET_VISIBILITY_MARGIN_PX,
      ),
    },
  });
}

function browserFrameScheduler(list: HTMLElement): CaretVisibilityFrameScheduler {
  const view = list.ownerDocument.defaultView;
  return {
    request: (callback) => view?.requestAnimationFrame(callback) ?? 0,
    cancel: (handle) => view?.cancelAnimationFrame(handle),
  };
}
