import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { Block, BlockType } from "@repo/editor-core/document";
import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  type CanonicalBlockFragment,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import { describe, expect, it, vi } from "vitest";
import type { EditorRuntimePort } from "../runtime/document/render-port.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";
import { initializeTestEditableEditor } from "./test-editor-initializers.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";

const rootId = "01890f07-1c00-7000-8000-000000009001" as BlockId;
const wrapperId = "01890f07-1c00-7000-8000-000000009002" as BlockId;
const childId = "01890f07-1c00-7000-8000-000000009003" as BlockId;

describe("ordinary terminal-child reads and canonical application insertion", () => {
  it("reads maintained root and direct-child sequence tails without flattened traversal", () => {
    const editor = createEditor([
      block(rootId, "paragraph"),
      block(wrapperId, "callout"),
      block(childId, "paragraph", wrapperId),
    ]);
    const runtime = editor as EditorRuntimePort;
    const previous = vi.spyOn(runtime, "getPreviousBlock");
    const next = vi.spyOn(runtime, "getNextBlock");

    expect(editor.getLastChildBlockId(null)).toBe(wrapperId);
    expect(editor.getLastChildBlockId(wrapperId)).toBe(childId);
    expect(editor.getLastChildBlockId(childId)).toBeNull();
    expect(previous).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    editor.dispose();
  });

  it("inserts canonical fragments at exact root and wrapper placements in one transaction each", () => {
    const published = vi.fn();
    const editor = createEditor(
      [
        block(rootId, "paragraph"),
        block(wrapperId, "callout"),
        block(childId, "paragraph", wrapperId),
      ],
      published,
    );

    const rootFragment = paragraphFragment("");
    const rootResult = editor.insertCanonicalBlockFragment(
      { parentId: null, childIndex: 2 },
      rootFragment,
    );
    expect(rootResult).toMatchObject({ ok: true, changed: true });
    const rootInsertedId = rootFragment.rootBlockIds[0]!;
    expect(editor.getLastChildBlockId(null)).toBe(rootInsertedId);
    expect(published).toHaveBeenCalledTimes(1);

    const nestedFragment = paragraphFragment("");
    const nestedResult = editor.insertCanonicalBlockFragment(
      { parentId: wrapperId, childIndex: 1 },
      nestedFragment,
    );
    expect(nestedResult).toMatchObject({ ok: true, changed: true });
    const nestedInsertedId = nestedFragment.rootBlockIds[0]!;
    expect(editor.getLastChildBlockId(wrapperId)).toBe(nestedInsertedId);
    expect(editor.getBlock(nestedInsertedId)?.parentId).toBe(wrapperId);
    expect(published).toHaveBeenCalledTimes(2);
    editor.dispose();
  });

  it("inserts fully materialized definition structure", () => {
    const editor = createEditor([block(rootId, "paragraph")]);
    const fragment = calloutFragment();
    const result = editor.insertCanonicalBlockFragment(
      { parentId: null, childIndex: 1 },
      fragment,
    );
    expect(result).toMatchObject({ ok: true, changed: true });
    const insertedRootId = fragment.rootBlockIds[0]!;
    const createdChild = editor.getLastChildBlockId(insertedRootId);
    expect(createdChild).not.toBeNull();
    expect(editor.getBlock(createdChild!)?.type).toBe("paragraph");
    expect(editor.readBlockContent(createdChild!, "paragraph")).toStrictEqual(
      createBlockRichTextContentFromPlainText("paragraph", ""),
    );

    expect(editor.getBlock(insertedRootId)?.type).toBe("callout");
    editor.dispose();
  });

  it("publishes the finalized semantic update before releasing content observers", () => {
    const order: string[] = [];
    const transactions: unknown[] = [];
    const editor = createEditor([block(rootId, "paragraph")], (change) => {
      order.push("semantic");
      transactions.push(change);
    });
    const runtime = editor as EditorRuntimePort;
    const fragment = paragraphFragment("committed");
    const insertedId = fragment.rootBlockIds[0]!;
    const unsubscribeContent = runtime.contentRuntime.subscribeBlockProjection(
      insertedId,
      () => {
        order.push(
          `content:${runtime.selectionController.canonical.getSnapshot().kind}`,
        );
      },
    );

    const result = editor.insertCanonicalBlockFragment(
      { parentId: null, childIndex: 1 },
      fragment,
    );

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(order).toEqual(["semantic", "content:document"]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      kind: "block-graph",
      contentChanges: [
        {
          kind: "block-content",
          blockId: insertedId,
          update: {
            kind: "operation",
            format: "editor-local-rich-text",
            version: 1,
          },
        },
      ],
    });

    unsubscribeContent();
    editor.dispose();
  });

  it("rejects unknown fragment types, missing or leaf parents, and invalid child sequences without fallback", () => {
    const strictWrapperId = "01890f07-1c00-7000-8000-000000009004" as BlockId;
    const strictChildId = "01890f07-1c00-7000-8000-000000009005" as BlockId;
    const editor = createEditor([
      block(rootId, "paragraph"),
      block(strictWrapperId, "quote"),
      block(strictChildId, "paragraph", strictWrapperId),
    ]);
    const initialRootTail = editor.getLastChildBlockId(null);

    expect(
      editor.insertCanonicalBlockFragment(
        { parentId: null, childIndex: 2 },
        unknownTextFragment(),
      ),
    ).toMatchObject({ ok: false });
    expect(
      editor.insertCanonicalBlockFragment(
        {
          parentId: "01890f07-1c00-7000-8000-000000009099" as BlockId,
          childIndex: 0,
        },
        paragraphFragment(""),
      ),
    ).toMatchObject({ ok: false });
    expect(
      editor.insertCanonicalBlockFragment(
        { parentId: rootId, childIndex: 0 },
        paragraphFragment(""),
      ),
    ).toMatchObject({ ok: false });
    expect(
      editor.insertCanonicalBlockFragment(
        { parentId: strictWrapperId, childIndex: 1 },
        paragraphFragment(""),
      ),
    ).toMatchObject({ ok: false });
    expect(editor.getLastChildBlockId(null)).toBe(initialRootTail);
    expect(editor.getLastChildBlockId(strictWrapperId)).toBe(strictChildId);
    editor.dispose();
  });
});

function createEditor(
  blocks: readonly Block[],
  onChange?: (transaction: unknown) => void,
) {
  const byId = Object.fromEntries(
    blocks.map((candidate) => [candidate.id, candidate]),
  ) as Record<BlockId, Block>;
  const rootBlockIds = blocks
    .filter((candidate) => candidate.parentId === null)
    .map((candidate) => candidate.id);
  const childIdsByParentId = {} as Partial<Record<BlockId, BlockId[]>>;
  for (const candidate of blocks) {
    if (!candidate.parentId) continue;
    (childIdsByParentId[candidate.parentId] ??= []).push(candidate.id);
  }
  const contentBase = createTestEditorSnapshot(
    blocks.map((candidate) => ({ id: candidate.id, type: candidate.type })),
  );
  return initializeTestEditableEditor({
    definition: testEditableEditorDefinition,
    snapshot: {
      blockGraphVersion: 1,
      blocks: byId,
      rootBlockIds,
      childIdsByParentId,
      content: contentBase.content,
      opaqueContentCheckpoints: contentBase.opaqueContentCheckpoints,
    },
    onChange,
  });
}

function paragraphFragment(text: string): CanonicalBlockFragment {
  const content = createBlockRichTextContentFromPlainText("paragraph", text);
  const paragraph = createCanonicalBlockRecord({
    type: "paragraph",
    content,
    plainText: text,
  });
  return createCanonicalBlockFragment({
    blocks: [paragraph],
    rootBlockIds: [paragraph.id],
    start: { kind: "block", blockId: paragraph.id },
    end: { kind: "block", blockId: paragraph.id },
    blockDefinitions: testEditableEditorDefinition.blocks,
  });
}

function calloutFragment(): CanonicalBlockFragment {
  const callout = createCanonicalBlockRecord({ type: "callout" });
  const content = createBlockRichTextContentFromPlainText("paragraph", "");
  const paragraph = createCanonicalBlockRecord({
    type: "paragraph",
    parentId: callout.id,
    content,
    plainText: "",
  });
  return createCanonicalBlockFragment({
    blocks: [callout, paragraph],
    rootBlockIds: [callout.id],
    start: { kind: "block", blockId: callout.id },
    end: { kind: "block", blockId: callout.id },
    blockDefinitions: testEditableEditorDefinition.blocks,
  });
}

function unknownTextFragment(): CanonicalBlockFragment {
  const content = createBlockRichTextContentFromPlainText("paragraph", "");
  const record = createCanonicalBlockRecord({
    type: "missing" as BlockType,
    content,
    plainText: "",
  });
  return createCanonicalBlockFragment({
    blocks: [record],
    rootBlockIds: [record.id],
    start: { kind: "block", blockId: record.id },
    end: { kind: "block", blockId: record.id },
  });
}

function block(
  id: BlockId,
  type: BlockType,
  parentId: BlockId | null = null,
): Block {
  return createBlockRecord({ id, type, parentId });
}
