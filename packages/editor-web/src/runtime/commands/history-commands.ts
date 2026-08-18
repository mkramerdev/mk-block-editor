import {
  EDITOR_REDO_COMMAND_ID,
  EDITOR_UNDO_COMMAND_ID,
  type EditorHistoryResult,
} from "@repo/editor-react/editor";
import type {
  EditorCommandExecutionResult,
  EditorDocumentCommandDefinition,
  EditorDocumentCommandExecutionContext,
} from "../definition/contracts.ts";

export const conventionalHistoryCommands: readonly EditorDocumentCommandDefinition[] =
  Object.freeze([
    Object.freeze({
      id: EDITOR_UNDO_COMMAND_ID,
      scope: "document" as const,
      isEnabled: (context: EditorDocumentCommandExecutionContext) =>
        context.editor.canUndo,
      execute: (context: EditorDocumentCommandExecutionContext) =>
        historyCommandResult(EDITOR_UNDO_COMMAND_ID, context.editor.undo()),
    }),
    Object.freeze({
      id: EDITOR_REDO_COMMAND_ID,
      scope: "document" as const,
      isEnabled: (context: EditorDocumentCommandExecutionContext) =>
        context.editor.canRedo,
      execute: (context: EditorDocumentCommandExecutionContext) =>
        historyCommandResult(EDITOR_REDO_COMMAND_ID, context.editor.redo()),
    }),
  ]);

function historyCommandResult(
  commandId: string,
  result: EditorHistoryResult,
): EditorCommandExecutionResult {
  if (result.status === "applied" || result.status === "history-empty") {
    return { ok: true, handled: true, commandId };
  }
  return {
    ok: false,
    handled: true,
    commandId,
    reason: result.status,
    message:
      result.status === "operation-application-failed"
        ? result.message
        : result.reason,
  };
}
