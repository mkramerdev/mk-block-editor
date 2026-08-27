import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEditorExternalStore,
  createInitialEditorSessionState,
} from "@repo/editor-react/store";
import { asBlockId } from "@repo/editor-core/kernel";
import type { EditorView } from "@repo/editor-dom/prosemirror";
import { createBlockLocalProseMirrorState } from "@repo/editor-dom/block-editor";
import type {
  EditorCommandDefinition,
  EditorBlockCommandExecutionContext,
  EditorKeyBinding,
} from "../definition/contracts.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { normalizeKeyboardEventChord } from "./chord.ts";
import {
  executeStructuralTextBoundaryCommand,
  resolveBlockKeybinding,
  resolveDocumentKeybinding,
} from "./resolver.ts";
import type { EditorKeybindingRuntimeContext } from "./document-resolver.ts";
import { initializeTestEditableEditor } from "../../tests/test-editor-initializers.ts";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { resolveEditorRuntimePort } from "../document/runtime-port-registry.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000903");
const liveEditors: ReturnType<typeof initializeTestEditableEditor>[] = [];

afterEach(() => {
  for (const editor of liveEditors.splice(0)) editor.dispose();
});

describe("editor keybinding resolver", () => {
  it.each([
    ["other", { ctrlKey: true }, "Mod-z"],
    ["apple", { metaKey: true }, "Mod-z"],
    ["other", { ctrlKey: true, shiftKey: true }, "Shift-Mod-z"],
    ["apple", { metaKey: true, shiftKey: true }, "Shift-Mod-z"],
  ] as const)(
    "normalizes platform Mod on %s",
    (platform, modifiers, expected) => {
      expect(
        normalizeKeyboardEventChord(keyboardShape("Z", modifiers), platform),
      ).toBe(expected);
    },
  );

  it("matches exact chords and rejects extra modifiers", () => {
    const execute = vi.fn();
    const behavior = documentBehavior(execute);
    const runtime = documentRuntime(behavior.commands, behavior.keybindings);

    expect(
      resolveDocumentKeybinding(
        keyboardEvent("s", { ctrlKey: true }),
        runtime,
        "other",
      ).kind,
    ).toBe("handled");
    expect(execute).toHaveBeenCalledOnce();
    expect(
      resolveDocumentKeybinding(
        keyboardEvent("s", { ctrlKey: true, altKey: true }),
        runtime,
        "other",
      ).kind,
    ).toBe("no-match");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("supports explicit Control separately when no Mod binding conflicts", () => {
    const execute = vi.fn();
    const command: EditorCommandDefinition = {
      id: "product.control",
      scope: "document",
      execute,
    };
    const keybindings = [
      {
        key: "Control-k",
        commandId: command.id,
        scope: "document",
      },
    ] as const;
    expect(
      resolveDocumentKeybinding(
        keyboardEvent("k", { ctrlKey: true }),
        documentRuntime([command], keybindings),
        "other",
      ).kind,
    ).toBe("handled");
  });

  it("keeps AltGraph and composition in the text-input route", () => {
    const altGraph = keyboardShape("e", {
      ctrlKey: true,
      altKey: true,
      altGraph: true,
    });
    expect(normalizeKeyboardEventChord(altGraph, "other")).toBeNull();
    expect(
      normalizeKeyboardEventChord(
        keyboardShape("z", { ctrlKey: true, isComposing: true }),
        "other",
      ),
    ).toBeNull();
  });

  it("reports unavailable commands without executing them", () => {
    const execute = vi.fn();
    const command: EditorCommandDefinition = {
      id: "product.disabled",
      scope: "document",
      isEnabled: () => false,
      execute,
    };
    const keybindings = [
      { key: "Mod-d", commandId: command.id, scope: "document" },
    ] as const;
    expect(
      resolveDocumentKeybinding(
        keyboardEvent("d", { ctrlKey: true }),
        documentRuntime([command], keybindings),
        "other",
      ),
    ).toEqual({ kind: "unavailable", commandId: command.id });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes explicit block commands through their mounted view context", () => {
    const execute = vi.fn(() => true);
    const command: EditorCommandDefinition = {
      id: "product.strong",
      scope: "block",
      execute,
    };
    const keybindings = [
      { key: "Mod-b", commandId: command.id, scope: "block" },
    ] as const;
    const view = blockView();
    const result = resolveBlockKeybinding(
      keyboardEvent("b", { ctrlKey: true }),
      {
        ...documentRuntime([command], keybindings),
        blockId,
        blockType: "textBlock",
        view,
      },
      "other",
    );
    expect(result).toEqual({ kind: "handled", commandId: command.id });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        view,
        textSelection: { from: 0, to: 0 },
        request: { commandId: command.id },
      }),
    );
  });

  it("leaves an unaccepted block command unhandled", () => {
    const command: EditorCommandDefinition = {
      id: "product.block-unavailable",
      scope: "block",
      execute: () => false,
    };
    const keybindings = [
      { key: "Tab", commandId: command.id, scope: "block" },
    ] as const;

    expect(
      resolveBlockKeybinding(
        keyboardEvent("Tab"),
        {
          ...documentRuntime([command], keybindings),
          blockId,
          blockType: "textBlock",
          view: blockView(),
        },
        "other",
      ),
    ).toEqual({ kind: "unavailable", commandId: command.id });
  });

  it.each(["textBlock", "alternateTextBlock"] as const)(
    "delivers the complete neutral structural request for opaque type %s",
    (blockType) => {
      const contexts: EditorBlockCommandExecutionContext[] = [];
      const execute = vi.fn((context: EditorBlockCommandExecutionContext) => {
        contexts.push(context);
        return true;
      });
      const command: EditorCommandDefinition = {
        id: "neutral.structural-enter",
        scope: "block",
        execute,
      };
      const runtime = documentRuntime(
        [command],
        [{ key: "Enter", commandId: command.id, scope: "block" }],
        blockType,
      );
      const view = blockView(blockType);
      const handled = executeStructuralTextBoundaryCommand(
        {
          key: "enter",
          cursorOffset: 1,
          selectionRange: { from: 1, to: 3 },
          isComposing: false,
        },
        { ...runtime, blockId, blockType, view },
      );

      expect(handled).toBe(true);
      const context = contexts[0];
      expect(context?.structuralTextBoundary).toMatchObject({
        intent: "enter",
        focusedBlock: { id: blockId, type: blockType },
        selection: { from: 1, to: 3 },
        isComposing: false,
      });
      expect(context?.structuralTextBoundary?.graph.getRootBlockIds()).toEqual([
        blockId,
      ]);
      expect(
        context?.structuralTextBoundary?.readBlockPlainText(blockId, blockType),
      ).toBe("text");
      expect(
        context?.structuralTextBoundary?.executeStructuralTransaction,
      ).toBeTypeOf("function");
    },
  );

  it("does not mutate when no structural command handles the request", () => {
    const runtime = documentRuntime([], [], "alternateTextBlock");
    const view = blockView("alternateTextBlock");
    const roots = runtime.editor.getRootBlockIds();
    const content = runtime.editor.readBlockPlainText(
      blockId,
      "alternateTextBlock",
    );
    expect(
      executeStructuralTextBoundaryCommand(
        {
          key: "enter",
          cursorOffset: 2,
          isComposing: false,
        },
        {
          ...runtime,
          blockId,
          blockType: "alternateTextBlock",
          view,
        },
      ),
    ).toBe(false);
    expect(runtime.editor.getRootBlockIds()).toEqual(roots);
    expect(
      runtime.editor.readBlockPlainText(blockId, "alternateTextBlock"),
    ).toBe(content);
  });
});

function documentBehavior(execute: () => void) {
  const command: EditorCommandDefinition = {
    id: "product.save",
    scope: "document",
    execute,
  };
  return {
    commands: [command],
    keybindings: [{ key: "Mod-s", commandId: command.id, scope: "document" }],
  } satisfies {
    readonly commands: readonly EditorCommandDefinition[];
    readonly keybindings: readonly EditorKeyBinding[];
  };
}

function documentRuntime(
  commandDefinitions: readonly EditorCommandDefinition[],
  bindingDefinitions: readonly EditorKeyBinding[],
  blockType: "textBlock" | "alternateTextBlock" = "textBlock",
): EditorKeybindingRuntimeContext {
  const editor = initializeTestEditableEditor({
    definition: {
      ...testEditableEditorDefinition,
      commands: commandDefinitions,
      keybindings: bindingDefinitions,
    },
    snapshot: createTestEditorSnapshot([
      { id: blockId, type: blockType, text: "text" },
    ]),
  });
  liveEditors.push(editor);
  return {
    definition: editor.definition,
    store: createEditorExternalStore(createInitialEditorSessionState({})),
    editor: resolveEditorRuntimePort(editor),
  };
}

function blockView(
  blockType: "textBlock" | "alternateTextBlock" = "textBlock",
): EditorView {
  return {
    state: createBlockLocalProseMirrorState({
      blockId,
      blockType,
      doc: "text",
    }),
  } as EditorView;
}

function keyboardEvent(
  key: string,
  modifiers: KeyboardEventInit = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    cancelable: true,
    bubbles: true,
    ...modifiers,
  });
}

function keyboardShape(
  key: string,
  options: {
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    isComposing?: boolean;
    altGraph?: boolean;
  },
) {
  return {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
    isComposing: options.isComposing ?? false,
    getModifierState: (modifier: string) =>
      modifier === "AltGraph" && (options.altGraph ?? false),
  };
}
