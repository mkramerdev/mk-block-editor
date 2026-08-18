import type { EditorExternalStore } from "@repo/editor-react/store";
import type { EditorRuntimePort } from "../document/render-port.ts";
import {
  createEditorDocumentCommandExecutionContext,
  executeRegisteredEditorDocumentCommand,
  resolveRegisteredEditorCommand,
} from "../commands/command-routing.ts";
import type { EditorDefinition } from "../definition/contracts.ts";
import {
  normalizeKeyboardEventChord,
  type EditorKeybindingPlatform,
} from "./chord.ts";

export type EditorKeybindingResolution =
  | { readonly kind: "no-match" }
  | { readonly kind: "unavailable"; readonly commandId: string }
  | { readonly kind: "handled"; readonly commandId: string }
  | {
      readonly kind: "failed";
      readonly commandId: string;
      readonly message?: string;
    };

export interface EditorKeybindingRuntimeContext {
  readonly definition: EditorDefinition;
  readonly store: EditorExternalStore;
  readonly editor: EditorRuntimePort;
}

export function resolveDocumentKeybinding(
  event: KeyboardEvent,
  runtime: EditorKeybindingRuntimeContext,
  platform: EditorKeybindingPlatform,
): EditorKeybindingResolution {
  const bindings = runtime.editor.keybindings.document;
  const binding = readKeyboardEventBinding(event, platform, bindings);
  if (!binding) return { kind: "no-match" };
  const command = resolveRegisteredEditorCommand(
    runtime.editor.commands,
    binding.commandId,
  );
  if (!command || command.scope !== "document") {
    return {
      kind: "failed",
      commandId: binding.commandId,
      message: `Registered document command ${binding.commandId} is unavailable.`,
    };
  }
  const context = createEditorDocumentCommandExecutionContext(runtime, command);
  if (command.isEnabled?.(context) === false) {
    return { kind: "unavailable", commandId: command.id };
  }
  const result = executeRegisteredEditorDocumentCommand(command, context);
  if (result.ok && result.handled) {
    return { kind: "handled", commandId: command.id };
  }
  if (!result.handled && result.reason === "disabled-command") {
    return { kind: "unavailable", commandId: command.id };
  }
  return {
    kind: "failed",
    commandId: command.id,
    ...(result.message === undefined ? {} : { message: result.message }),
  };
}

export function hasConfiguredBlockKeybinding(
  event: KeyboardEvent,
  runtime: EditorKeybindingRuntimeContext,
  platform: EditorKeybindingPlatform,
): boolean {
  return Boolean(
    readKeyboardEventBinding(event, platform, runtime.editor.keybindings.block),
  );
}

export function readKeyboardEventBinding<T>(
  event: KeyboardEvent,
  platform: EditorKeybindingPlatform,
  bindings: ReadonlyMap<string, T>,
): T | undefined {
  const conventionalChord = normalizeKeyboardEventChord(event, platform);
  if (!conventionalChord) return undefined;
  const conventionalBinding = bindings.get(conventionalChord);
  if (conventionalBinding) return conventionalBinding;
  const explicitChord = normalizeKeyboardEventChord(
    event,
    platform,
    "explicit",
  );
  return explicitChord ? bindings.get(explicitChord) : undefined;
}
