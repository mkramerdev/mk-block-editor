import { useLayoutEffect, useState } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EditorImplementation } from "@repo/editor-react/editor";
import type { EditorExternalStore } from "@repo/editor-react/store";
import {
  conventionalHistoryCommands,
  conventionalHistoryKeybindings,
} from "../../api/keybindings.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { compileRegisteredEditorCommands } from "../definition/commands.ts";
import { registerDocumentInteractionOwner } from "../../document/interaction/document-interaction-router.ts";
import { compileEditorKeybindings } from "./compiled-keybindings.ts";
import { createEditorDocumentInputRouting } from "./document-input-routing.ts";

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
    const event = beforeInput("historyUndo");
    editable.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.undo).toHaveBeenCalledOnce();
  });
});

type TestEditor = EditorImplementation & {
  readonly undo: ReturnType<typeof vi.fn>;
  readonly redo: ReturnType<typeof vi.fn>;
  registerExactTarget(target: HTMLElement): void;
};

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
    editor.registerExactTarget(target);
    const store = {
      getSnapshot: () => ({
        overlay: { active: false, id: null, blockId: null, anchor: null },
      }),
    } as EditorExternalStore;
    const input = createEditorDocumentInputRouting(list.ownerDocument, {
      definition: testEditableEditorDefinition,
      store,
      editor: editor as never,
    });
    return registerDocumentInteractionOwner(list.ownerDocument, {
      list,
      deactivate: () => undefined,
      pointerdown: () => undefined,
      pointermove: () => undefined,
      pointerup: () => undefined,
      pointercancel: () => undefined,
      beforeinput: input.beforeinput,
      keydown: input.keydown,
      keyup: () => undefined,
      scroll: () => undefined,
    });
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
  const commands = compileRegisteredEditorCommands(conventionalHistoryCommands);
  const targets = new Set<HTMLElement>();
  return {
    editable: true,
    canUndo: true,
    canRedo: true,
    commands,
    keybindings: compileEditorKeybindings(
      conventionalHistoryKeybindings,
      commands,
    ),
    selection: {
      getSnapshot: () => ({ kind: "none" as const, revision: 0 }),
      subscribe: () => () => undefined,
    },
    ownsNativeFocusTarget: (target: EventTarget | null) =>
      target instanceof HTMLElement && targets.has(target),
    ownsActiveElement: (ownerDocument: Document) =>
      ownerDocument.activeElement instanceof HTMLElement &&
      targets.has(ownerDocument.activeElement),
    registerExactTarget: (target: HTMLElement) => {
      targets.add(target);
    },
    undo: vi.fn(() => ({ status: "history-empty" as const })),
    redo: vi.fn(() => ({ status: "history-empty" as const })),
  } as unknown as TestEditor;
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
