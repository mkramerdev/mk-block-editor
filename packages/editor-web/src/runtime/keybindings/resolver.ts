import type { BlockId } from "@repo/editor-core/kernel";
import type { BlockType } from "@repo/editor-core/document";
import type { EditorView } from "@repo/editor-dom/prosemirror";
import type { BlockDomKeyBehaviorEvent } from "@repo/editor-dom/block-editor";
import { blockTextCoordinateCodec } from "@repo/editor-dom/caret";
import { resolveRegisteredEditorCommand } from "../commands/command-routing.ts";
import type {
  EditorBlockCommandDefinition,
  EditorBlockCommandExecutionContext,
  EditorStructuralTextBoundaryRequest,
} from "../definition/contracts.ts";
import {
  normalizeEditorKeyChord,
  type EditorKeybindingPlatform,
} from "./chord.ts";
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

/** Routes one neutral block-local structural boundary through registered commands. */
export function executeStructuralTextBoundaryCommand(
  event: BlockDomKeyBehaviorEvent,
  runtime: EditorBlockKeybindingRuntimeContext,
): boolean {
  if (event.isComposing) return false;
  const block = runtime.editor.getBlock(runtime.blockId);
  if (!block || block.tombstone) return false;
  const chord = normalizeEditorKeyChord(
    event.key === "shiftTab"
      ? "Shift-Tab"
      : event.key === "enter"
        ? "Enter"
        : event.key === "backspace"
          ? "Backspace"
          : event.key === "delete"
            ? "Delete"
            : "Tab",
  );
  const binding = runtime.editor.keybindings.block.get(chord);
  if (!binding) return false;
  const command = resolveRegisteredEditorCommand(
    runtime.editor.commands,
    binding.commandId,
  );
  if (!command || command.scope !== "block") return false;
  const selection = event.selectionRange ?? {
    from: event.cursorOffset,
    to: event.cursorOffset,
  };
  const boundary: EditorStructuralTextBoundaryRequest = {
    intent: event.key,
    focusedBlock: block,
    selection,
    graph: {
      getBlock: (blockId) => runtime.editor.getBlock(blockId),
      getParentId: (blockId) => runtime.editor.getParentId(blockId),
      getRootBlockIds: () => runtime.editor.getRootBlockIds(),
      getChildBlockIds: (parentId) => runtime.editor.getChildBlockIds(parentId),
    },
    readBlockContent: (blockId, blockType) =>
      runtime.editor.readBlockContent(blockId, blockType),
    readBlockPlainText: (blockId, blockType) =>
      runtime.editor.readBlockPlainText(blockId, blockType),
    executeStructuralTransaction: (plan) =>
      runtime.editor.executeStructuralTransaction(plan),
    isComposing: false,
  };
  const context = createBlockCommandContext(
    runtime,
    command,
    { commandId: command.id },
    boundary,
  );
  if (command.isEnabled?.(context) === false) return false;
  try {
    return command.execute(context);
  } catch {
    return false;
  }
}

function createBlockCommandContext(
  runtime: EditorBlockKeybindingRuntimeContext,
  command: EditorBlockCommandDefinition,
  request = { commandId: command.id },
  structuralTextBoundary?: EditorStructuralTextBoundaryRequest,
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
    request,
    ...(structuralTextBoundary ? { structuralTextBoundary } : {}),
  };
}
