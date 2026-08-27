import {
  extractPlainTextFromRichTextDocument,
  richTextBlockInlineContent,
} from "@repo/editor-core/content/rich-text";
import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import type { EditorSemanticChange } from "@repo/editor-web/editor";
import { describe, expect, it, vi } from "vitest";
import { createFirstDraftViewStateStore } from "./blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "./first-draft-definition.tsx";
import { createFirstDraftDocumentTemplate } from "./first-draft-document-template.ts";
import {
  createFirstDraftDefaultSnapshot,
  createFirstDraftSnapshot,
} from "./first-draft-fixture.ts";
import { resetFirstDraftDocument } from "./reset-first-draft-document.ts";
import { initializeTestEditableEditor } from "./test-editor.ts";
import { createFirstDraftOutboundPublisher } from "./transport/outbound-publisher.ts";
import {
  decodeFirstDraftMessage,
  type FirstDraftMessage,
} from "./transport/message-protocol.ts";

describe("First Draft collaborative document reset", () => {
  it("allocates fresh IDs, removes every old subtree, and commits one undoable change", () => {
    const changes: EditorSemanticChange[] = [];
    const editor = createEditor(createFirstDraftSnapshot(), changes);
    const before = editor.readSnapshot();
    const oldIds = new Set(Object.keys(before.blocks));
    const templateIds = new Set(
      createFirstDraftDocumentTemplate().blocks.map((block) => block.id),
    );
    let sequence = 0;

    const result = resetFirstDraftDocument(editor, {
      createBlockId: () => asBlockId(`reset-block-${++sequence}`),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(
      result.fragment.blocks.some(
        (block) =>
          block.type === "heading" &&
          block.plainText ===
            "Turn ideas into actionable plans with a checklist",
      ),
    ).toBe(true);
    expect(
      result.fragment.blocks.some(
        (block) =>
          block.plainText ===
          "A checklist keeps the next decisions visible without turning the document into a separate project tracker.",
      ),
    ).toBe(false);
    const finalRootId = result.fragment.rootBlockIds.at(-1);
    expect(
      result.fragment.blocks.find((block) => block.id === finalRootId)?.type,
    ).toBe("checklist");
    expect(
      result.fragment.blocks.some((block) => block.type === "toggleHeading"),
    ).toBe(false);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("block-graph");
    expect(result.fragment.blocks.every((block) => !oldIds.has(block.id))).toBe(
      true,
    );
    expect(
      result.fragment.blocks.every((block) => !templateIds.has(block.id)),
    ).toBe(true);
    expect(new Set(result.fragment.blocks.map((block) => block.id)).size).toBe(
      result.fragment.blocks.length,
    );
    expect(editor.getRootBlockIds()).toEqual(result.fragment.rootBlockIds);
    expect(
      result.fragment.blocks.find((block) => block.type === "callout")
        ?.metadata,
    ).toEqual({ icon: "note" });
    for (const oldId of oldIds) {
      expect(editor.getBlock(oldId as BlockId)).toBeNull();
    }
    expect(semanticDocument(editor.readSnapshot())).toEqual(
      semanticDocument(createFirstDraftDefaultSnapshot()),
    );
    const table = result.fragment.blocks.find(
      (block) => block.type === "table",
    );
    expect(table).toBeDefined();
    const rows = result.fragment.blocks.filter(
      (block) => block.parentId === table!.id,
    );
    expect(rows).toHaveLength(4);
    const cells = rows.map((row) =>
      result.fragment.blocks.filter((block) => block.parentId === row.id),
    );
    expect(cells.map((row) => row.map((cell) => cell.plainText))).toEqual([
      ["Assignment", "Assignee", "Status"],
      ["Research brief", "Maya Chen", "In progress"],
      ["Interactive prototype", "Noah Williams", "Ready for review"],
      ["Final presentation", "Ava Patel", "Not started"],
    ]);
    expect(
      cells[0]?.map((cell) => richTextBlockInlineContent(cell.content!)),
    ).toEqual([
      [{ type: "text", text: "Assignment", marks: [{ type: "strong" }] }],
      [{ type: "text", text: "Assignee", marks: [{ type: "strong" }] }],
      [{ type: "text", text: "Status", marks: [{ type: "strong" }] }],
    ]);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(semanticDocument(editor.readSnapshot())).toEqual(
      semanticDocument(before),
    );
    editor.dispose();
  });

  it("publishes one proposed transaction that makes a peer converge safely", async () => {
    const frames: ArrayBuffer[] = [];
    const changes: EditorSemanticChange[] = [];
    const publisher = createFirstDraftOutboundPublisher();
    publisher.attachGeneration({
      generationId: "reset-generation",
      socket: {
        readyState: 1,
        send: (frame) => frames.push(frame),
      },
      createTransactionId: sequentialIds("reset-aggregate"),
      publishSelection: vi.fn(),
    });
    publisher.generationCaughtUp();
    const source = initializeTestEditableEditor({
      definition: createDefinition(),
      snapshot: createFirstDraftSnapshot(),
      onChange: (change) => {
        changes.push(change);
        publisher.submitFinalized(change);
      },
      createTransactionId: sequentialIds("reset-source"),
    });
    const peer = createEditor(createFirstDraftSnapshot(), []);
    const selectedOldId = asBlockId("fd-paragraph-intro");
    peer.focusText(selectedOldId, { offset: 1, preventScroll: true });
    let sequence = 0;

    const result = resetFirstDraftDocument(source, {
      createBlockId: () => asBlockId(`shared-reset-${++sequence}`),
    });
    expect(result.ok).toBe(true);
    expect(changes).toHaveLength(1);
    await vi.waitFor(() => expect(frames).toHaveLength(1));

    const decoded = decodeFirstDraftMessage(frames[0]!);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.error);
    const proposed = requireProposed(decoded.message);
    expect(
      peer.applyRemoteTransaction({
        transaction: proposed.transaction,
        authorSelection: { kind: "no-author-selection" },
      }),
    ).toMatchObject({ status: "applied" });
    expect(semanticDocument(peer.readSnapshot())).toEqual(
      semanticDocument(source.readSnapshot()),
    );
    expect(
      JSON.stringify(peer.selectionController.getCanonicalSnapshot()),
    ).not.toContain(selectedOldId);
    source.dispose();
    publisher.dispose();
    peer.dispose();
  });

  it("rejects construction before a transaction and leaves the document unchanged", () => {
    const changes = vi.fn();
    const editor = createEditor(createFirstDraftSnapshot(), [], changes);
    const before = editor.readSnapshot();
    const transaction = vi.spyOn(editor, "transaction");

    const result = resetFirstDraftDocument(editor, {
      createBlockId: () => asBlockId("fd-heading-1"),
    });

    expect(result).toMatchObject({ ok: false });
    expect(transaction).not.toHaveBeenCalled();
    expect(changes).not.toHaveBeenCalled();
    expect(editor.readSnapshot()).toEqual(before);
    editor.dispose();
  });
});

function createEditor(
  snapshot: EditorInstanceSnapshot,
  changes: EditorSemanticChange[],
  onChangeProbe?: (change: EditorSemanticChange) => void,
) {
  return initializeTestEditableEditor({
    definition: createDefinition(),
    snapshot,
    onChange: (change) => {
      changes.push(change);
      onChangeProbe?.(change);
    },
    createTransactionId: sequentialIds("reset-test"),
  });
}

function createDefinition() {
  return createFirstDraftEditorDefinition(createFirstDraftViewStateStore());
}

function sequentialIds(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}:${++sequence}`;
}

function requireProposed(
  message: FirstDraftMessage,
): Extract<
  FirstDraftMessage,
  { readonly type: "proposed-editor-transaction" }
> {
  if (message.type !== "proposed-editor-transaction") {
    throw new Error("Expected one proposed editor transaction");
  }
  return message;
}

function semanticDocument(snapshot: EditorInstanceSnapshot): unknown {
  const visit = (blockId: BlockId): unknown => {
    const block = snapshot.blocks[blockId]!;
    const content = snapshot.content[blockId];
    return {
      type: block.type,
      metadata: normalizeMetadata(block.metadata),
      plainText: content
        ? extractPlainTextFromRichTextDocument(content)
        : undefined,
      inline: content ? richTextBlockInlineContent(content) : undefined,
      children: (snapshot.childIdsByParentId[blockId] ?? []).map(visit),
    };
  };
  return snapshot.rootBlockIds.map(visit);
}

function normalizeMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): unknown {
  if (!metadata) return undefined;
  if (!Array.isArray(metadata.columnIds)) return metadata;
  return {
    ...metadata,
    columnIds: metadata.columnIds.map(
      (_: unknown, index: number) => `column-${index}`,
    ),
    columnWidths: Object.fromEntries(
      Object.values(metadata.columnWidths ?? {}).map((width, index) => [
        `column-${index}`,
        width,
      ]),
    ),
  };
}
