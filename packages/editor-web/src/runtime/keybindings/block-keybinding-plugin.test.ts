import { describe, expect, it, vi } from "vitest";
import { createBlockLocalProseMirrorState } from "@repo/editor-dom/block-editor";
import { EditorView } from "@repo/editor-dom/prosemirror";
import type { EditorImplementation } from "@repo/editor-react/editor";
import type { EditorExternalStore } from "@repo/editor-react/store";
import type {
  EditorCommandDefinition,
  EditorKeyBinding,
} from "../definition/contracts.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { compileRegisteredEditorCommands } from "../definition/commands.ts";
import { compileEditorKeybindings } from "./compiled-keybindings.ts";
import { createEditorKeybindingPlugin } from "./block-keybinding-plugin.ts";

describe("mounted block keybinding integration", () => {
  it("gives a configured block binding the first opportunity", () => {
    const blockExecute = vi.fn(() => true);
    const documentExecute = vi.fn();
    const behavior = behaviorWithSharedChord(
      {
        id: "product.block-first",
        scope: "block",
        execute: blockExecute,
      },
      {
        id: "product.document-second",
        scope: "document",
        execute: documentExecute,
      },
    );
    const handled = invokePlugin(behavior, keyboardEvent("b", true));

    expect(handled).toBe(true);
    expect(blockExecute).toHaveBeenCalledOnce();
    expect(documentExecute).not.toHaveBeenCalled();
  });

  it("falls through when the matching block command is unavailable", () => {
    const blockExecute = vi.fn(() => true);
    const documentExecute = vi.fn();
    const behavior = behaviorWithSharedChord(
      {
        id: "product.block-disabled",
        scope: "block",
        isEnabled: () => false,
        execute: blockExecute,
      },
      {
        id: "product.document-shadowed",
        scope: "document",
        execute: documentExecute,
      },
    );

    expect(invokePlugin(behavior, keyboardEvent("b", true))).toBe(false);
    expect(blockExecute).not.toHaveBeenCalled();
    expect(documentExecute).not.toHaveBeenCalled();
  });

  it("leaves document bindings to the document interaction owner", () => {
    const execute = vi.fn();
    const command: EditorCommandDefinition = {
      id: "product.document-from-block",
      scope: "document",
      execute,
    };
    const behavior = {
      commands: [command],
      keybindings: [{ key: "Mod-k", commandId: command.id, scope: "document" }],
    } as const;

    expect(invokePlugin(behavior, keyboardEvent("k", true))).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("leaves composition-owned keydown untouched", () => {
    const execute = vi.fn(() => true);
    const command: EditorCommandDefinition = {
      id: "product.composition-guard",
      scope: "block",
      execute,
    };
    const behavior = {
      commands: [command],
      keybindings: [{ key: "Mod-b", commandId: command.id, scope: "block" }],
    } as const;
    const event = keyboardEvent("b", true);
    Object.defineProperty(event, "isComposing", { value: true });

    expect(invokePlugin(behavior, event)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("leaves semantically claimed product input untouched", () => {
    const execute = vi.fn(() => true);
    const command: EditorCommandDefinition = {
      id: "product.claimed-input-guard",
      scope: "block",
      execute,
    };
    const behavior = {
      commands: [command],
      keybindings: [{ key: "Mod-b", commandId: command.id, scope: "block" }],
    } as const;
    const event = keyboardEvent("b", true);
    event.preventDefault();

    expect(invokePlugin(behavior, event)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});

function behaviorWithSharedChord(
  block: EditorCommandDefinition,
  document: EditorCommandDefinition,
) {
  return {
    commands: [block, document],
    keybindings: [
      { key: "Mod-b", commandId: block.id, scope: "block" },
      { key: "Mod-b", commandId: document.id, scope: "document" },
    ],
  };
}

function invokePlugin(
  behavior: {
    readonly commands: readonly EditorCommandDefinition[];
    readonly keybindings: readonly EditorKeyBinding[];
  },
  event: KeyboardEvent,
): boolean {
  const state = createBlockLocalProseMirrorState({
    blockId: "keybinding-plugin-block" as never,
    blockType: "paragraph",
    doc: "text",
  });
  const dom = document.createElement("div");
  const view = new EditorView({ mount: dom }, { state });
  const commands = compileRegisteredEditorCommands(behavior.commands);
  const editor = {
    commands,
    keybindings: compileEditorKeybindings(behavior.keybindings, commands),
  } as unknown as EditorImplementation;
  const store = {
    getSnapshot: () => ({
      overlay: { active: false, id: null, blockId: null, anchor: null },
    }),
  } as EditorExternalStore;
  const plugin = createEditorKeybindingPlugin({
    definition: testEditableEditorDefinition,
    store,
    editor,
    blockId: "keybinding-plugin-block" as never,
    blockType: "paragraph",
  });
  const handleKeyDown = plugin.props.handleKeyDown;
  if (!handleKeyDown) throw new Error("Missing keybinding plugin handler.");
  try {
    return handleKeyDown(view, event);
  } finally {
    view.destroy();
  }
}

function keyboardEvent(key: string, control: boolean): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    ctrlKey: control,
    bubbles: true,
    cancelable: true,
  });
}
