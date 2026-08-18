import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import {
  initializeTestEditableEditor as initializeEditableEditor,
  initializeTestReadEditor as initializeReadEditor,
} from "./test-editor-initializers.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import {
  testEditableEditorDefinition,
  testReadEditorDefinition,
} from "./test-editor-definition.ts";

const paragraphId = "foundation-read-paragraph" as BlockId;

describe("static editor constructors", () => {
  it("return distinct read and editable capabilities", () => {
    const read = initializeReadEditor({
      definition: testReadEditorDefinition,
      snapshot: snapshot("read"),
    });
    const editable = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: snapshot("edit"),
    });

    expect(read.editable).toBe(false);
    expect(editable.editable).toBe(true);
    expect("transaction" in read).toBe(false);
    expect("insertText" in read).toBe(false);
    expect("undo" in read).toBe(false);
    expect("store" in read).toBe(false);
    expect("transaction" in editable).toBe(true);
    expect(read.geometry).toBeTruthy();
    expect(editable.geometry).toBeTruthy();

    read.dispose();
    editable.dispose();
    expect(() => read.dispose()).not.toThrow();
    expect(() => editable.dispose()).not.toThrow();
  });

});

describe("read editor runtime", () => {
  it("renders canonical rich text without editable projection", () => {
    const editor = initializeReadEditor({
      definition: testReadEditorDefinition,
      snapshot: {
        ...snapshot("bold text"),
        content: {
          [paragraphId]: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "bold", marks: [{ type: "strong" }] },
                  { type: "text", text: " text" },
                ],
              },
            ],
          },
        },
      },
    });
    const view = render(<EditorDocument editor={editor} />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(view.container.querySelector("[contenteditable='true']")).toBeNull();
    expect(view.container.querySelector(".ProseMirror")).toBeNull();
    expect(
      view.container.querySelector("[data-editor-text-root='true']"),
    ).toBeTruthy();
    view.unmount();
    editor.dispose();
  });

  it("does not accept native mutation input", () => {
    const editor = initializeReadEditor({
      definition: testReadEditorDefinition,
      snapshot: snapshot("canonical"),
    });
    const view = render(<EditorDocument editor={editor} />);
    const readRoot = screen.getByText("canonical");
    const before = editor.readBlockContent(paragraphId, "paragraph");
    readRoot.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        inputType: "insertText",
        data: "x",
      }),
    );
    expect(editor.readBlockContent(paragraphId, "paragraph")).toEqual(before);
    expect("canUndo" in editor).toBe(false);
    view.unmount();
    editor.dispose();
  });

  it("rejects a forged public runtime", () => {
    const forged = { editable: false, dispose: vi.fn() };
    expect(() =>
      render(
        <EditorDocument
          editor={
            forged as unknown as Parameters<typeof EditorDocument>[0]["editor"]
          }
        />,
      ),
    ).toThrow(/runtime is unavailable/u);
  });
});

function snapshot(text: string) {
  return createTestEditorSnapshot([
    { id: paragraphId, type: "paragraph", text },
  ]);
}
