import { useLayoutEffect, useState } from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEditorExternalStore,
  createInitialEditorSessionState,
} from "@repo/editor-react/store";
import { asBlockId } from "@repo/editor-core/kernel";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { initializeTestEditableEditor } from "../../tests/test-editor-initializers.ts";
import { registerDocumentInteractionOwner } from "../../document/interaction/document-interaction-router.ts";
import type {
  EditorCommandDefinition,
  EditorKeyBinding,
} from "../definition/contracts.ts";
import { resolveEditorRuntimePort } from "../document/runtime-port-registry.ts";
import type { EditableEditorRuntimePort } from "../document/render-port.ts";
import { createEditorDocumentInputRouting } from "./document-input-routing.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000905");
const historyCommands = [
  {
    id: "test.history.undo",
    scope: "document",
    execute: ({ editor }) => {
      editor.undo();
    },
  },
  {
    id: "test.history.redo",
    scope: "document",
    execute: ({ editor }) => {
      editor.redo();
    },
  },
] satisfies readonly EditorCommandDefinition[];
const historyKeybindings = [
  { key: "Mod-z", commandId: "test.history.undo", scope: "document" },
  { key: "Mod-y", commandId: "test.history.redo", scope: "document" },
] satisfies readonly EditorKeyBinding[];
const liveEditors: TestEditor[] = [];

afterEach(() => {
  for (const editor of liveEditors.splice(0)) editor.dispose();
});

describe("exact document command ownership", () => {
  it("routes a configured shortcut from the editor's active exact target", () => {
    const editor = historyEditor();
    const view = render(<RoutingHarness editor={editor} />);
    const editable = view.getByTestId("editable");
    editable.focus();
    const event = keydown("z", { ctrlKey: true });
    editable.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.undo).toHaveBeenCalledOnce();
  });

  it.each(["Backspace", "Delete"])(
    "does not intercept %s in an external input with retained selection",
    (key) => {
      const editor = historyEditor();
      const view = render(
        <>
          <RoutingHarness editor={editor} />
          <input data-testid="external" />
        </>,
      );
      const external = view.getByTestId("external");
      external.focus();
      const event = keydown(key, {});
      external.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(editor.undo).not.toHaveBeenCalled();
      expect(editor.redo).not.toHaveBeenCalled();
    },
  );

  it("does not route commands from an editor-native control", () => {
    const editor = historyEditor();
    const view = render(<RoutingHarness editor={editor} />);
    const control = view.getByTestId("control");
    control.focus();
    const event = keydown("z", { ctrlKey: true });
    control.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(editor.undo).not.toHaveBeenCalled();
  });

  it("does not route another editor's active element", () => {
    const first = historyEditor();
    const second = historyEditor();
    const view = render(
      <>
        <RoutingHarness editor={first} testId="first" />
        <RoutingHarness editor={second} testId="second" />
      </>,
    );
    const secondEditable = view.getByTestId("second-editable");
    secondEditable.focus();
    secondEditable.dispatchEvent(keydown("y", { ctrlKey: true }));

    expect(first.redo).not.toHaveBeenCalled();
    expect(second.redo).toHaveBeenCalledOnce();
  });

  it("routes native history input only from the exact active text target", () => {
    const editor = historyEditor();
    const view = render(<RoutingHarness editor={editor} />);
    const editable = view.getByTestId("editable");
    editable.focus();
    const resolveNativeFocusTarget = vi.spyOn(
      editor.runtime,
      "resolveNativeFocusTarget",
    );
    const event = beforeInput("historyUndo");
    editable.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.undo).toHaveBeenCalledOnce();
    expect(resolveNativeFocusTarget).toHaveBeenCalledOnce();
  });

  it("bypasses native focus resolution for ordinary beforeinput", () => {
    const editor = historyEditor();
    const view = render(<RoutingHarness editor={editor} />);
    const editable = view.getByTestId("editable");
    editable.focus();
    const resolveNativeFocusTarget = vi.spyOn(
      editor.runtime,
      "resolveNativeFocusTarget",
    );
    editable.dispatchEvent(beforeInput("insertText"));

    expect(resolveNativeFocusTarget).not.toHaveBeenCalled();
    expect(editor.undo).not.toHaveBeenCalled();
    expect(editor.redo).not.toHaveBeenCalled();
  });
});

interface TestEditor {
  readonly runtime: EditableEditorRuntimePort;
  readonly undo: ReturnType<typeof vi.fn>;
  readonly redo: ReturnType<typeof vi.fn>;
  registerExactTarget(target: HTMLElement): () => void;
  dispose(): void;
}

function RoutingHarness({
  editor,
  testId = "",
}: {
  readonly editor: TestEditor;
  readonly testId?: string;
}) {
  const [list, setList] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!list) return undefined;
    const target = list.querySelector<HTMLElement>("[data-editor-text-root]");
    if (!target) throw new Error("Missing exact text target");
    editor.runtime.bindNativeFocusOwnerDocument(list.ownerDocument);
    const unregisterTarget = editor.registerExactTarget(target);
    const store = createEditorExternalStore(
      createInitialEditorSessionState({}),
    );
    const input = createEditorDocumentInputRouting(list.ownerDocument, {
      definition: testEditableEditorDefinition,
      store,
      editor: editor.runtime,
    });
    const unregisterInteraction = registerDocumentInteractionOwner(
      list.ownerDocument,
      {
        list,
        revokeNativeSelectionOwnership: () => undefined,
        releaseInteraction: () => undefined,
        pointerdown: () => undefined,
        pointermove: () => undefined,
        pointerup: () => undefined,
        pointercancel: () => undefined,
        beforeinput: (event) => {
          if (
            event.inputType !== "historyUndo" &&
            event.inputType !== "historyRedo"
          ) {
            return;
          }
          input.beforeinput(
            event,
            editor.runtime.resolveNativeFocusTarget(event.target),
          );
        },
        keydown: (event) =>
          input.keydown(
            event,
            editor.runtime.resolveNativeFocusTarget(event.target),
          ),
        keyup: () => undefined,
        scroll: () => undefined,
      },
    );
    return () => {
      unregisterInteraction();
      unregisterTarget();
    };
  }, [editor, list]);
  const prefix = testId ? `${testId}-` : "";
  return (
    <div data-editor-interaction-scope="true">
      <button data-testid={`${prefix}control`} type="button" />
      <div ref={setList} data-editor-block-list-root="true">
        <div
          data-testid={`${prefix}editable`}
          data-editor-text-root="true"
          contentEditable
          tabIndex={-1}
        />
      </div>
    </div>
  );
}

function historyEditor(): TestEditor {
  const editor = initializeTestEditableEditor({
    definition: {
      ...testEditableEditorDefinition,
      commands: historyCommands,
      keybindings: historyKeybindings,
    },
    snapshot: createTestEditorSnapshot([{ id: blockId, type: "atomicBlock" }]),
  });
  const runtime = resolveEditorRuntimePort(editor);
  const undo = vi.fn(runtime.undo.bind(runtime));
  const redo = vi.fn(runtime.redo.bind(runtime));
  const testEditor = {
    runtime,
    undo,
    redo,
    registerExactTarget: (target: HTMLElement) =>
      runtime.registerAtomicFocusTarget(blockId, target),
    dispose: () => editor.dispose(),
  };
  vi.spyOn(runtime, "undo").mockImplementation(testEditor.undo);
  vi.spyOn(runtime, "redo").mockImplementation(testEditor.redo);
  liveEditors.push(testEditor);
  return testEditor;
}

function keydown(key: string, init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

function beforeInput(inputType: string): InputEvent {
  return new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType,
  });
}
