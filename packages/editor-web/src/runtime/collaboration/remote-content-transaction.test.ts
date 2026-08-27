import { extractPlainTextFromRichTextDocument } from "@repo/editor-core/content/rich-text";
import { asBlockId } from "@repo/editor-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { initializeTestEditableEditor as initializeEditableEditor } from "../../tests/test-editor-initializers.ts";
import type { EditorSemanticChange } from "../document/contracts.ts";
import type { EditableEditorRuntimePort } from "../document/render-port.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000009101");

describe("direct remote content transactions", () => {
  it("rejects stale anchored undo without relocating to duplicate local content", () => {
    const snapshot = createTestEditorSnapshot([
      { id: blockId, type: "textBlock", text: "XYZabcdef" },
    ]);
    const source = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
    });
    expect(source.insertText({ blockId, offset: 3, text: "XYZ" })).toBe(true);

    let donorChange: EditorSemanticChange | null = null;
    const donor = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "XYZXYZabcdef" },
      ]),
      onChange: (change) => {
        donorChange = change;
      },
    });
    expect(donor.insertText({ blockId, offset: 4, text: "Q" })).toBe(true);
    const contentChange = requireContentChange(donorChange);
    expect(
      source.applyRemoteTransaction({
        transaction: {
          transactionId: "remote-duplicate-anchor-content",
          historyAction: "command",
          graph: null,
          metadata: null,
          content: [
            {
              blockId,
              blockType: "textBlock",
              update: contentChange.yjsUpdate,
              readProjection: contentChange.readProjection,
            },
          ],
        },
        authorSelection: { kind: "no-author-selection" },
      }),
    ).toMatchObject({ status: "applied" });
    expect(source.readBlockPlainText(blockId, "textBlock")).toBe(
      "XYZXQYZabcdef",
    );
    const history = source as unknown as {
      readonly history: readonly { readonly state: string }[];
      readonly historyIndex: number;
    };

    expect(source.undo()).toMatchObject({
      status: "operation-application-failed",
    });
    expect(source.readBlockPlainText(blockId, "textBlock")).toBe(
      "XYZXQYZabcdef",
    );
    expect(history.historyIndex).toBe(1);
    expect(history.history[0]?.state).toBe("applied");
    donor.dispose();
    source.dispose();
  });

  it("accepts native binary operation envelopes without publishing a local change", () => {
    const snapshot = createTestEditorSnapshot([
      { id: blockId, type: "textBlock", text: "A" },
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
            blockType: "textBlock",
            update,
            readProjection: contentChange.readProjection,
          },
        ],
      },
      authorSelection: { kind: "no-author-selection" },
    });

    expect(result.status).toBe("applied");
    const content = receiver.readBlockContent(blockId, "textBlock");
    expect(content && extractPlainTextFromRichTextDocument(content)).toBe("AX");
    expect(onChange).not.toHaveBeenCalled();
    donor.dispose();
    receiver.dispose();
  });

  it("rebases a canonical caret on remote ingress and additional presence on a local commit", () => {
    const snapshot = createTestEditorSnapshot([
      { id: blockId, type: "textBlock", text: "abcd" },
    ]);
    let donorChange: EditorSemanticChange | null = null;
    const donor = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
      onChange: (change) => {
        donorChange = change;
      },
    });
    const caretReceiver = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
    });
    expect(caretReceiver.focusText(blockId, { offset: 2 })).toEqual({
      status: "pending",
    });
    expect(donor.insertText({ blockId, offset: 0, text: "X" })).toBe(true);
    const contentChange = requireContentChange(donorChange);

    expect(
      caretReceiver.applyRemoteTransaction({
        transaction: {
          transactionId: "remote-canonical-caret-rebase",
          historyAction: "command",
          graph: null,
          metadata: null,
          content: [
            {
              blockId,
              blockType: "textBlock",
              update: contentChange.yjsUpdate,
              readProjection: contentChange.readProjection,
            },
          ],
        },
        authorSelection: { kind: "no-author-selection" },
      }),
    ).toMatchObject({ status: "applied" });
    expect(
      caretReceiver.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({
      kind: "document",
      snapshot: {
        documentSelection: {
          anchor: { blockId, textOffset: 3 },
          focus: { blockId, textOffset: 3 },
        },
      },
    });

    const presenceReceiver = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
    });
    const point = (
      presenceReceiver as EditableEditorRuntimePort
    ).createSelectionTextPoint(blockId, 2);
    if (!point) throw new Error("Expected stable Yjs presence point");
    const stablePoint = {
      kind: "text" as const,
      blockId: point.blockId,
      textOffset: point.textOffset,
      textAnchor: point.textAnchor,
      affinity: point.affinity,
    };
    presenceReceiver.setSelections({
      entries: [
        {
          subject: {
            actorId: "remote-actor",
            clientId: "remote-client",
            sessionId: "remote-session",
          },
          selectionRevision: 7,
          selection: {
            kind: "selection",
            selection: {
              kind: "document",
              direction: "forward",
              anchor: stablePoint,
              focus: stablePoint,
            },
          },
        },
      ],
    });
    expect(presenceReceiver.insertText({ blockId, offset: 0, text: "X" })).toBe(
      true,
    );
    expect(
      presenceReceiver.additionalSelections.getSnapshot()[0],
    ).toMatchObject({
      watermark: 7,
      resolvedSelection: {
        kind: "document",
        anchor: { blockId, textOffset: 3 },
        focus: { blockId, textOffset: 3 },
      },
    });

    donor.dispose();
    caretReceiver.dispose();
    presenceReceiver.dispose();
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
