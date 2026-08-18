import {
  isRichTextDocument,
  richTextDocumentContentSize,
} from "@repo/editor-core/content/rich-text";
import type {
  EditorBlockCommandDefinition,
  EditorBlockCommandExecutionContext,
} from "@repo/editor-web/document-runtime";
import type { EditorKeyBinding } from "@repo/editor-web/keybindings";

export const TABLE_CELL_BOUNDARY_BACKSPACE_COMMAND_ID =
  "first-draft.table-cell.boundary-backspace";
export const TABLE_CELL_BOUNDARY_DELETE_COMMAND_ID =
  "first-draft.table-cell.boundary-delete";

export const firstDraftTableCellBoundaryCommands = Object.freeze([
  Object.freeze({
    id: TABLE_CELL_BOUNDARY_BACKSPACE_COMMAND_ID,
    scope: "block",
    execute: (context: EditorBlockCommandExecutionContext) =>
      isCollapsedTableCellSelection(context) &&
      context.textSelection.from === 0,
  }),
  Object.freeze({
    id: TABLE_CELL_BOUNDARY_DELETE_COMMAND_ID,
    scope: "block",
    execute: (context: EditorBlockCommandExecutionContext) => {
      if (!isCollapsedTableCellSelection(context)) return false;
      const content = context.editor.readBlockContent(
        context.blockId,
        context.blockType,
      );
      return (
        isRichTextDocument(content) &&
        context.textSelection.from === richTextDocumentContentSize(content)
      );
    },
  }),
] satisfies readonly EditorBlockCommandDefinition[]);

export const firstDraftTableCellBoundaryKeybindings = Object.freeze([
  Object.freeze({
    key: "Backspace",
    commandId: TABLE_CELL_BOUNDARY_BACKSPACE_COMMAND_ID,
    scope: "block",
  }),
  Object.freeze({
    key: "Delete",
    commandId: TABLE_CELL_BOUNDARY_DELETE_COMMAND_ID,
    scope: "block",
  }),
] satisfies readonly EditorKeyBinding[]);

function isCollapsedTableCellSelection(
  context: EditorBlockCommandExecutionContext,
): boolean {
  return (
    context.blockType === "tableCell" &&
    !context.view.composing &&
    context.view.state.selection.empty &&
    context.textSelection.from === context.textSelection.to
  );
}
