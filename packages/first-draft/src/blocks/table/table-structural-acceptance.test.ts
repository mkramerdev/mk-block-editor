import { describe, expect, it, vi } from "vitest";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import { initializeTestEditableEditor as initializeEditableEditor } from "../../test-editor.ts";
import type { BlockId } from "@repo/editor-core/kernel";
import { createFirstDraftViewStateStore } from "../view-state.tsx";
import { createFirstDraftEditorDefinition } from "../../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../../first-draft-fixture.ts";

const id = (value: string) => value as BlockId;

describe("First Draft table structural acceptance", () => {
  it("rejects an unequal-row deletion before local canonical commit", () => {
    const onChange = vi.fn();
    const editor = addEditorBlockOperations(
      initializeEditableEditor({
        definition: createFirstDraftEditorDefinition(
          createFirstDraftViewStateStore(),
        ),
        snapshot: createFirstDraftSnapshot(),
        onChange,
      }),
    );
    const cellId = id("fd-table-cell-2-2");

    expect(editor.deleteBlock({ blockId: cellId })).toMatchObject({
      ok: false,
      reason: "transaction-rejected",
    });
    expect(editor.getBlock(cellId)).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.canUndo).toBe(false);
    editor.dispose();
  });

  it("rejects an unequal-row remote transaction before installing it", () => {
    const onChange = vi.fn();
    const editor = initializeEditableEditor({
      definition: createFirstDraftEditorDefinition(
        createFirstDraftViewStateStore(),
      ),
      snapshot: createFirstDraftSnapshot(),
      onChange,
    });
    const cellId = id("fd-table-cell-2-2");

    const result = editor.applyRemoteTransaction({
      transaction: {
        transactionId: "remote-unequal-table",
        historyAction: "command",
        graph: { changes: [{ kind: "delete", blockId: cellId }] },
        metadata: null,
        content: [],
      },
      authorSelection: { kind: "no-author-selection" },
    });

    expect(result).toMatchObject({ status: "rejected" });
    expect(editor.getBlock(cellId)).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.canUndo).toBe(false);
    editor.dispose();
  });
});
