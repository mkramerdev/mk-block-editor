import type { BlockId } from "@repo/editor-core/kernel";
import type { BlockType } from "@repo/editor-core/document";
import type { EditorView } from "@repo/editor-dom/prosemirror";
import { blockTextCoordinateCodec } from "@repo/editor-dom/caret";
import { resolveRegisteredEditorCommand } from "../commands/command-routing.ts";
import type {
  EditorBlockCommandDefinition,
  EditorBlockCommandExecutionContext,
} from "../definition/contracts.ts";
import type { EditorKeybindingPlatform } from "./chord.ts";
import {
  readKeyboardEventBinding,
  type EditorKeybindingResolution,
  type EditorKeybindingRuntimeContext,
} from "./document-resolver.ts";
export {
  hasConfiguredBlockKeybinding,
  resolveDocumentKeybinding,
  type EditorKeybindingResolution,
  type EditorKeybindingRuntimeContext,
} from "./document-resolver.ts";

export interface EditorBlockKeybindingRuntimeContext extends EditorKeybindingRuntimeContext {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly view: EditorView;
}

export function resolveBlockKeybinding(
  event: KeyboardEvent,
  runtime: EditorBlockKeybindingRuntimeContext,
  platform: EditorKeybindingPlatform,
): EditorKeybindingResolution {
  const bindings = runtime.editor.keybindings.block;
  const binding = readKeyboardEventBinding(event, platform, bindings);
  if (!binding) return { kind: "no-match" };
  const command = resolveRegisteredEditorCommand(
    runtime.editor.commands,
    binding.commandId,
  );
  if (!command || command.scope !== "block") {
    return {
      kind: "failed",
      commandId: binding.commandId,
      message: `Registered block command ${binding.commandId} is unavailable.`,
    };
  }
  const context = createBlockCommandContext(runtime, command);
  if (command.isEnabled?.(context) === false) {
    return { kind: "unavailable", commandId: command.id };
  }
  try {
    return command.execute(context)
      ? { kind: "handled", commandId: command.id }
      : { kind: "unavailable", commandId: command.id };
  } catch (error) {
    return {
      kind: "failed",
      commandId: command.id,
      message:
        error instanceof Error
          ? `Editor command ${command.id} failed: ${error.message}`
          : `Editor command ${command.id} failed.`,
    };
  }
}

function createBlockCommandContext(
  runtime: EditorBlockKeybindingRuntimeContext,
  command: EditorBlockCommandDefinition,
): EditorBlockCommandExecutionContext {
  const selection = runtime.view.state.selection;
  return {
    definition: runtime.definition,
    store: runtime.store,
    editor: runtime.editor,
    blockId: runtime.blockId,
    blockType: runtime.blockType,
    view: runtime.view,
    textSelection: {
      from: blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
        selection.from,
        runtime.view.state,
      ),
      to: blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
        selection.to,
        runtime.view.state,
      ),
    },
    executeStructuralTransaction: (plan) =>
      runtime.editor.executeStructuralTransaction(plan),
    dispatchProseMirrorTransaction: (transaction) =>
      runtime.view.dispatch(transaction),
    request: { commandId: command.id },
  };
}
