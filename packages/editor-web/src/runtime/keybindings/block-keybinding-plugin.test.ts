import { describe, expect, it, vi } from "vitest";
import { createBlockLocalProseMirrorState } from "@repo/editor-dom/block-editor";
import { EditorView } from "@repo/editor-dom/prosemirror";
import {
  createEditorExternalStore,
  createInitialEditorSessionState,
} from "@repo/editor-react/store";
import { asBlockId } from "@repo/editor-core/kernel";
import type {
  EditorCommandDefinition,
  EditorKeyBinding,
} from "../definition/contracts.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { createEditorKeybindingPlugin } from "./block-keybinding-plugin.ts";
import { initializeTestEditableEditor } from "../../tests/test-editor-initializers.ts";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { resolveEditorRuntimePort } from "../document/runtime-port-registry.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000904");

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
  } satisfies {
    readonly commands: readonly EditorCommandDefinition[];
    readonly keybindings: readonly EditorKeyBinding[];
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
    blockId,
    blockType: "paragraph",
    doc: "text",
  });
  const dom = document.createElement("div");
  const view = new EditorView({ mount: dom }, { state });
  const editor = initializeTestEditableEditor({
    definition: {
      ...testEditableEditorDefinition,
      commands: behavior.commands,
      keybindings: behavior.keybindings,
    },
    snapshot: createTestEditorSnapshot([
      { id: blockId, type: "paragraph", text: "text" },
    ]),
  });
  const store = createEditorExternalStore(createInitialEditorSessionState({}));
  const plugin = createEditorKeybindingPlugin({
    definition: testEditableEditorDefinition,
    store,
    editor: resolveEditorRuntimePort(editor),
    blockId,
    blockType: "paragraph",
  });
  const handleKeyDown = plugin.props.handleKeyDown;
  if (!handleKeyDown) throw new Error("Missing keybinding plugin handler.");
  try {
    return handleKeyDown.call(plugin, view, event) ?? false;
  } finally {
    view.destroy();
    editor.dispose();
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
