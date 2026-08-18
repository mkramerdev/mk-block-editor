import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";

export function hasEligibleFocusedTextCaret(
  list: HTMLElement,
  editor: EditableEditorRuntimePort,
  selectionBlockId: BlockId,
): boolean {
  return (
    editor.ownsActiveElement(list.ownerDocument) &&
    editor.ownsActiveTextTarget(selectionBlockId)
  );
}
