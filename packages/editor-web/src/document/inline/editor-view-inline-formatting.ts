import { blockTextCoordinateCodec } from "@repo/editor-dom/caret";
import { type EditorView } from "@repo/editor-dom/prosemirror";
import type { BlockId } from "@repo/editor-core/kernel";

export function setEditorViewCaretSilently(
  view: EditorView,
  offset: number,
): void {
  const caret = createCollapsedCaretSelection(view, offset);
  if (caret.eq(view.state.selection)) return;
  view.updateState(view.state.apply(view.state.tr.setSelection(caret)));
}

export function createCollapsedCaretSelection(
  view: EditorView,
  offset: number,
) {
  const maxOffset = readEditorViewContentSize(view);
  const normalizedOffset = Number.isFinite(offset)
    ? Math.max(0, Math.trunc(offset))
    : maxOffset;
  return blockTextCoordinateCodec.createCaret(view.state, {
    blockId: "" as BlockId,
    offset: Math.min(normalizedOffset, maxOffset),
  });
}

export function readEditorViewContentSize(view: EditorView): number {
  return blockTextCoordinateCodec.readContentSize(view.state);
}
