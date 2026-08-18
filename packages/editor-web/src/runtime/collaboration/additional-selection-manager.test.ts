import { asBlockId } from "@repo/editor-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { createEditorSelectionTextAnchor } from "@repo/editor-react/selection";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import type { EditorSemanticChange } from "../document/contracts.ts";
import { initializeTestEditableEditor as initializeEditableEditor } from "../../tests/test-editor-initializers.ts";
import type { EditorRuntimePort } from "../document/render-port.ts";

const textBlockId = asBlockId("selection-color-text");
const atomicBlockId = asBlockId("selection-color-divider");
const subject = {
  actorId: "actor-a",
  clientId: "client-a",
  sessionId: "session-a",
};
const selection = {
  kind: "selection" as const,
  selection: {
    kind: "document" as const,
    direction: "forward" as const,
    anchor: {
      kind: "block" as const,
      blockId: atomicBlockId,
      surface: "block" as const,
    },
    focus: {
      kind: "block" as const,
      blockId: atomicBlockId,
      surface: "block" as const,
    },
  },
};

describe("additional selection color state", () => {
  it("notifies for same-revision color changes and safely rejects invalid colors", () => {
    const editor = createEditor();
    const notify = vi.fn();
    editor.additionalSelections.subscribe(notify);

    editor.setSelections({
      entries: [{ subject, selectionRevision: 7, selection }],
    });
    expect(editor.additionalSelections.getSnapshot()[0]?.color).toBeNull();

    notify.mockClear();
    editor.setSelections({
      entries: [{ subject, selectionRevision: 7, selection, color: "#123456" }],
    });
    expect(notify).toHaveBeenCalledOnce();
    expect(editor.additionalSelections.getSnapshot()[0]?.color).toBe("#123456");

    notify.mockClear();
    editor.setSelections({
      entries: [{ subject, selectionRevision: 7, selection, color: "red" }],
    });
    expect(notify).toHaveBeenCalledOnce();
    expect(editor.additionalSelections.getSnapshot()[0]?.color).toBeNull();
    editor.dispose();
  });

  it("preserves participant color while graph/content invalidation re-resolves", () => {
    const snapshot = createSnapshot();
    let donorChange: EditorSemanticChange | null = null;
    const donor = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
      onChange: (change) => {
        donorChange = change;
      },
    });
    const receiver = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
    });
    receiver.setSelections({
      entries: [{ subject, selectionRevision: 3, selection, color: "#abcdef" }],
    });
    expect(
      donor.insertText({ blockId: textBlockId, offset: 1, text: "X" }),
    ).toBe(true);
    if (!donorChange || donorChange.kind !== "block-content") {
      throw new Error("Expected donor content change");
    }
    const result = receiver.applyRemoteTransaction({
      transaction: {
        transactionId: "selection-color-reresolve",
        historyAction: "command",
        graph: null,
        metadata: null,
        content: [
          {
            blockId: textBlockId,
            blockType: "paragraph",
            update: donorChange.yjsUpdate,
            readProjection: donorChange.readProjection,
          },
        ],
      },
      authorSelection: { kind: "no-author-selection" },
    });

    expect(result.status).toBe("applied");
    expect(receiver.additionalSelections.getSnapshot()[0]).toMatchObject({
      color: "#abcdef",
      resolution: "resolved",
      watermark: 3,
    });
    donor.dispose();
    receiver.dispose();
  });

  it("projects repeated inactive text presence without acquiring block content", () => {
    const source = createEditor();
    const sourceRuntime = source as EditorRuntimePort;
    const sourceLease = sourceRuntime.contentRuntime.acquireBlockContent(
      textBlockId,
      "paragraph",
      "canonical-transaction",
    );
    const encoded = sourceRuntime.contentRuntime.createTextAnchorInContext(
      sourceLease,
      { textOffset: 1, affinity: null },
    );
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) throw new Error("Expected a source text anchor");
    const stableAnchor = createEditorSelectionTextAnchor({
      codec: encoded.codec,
      payload: encoded.payload,
    });
    expect(stableAnchor.ok).toBe(true);
    if (!stableAnchor.ok) throw new Error("Expected a stable text anchor");
    sourceLease.release();
    source.dispose();

    const receiver = createEditor();
    const runtime = receiver as EditorRuntimePort;
    const acquire = vi.spyOn(runtime.contentRuntime, "acquireBlockContent");
    for (let revision = 1; revision <= 100; revision += 1) {
      const point = {
        kind: "text" as const,
        blockId: textBlockId,
        textOffset: revision % 2,
        textAnchor: stableAnchor.textAnchor,
        affinity: null,
      };
      receiver.setSelections({
        entries: [
          {
            subject,
            selectionRevision: revision,
            selection: {
              kind: "selection",
              selection: {
                kind: "document",
                direction: "forward",
                anchor: point,
                focus: point,
              },
            },
          },
        ],
      });
      expect(acquire).not.toHaveBeenCalled();
    }
    receiver.dispose();
  });
});

function createEditor() {
  return initializeEditableEditor({
    definition: testEditableEditorDefinition,
    snapshot: createSnapshot(),
  });
}

function createSnapshot() {
  return createTestEditorSnapshot([
    { id: textBlockId, type: "paragraph", text: "A" },
    { id: atomicBlockId, type: "divider" },
  ]);
}
