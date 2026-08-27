import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";

export function hasEligibleFocusedTextCaret(
  list: HTMLElement,
  editor: EditableEditorRuntimePort,
  selectionBlockId: BlockId,
): boolean {
  const resolved = editor.resolveNativeFocusTarget(
    list.ownerDocument.activeElement,
  );
  return resolved?.kind === "text" && resolved.blockId === selectionBlockId;
}
