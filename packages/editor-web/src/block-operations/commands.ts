import { isBlockEditorComposing } from "@repo/editor-dom/block-editor";
import { blockTextCoordinateCodec } from "@repo/editor-dom/caret";
import type {
  EditorBlockCommandDefinition,
  EditorBlockCommandExecutionContext,
  EditorKeyBinding,
} from "../runtime/definition/contracts.ts";
import type { EditorWithBlockOperations } from "./editor-extension.ts";

export const INDENT_BLOCK_COMMAND_ID = "editor.block.indent";
export const OUTDENT_BLOCK_COMMAND_ID = "editor.block.outdent";

const indentBlockCommand: EditorBlockCommandDefinition<EditorWithBlockOperations> =
  Object.freeze({
    id: INDENT_BLOCK_COMMAND_ID,
    scope: "block",
    execute: (
      context: EditorBlockCommandExecutionContext<EditorWithBlockOperations>,
    ) => executeIndentationCommand(context, "indent"),
  });

const outdentBlockCommand: EditorBlockCommandDefinition<EditorWithBlockOperations> =
  Object.freeze({
    id: OUTDENT_BLOCK_COMMAND_ID,
    scope: "block",
    execute: (
      context: EditorBlockCommandExecutionContext<EditorWithBlockOperations>,
    ) => executeIndentationCommand(context, "outdent"),
  });

export const blockOperationCommands = Object.freeze([
  indentBlockCommand,
  outdentBlockCommand,
]);

export const blockOperationKeybindings = Object.freeze([
  Object.freeze({
    key: "Tab",
    commandId: INDENT_BLOCK_COMMAND_ID,
    scope: "block" as const,
  }),
  Object.freeze({
    key: "Shift-Tab",
    commandId: OUTDENT_BLOCK_COMMAND_ID,
    scope: "block" as const,
  }),
]) satisfies readonly EditorKeyBinding[];

function executeIndentationCommand(
  context: Parameters<
    EditorBlockCommandDefinition<EditorWithBlockOperations>["execute"]
  >[0],
  direction: "indent" | "outdent",
): boolean {
  const { editor, view } = context;
  if (
    isBlockEditorComposing(view.state) ||
    !view.state.selection.empty
  ) {
    return false;
  }
  const offset =
    blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
      view.state.selection.head,
      view.state,
    );
  const result =
    direction === "indent"
      ? editor.indentBlock({ blockId: context.blockId, offset })
      : editor.outdentBlock({ blockId: context.blockId, offset });
  return result.ok && result.handled;
}
