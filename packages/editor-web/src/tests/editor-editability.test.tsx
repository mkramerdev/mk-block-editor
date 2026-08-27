import { describe, expect, it } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { initializeTestEditableEditor } from "./test-editor-initializers.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";

describe("editable editor capability", () => {
  it("exposes the sole document runtime and disposes idempotently", () => {
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        {
          id: "editable-capability-textBlock" as BlockId,
          type: "textBlock",
          text: "editable",
        },
      ]),
    });

    expect(editor.editable).toBe(true);
    expect(editor.transaction).toBeTypeOf("function");
    expect(editor.insertText).toBeTypeOf("function");
    expect(editor.undo).toBeTypeOf("function");
    expect(editor.geometry).toBeTruthy();

    editor.dispose();
    expect(() => editor.dispose()).not.toThrow();
  });
});
