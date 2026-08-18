import type { BlockId } from "@repo/editor-core/kernel";
import { EditorImmutableBinary } from "@repo/editor-core/content/rich-text";
import type {
  CanonicalEditorCommit,
  EditorImplementation,
} from "@repo/editor-react/editor";
import { describe, expect, it, vi } from "vitest";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import type { EditorContentRuntime } from "../content/content-runtime.ts";
import type { EditorTypingTriggerSessionController } from "../typing-triggers/session-controller.ts";
import { finalizeCanonicalEditorCommit } from "./canonical-commit-finalizer.ts";

describe("finalizeCanonicalEditorCommit", () => {
  it("reconciles first and publishes a minimal incremental content receipt", () => {
    const blockId = "finalizer-content" as BlockId;
    const snapshot = createTestEditorSnapshot([
      { id: blockId, type: "paragraph", text: "a" },
    ]);
    const update = {
      kind: "operation" as const,
      format: "test",
      version: 1,
      payload: EditorImmutableBinary.copyOf(new Uint8Array([4])),
    };
    const operation = {
      kind: "insertInlineContent" as const,
      blockId,
      blockType: "paragraph" as const,
      target: { kind: "text" as const },
      position: { blockId, offset: 1, contentVersion: null },
      content: [{ type: "text" as const, text: "@" }],
    };
    const receipt: CanonicalEditorCommit = {
      kind: "content",
      transactionId: "1:1",
      baseDocumentRevision: 1,
      documentRevision: 2,
      selectionBefore: { kind: "none" },
      selectionAfter: { kind: "none" },
      historyAction: "command",
      provenance: { kind: "typing", text: "@", inputType: "text" },
      blockId,
      blockType: "paragraph",
      operations: [operation],
      inverseOperations: [],
      yjsUpdate: update,
    };
    const order: string[] = [];
    const readBlockProjection = vi.fn(
      () => snapshot.content[blockId]!,
    );
    const editor = {
      getEditorInfo: () => ({ blockGraphVersion: 1 }),
      getManifestData: () => ({
        blocks: snapshot.blocks,
        rootBlockIds: snapshot.rootBlockIds,
        childIdsByParentId: snapshot.childIdsByParentId,
      }),
      getBlock: (id: BlockId) => snapshot.blocks[id] ?? null,
    } as unknown as EditorImplementation;
    const contentRuntime = {
      readBlockProjection,
    } as unknown as EditorContentRuntime;
    const reconcileFinalizedLocalMutation = vi.fn(() => order.push("trigger"));
    const published = vi.fn(() => {
      order.push("public");
      throw new Error("consumer failed");
    });
    const publicationError = vi.fn();

    const change = finalizeCanonicalEditorCommit(receipt, {
      editor,
      contentRuntime,
      blockDefinitions: testEditableEditorDefinition.blocks,
      typingTriggerController: {
        reconcileFinalizedLocalMutation,
      } as unknown as EditorTypingTriggerSessionController,
      onChange: published,
      onChangeError: publicationError,
    });

    expect(order).toEqual(["trigger", "public"]);
    expect(reconcileFinalizedLocalMutation).toHaveBeenCalledWith(
      receipt.provenance,
    );
    expect(readBlockProjection).toHaveBeenCalledOnce();
    expect(change).toMatchObject({
      kind: "block-content",
      blockId,
      operations: [operation],
      yjsUpdate: update,
    });
    expect(change).not.toHaveProperty("blockSlice");
    expect(change).not.toHaveProperty("provenance");
    expect(published).toHaveBeenCalledOnce();
    expect(publicationError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "consumer failed" }),
    );
  });
});
