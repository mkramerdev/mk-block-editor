import { extractPlainTextFromRichTextDocument } from "@repo/editor-core/content/rich-text";
import { asBlockId } from "@repo/editor-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { initializeTestEditableEditor as initializeEditableEditor } from "../../tests/test-editor-initializers.ts";
import type { EditorSemanticChange } from "../document/contracts.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000009101");

describe("direct remote content transactions", () => {
  it("accepts native binary operation envelopes without publishing a local change", () => {
    const snapshot = createTestEditorSnapshot([
      { id: blockId, type: "paragraph", text: "A" },
    ]);
    let donorChange:
      | import("../document/contracts.ts").EditorSemanticChange
      | null = null;
    const donor = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
      onChange: (change) => {
        donorChange = change;
      },
    });
    expect(donor.insertText({ blockId, offset: 1, text: "X" })).toBe(true);
    const contentChange = requireContentChange(donorChange);
    const update = contentChange.yjsUpdate;
    if (update.kind !== "operation")
      throw new Error("Expected transport operation update");

    const onChange = vi.fn();
    const receiver = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
      onChange,
    });
    const result = receiver.applyRemoteTransaction({
      transaction: {
        transactionId: "remote-binary-content-1",
        historyAction: "command",
        graph: null,
        metadata: null,
        content: [
          {
            blockId,
            blockType: "paragraph",
            update,
            readProjection: contentChange.readProjection,
          },
        ],
      },
      authorSelection: { kind: "no-author-selection" },
    });

    expect(result.status).toBe("applied");
    const content = receiver.readBlockContent(blockId, "paragraph");
    expect(content && extractPlainTextFromRichTextDocument(content)).toBe("AX");
    expect(onChange).not.toHaveBeenCalled();
    donor.dispose();
    receiver.dispose();
  });
});

function requireContentChange(
  change: EditorSemanticChange | null,
): Extract<EditorSemanticChange, { readonly kind: "block-content" }> {
  expect(change).not.toBeNull();
  if (!change || change.kind !== "block-content") {
    throw new Error("Expected donor content change");
  }
  return change;
}
