import type { EditorExternalStore } from "@repo/editor-react/store";
import type { EditableEditor } from "../document/contracts.ts";
import type {
  EditorCommandDefinition,
  EditorCommandExecutionResult,
  EditorCommandId,
  EditableEditorDefinition,
  EditorDocumentCommandDefinition,
  EditorDocumentCommandExecutionContext,
} from "../definition/contracts.ts";

export interface EditorDocumentCommandRuntimeContext {
  readonly definition: EditableEditorDefinition;
  readonly store: EditorExternalStore;
  readonly editor: EditableEditor;
}

export function resolveRegisteredEditorCommand(
  commands: ReadonlyMap<EditorCommandId, EditorCommandDefinition>,
  commandId: EditorCommandId,
): EditorCommandDefinition | undefined {
  return commands.get(commandId);
}

export function createEditorDocumentCommandExecutionContext<TPayload = unknown>(
  runtime: EditorDocumentCommandRuntimeContext,
  command: EditorDocumentCommandDefinition<TPayload>,
  payload?: TPayload,
): EditorDocumentCommandExecutionContext<TPayload> {
  return {
    commandId: command.id,
    payload,
    definition: runtime.definition,
    store: runtime.store,
    editor: runtime.editor,
  };
}

export function isRegisteredEditorDocumentCommandEnabled<TPayload = unknown>(
  command: EditorDocumentCommandDefinition<TPayload>,
  context: EditorDocumentCommandExecutionContext<TPayload>,
): boolean {
  return command.isEnabled?.(context) ?? true;
}

export function executeRegisteredEditorDocumentCommand<TPayload = unknown>(
  command: EditorDocumentCommandDefinition<TPayload>,
  context: EditorDocumentCommandExecutionContext<TPayload>,
): EditorCommandExecutionResult {
  if (!isRegisteredEditorDocumentCommandEnabled(command, context)) {
    return {
      ok: false,
      handled: false,
      commandId: command.id,
      reason: "disabled-command",
      message: `Editor command ${command.id} is disabled.`,
    };
  }
  try {
    return normalizeEditorCommandExecutionResult(
      command.id,
      command.execute(context),
    );
  } catch (error) {
    return {
      ok: false,
      handled: false,
      commandId: command.id,
      reason: "handler-error",
      message:
        error instanceof Error
          ? `Editor command ${command.id} failed: ${error.message}`
          : `Editor command ${command.id} failed.`,
    };
  }
}

function normalizeEditorCommandExecutionResult(
  commandId: EditorCommandId,
  result: boolean | void | EditorCommandExecutionResult,
): EditorCommandExecutionResult {
  if (result && typeof result === "object") return result;
  if (result === false) {
    return {
      ok: false,
      handled: true,
      commandId,
      reason: "command-failed",
      message: `Editor command ${commandId} returned false.`,
    };
  }
  return { ok: true, handled: true, commandId };
}
