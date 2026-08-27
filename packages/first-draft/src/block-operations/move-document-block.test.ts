import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBlockRichTextContentFromPlainText,
  richTextDocumentWithInlineContent,
} from "@repo/editor-core/content/rich-text";
import type { BlockId } from "@repo/editor-core/kernel";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import type { EditorChangeCallback } from "@repo/editor-web/document-runtime";
import { createFirstDraftEditorDefinition } from "../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import { initializeTestEditableEditor } from "../test-editor.ts";
import {
  createFirstDraftViewStateStore,
} from "../blocks/view-state.tsx";
import { moveFirstDraftDocumentBlock } from "./move-document-block.ts";
import { captureFirstDraftDocumentBlockSourcePlacement } from "../block-drag-and-drop/document-drag-session.ts";

const id = (value: string) => value as BlockId;
const editors: Array<{ dispose(): void }> = [];

const listCases = [
  {
    kind: "bullet",
    containerId: id("fd-bullet-list"),
    itemId: id("fd-bullet-1"),
    primaryId: id("fd-bullet-1-text"),
  },
  {
    kind: "ordered",
    containerId: id("fd-ordered-list"),
    itemId: id("fd-ordered-1"),
    primaryId: id("fd-ordered-1-text"),
  },
  {
    kind: "checklist",
    containerId: id("fd-checklist"),
    itemId: id("fd-check-unchecked"),
    primaryId: id("fd-check-unchecked-text"),
  },
] as const;

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose();
  vi.restoreAllMocks();
});

describe("First Draft document list-item extraction", () => {
  it.each([
    {
      name: "empty toggle body",
      targetId: id("fd-toggle-list-body"),
    },
    {
      name: "empty tab pane",
      targetId: id("fd-tab-overview"),
    },
  ])("moves a real block into an $name child-start boundary", ({ targetId }) => {
    const onChange = vi.fn();
    const editor = createEditor(onChange);
    const oldChildren = editor.getChildBlockIds(targetId);
    editor.transaction(() => {
      editor.deleteBlocks({
        blockIds: oldChildren,
        includeDescendants: true,
        expectedParents: Object.fromEntries(
          oldChildren.map((blockId) => [blockId, targetId]),
        ),
      });
      editor.setTransactionSelection({ kind: "clear" });
    });
    const sourceId = id("fd-paragraph-outro");
    onChange.mockClear();

    expect(
      moveCapturedFirstDraftDocumentBlock(editor, sourceId, {
        parentId: targetId,
        childIndex: 0,
      }),
    ).toMatchObject({ ok: true });

    expect(editor.getChildBlockIds(targetId)).toEqual([sourceId]);
    expect(editor.getParentId(sourceId)).toBe(targetId);
    expect(onChange).toHaveBeenCalledOnce();
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.getChildBlockIds(targetId)).toEqual([]);
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(editor.getChildBlockIds(targetId)).toEqual([sourceId]);
  });

  it.each(listCases)(
    "promotes every $kind item child in order and retains a multi-item container",
    (testCase) => {
      const onChange = vi.fn();
      const editor = createEditor(onChange);
      const added = addRichAdditionalChildren(editor, testCase);
      const originalContainerChildren = [
        ...editor.getChildBlockIds(testCase.containerId),
      ];
      const unaffectedItemIds = originalContainerChildren.filter(
        (blockId) => blockId !== testCase.itemId,
      );
      const unaffected = unaffectedItemIds.map((blockId) => ({
        block: editor.getBlock(blockId),
        children: [...editor.getChildBlockIds(blockId)],
        content: editor.readBlockContent(
          editor.getChildBlockIds(blockId)[0]!,
          "paragraph",
        ),
      }));
      const promotedIds = [...editor.getChildBlockIds(testCase.itemId)];
      const promotedContent = promotedIds.map((blockId) => {
        const block = editor.getBlock(blockId)!;
        return editor.definition.blocks[block.type]?.kind === "text"
          ? editor.readBlockContent(blockId, block.type)
          : null;
      });
      const nestedDescendants = collectDescendants(editor, added.nestedListId);
      const selectionBefore = focusAndReadSelection(editor, testCase.primaryId);
      onChange.mockClear();
      const transaction = vi.spyOn(editor, "transaction");

      const result = moveCapturedFirstDraftDocumentBlock(editor, testCase.itemId, {
        parentId: null,
        childIndex: 0,
      });

      expect(result.ok).toBe(true);
      expect(transaction).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledOnce();
      expect(editor.getRootBlockIds().slice(0, promotedIds.length)).toEqual(
        promotedIds,
      );
      expect(editor.getBlock(testCase.itemId)).toBeNull();
      expect(editor.getBlock(testCase.containerId)).not.toBeNull();
      expect(editor.getChildBlockIds(testCase.containerId)).toEqual(
        unaffectedItemIds,
      );
      expect(
        promotedIds.map((blockId) => editor.getParentId(blockId)),
      ).toEqual(promotedIds.map(() => null));
      expect(
        promotedIds.map((blockId) => {
          const block = editor.getBlock(blockId)!;
          return editor.definition.blocks[block.type]?.kind === "text"
            ? editor.readBlockContent(blockId, block.type)
            : null;
        }),
      ).toEqual(promotedContent);
      expect(collectDescendants(editor, added.nestedListId)).toEqual(
        nestedDescendants,
      );
      expect(
        editor.readBlockContent(added.richParagraphId, "paragraph"),
      ).toEqual(RICH_CONTENT);
      expect(readCanonicalSelection(editor)).toEqual(selectionBefore);
      unaffected.forEach((expected, index) => {
        const itemId = unaffectedItemIds[index]!;
        expect(editor.getBlock(itemId)).toEqual(expected.block);
        expect(editor.getChildBlockIds(itemId)).toEqual(expected.children);
        expect(
          editor.readBlockContent(expected.children[0]!, "paragraph"),
        ).toEqual(expected.content);
      });

      expect(editor.undo()).toEqual({ status: "applied" });
      expect(editor.getChildBlockIds(testCase.containerId)).toEqual(
        originalContainerChildren,
      );
      expect(editor.getChildBlockIds(testCase.itemId)).toEqual(promotedIds);
      expect(readCanonicalSelection(editor)).toEqual(selectionBefore);
      expect(editor.redo()).toEqual({ status: "applied" });
      expect(editor.getBlock(testCase.itemId)).toBeNull();
      expect(editor.getRootBlockIds().slice(0, promotedIds.length)).toEqual(
        promotedIds,
      );
    },
  );

  it.each(listCases)(
    "removes a final $kind container and promotes all content at its stable boundary",
    (testCase) => {
      const onChange = vi.fn();
      const editor = createEditor(onChange);
      const added = addRichAdditionalChildren(editor, testCase);
      const otherItems = editor
        .getChildBlockIds(testCase.containerId)
        .filter((blockId) => blockId !== testCase.itemId);
      editor.transaction(() => {
        editor.deleteBlocks({
          blockIds: otherItems,
          includeDescendants: true,
          expectedParents: Object.fromEntries(
            otherItems.map((blockId) => [blockId, testCase.containerId]),
          ),
        });
        editor.setTransactionSelection({ kind: "preserve" });
      });
      const originalRoots = [...editor.getRootBlockIds()];
      const listIndex = originalRoots.indexOf(testCase.containerId);
      const promotedIds = [...editor.getChildBlockIds(testCase.itemId)];
      const nestedDescendants = collectDescendants(editor, added.nestedListId);
      const selectionBefore = focusAndReadSelection(editor, testCase.primaryId);
      onChange.mockClear();
      const transaction = vi.spyOn(editor, "transaction");

      const result = moveCapturedFirstDraftDocumentBlock(editor, testCase.itemId, {
        parentId: null,
        childIndex: listIndex + 1,
      });

      expect(result.ok).toBe(true);
      expect(transaction).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledOnce();
      expect(editor.getBlock(testCase.itemId)).toBeNull();
      expect(editor.getBlock(testCase.containerId)).toBeNull();
      expect(editor.getRootBlockIds().slice(listIndex, listIndex + 3)).toEqual(
        promotedIds,
      );
      expect(editor.readBlockContent(added.richParagraphId, "paragraph")).toEqual(
        RICH_CONTENT,
      );
      expect(collectDescendants(editor, added.nestedListId)).toEqual(
        nestedDescendants,
      );
      expect(readCanonicalSelection(editor)).toEqual(selectionBefore);

      expect(editor.undo()).toEqual({ status: "applied" });
      expect(editor.getRootBlockIds()).toEqual(originalRoots);
      expect(editor.getChildBlockIds(testCase.containerId)).toEqual([
        testCase.itemId,
      ]);
      expect(editor.getChildBlockIds(testCase.itemId)).toEqual(promotedIds);
      expect(editor.redo()).toEqual({ status: "applied" });
      expect(editor.getBlock(testCase.containerId)).toBeNull();
    },
  );

  it("rejects stale, self-descendant, incompatible, malformed, and mismatched graphs without a transaction", () => {
    const scenarios: Array<(
      editor: ReturnType<typeof createEditor>,
    ) => void> = [
      (editor) => {
        const sourcePlacement =
          captureFirstDraftDocumentBlockSourcePlacement(
            editor,
            id("fd-bullet-1"),
          )!;
        editor.transaction(() => {
          editor.deleteBlocks({
            blockIds: [id("fd-bullet-1")],
            includeDescendants: true,
            expectedParents: { [id("fd-bullet-1")]: id("fd-bullet-list") },
          });
          editor.setTransactionSelection({ kind: "preserve" });
        });
        expectRejectedWithoutTransaction(
          editor,
          id("fd-bullet-1"),
          { parentId: null, childIndex: 0 },
          sourcePlacement,
        );
      },
      (editor) =>
        expectRejectedWithoutTransaction(editor, id("fd-bullet-1"), {
          parentId: null,
          childIndex: 100_000,
        }),
      (editor) =>
        expectRejectedWithoutTransaction(editor, id("fd-bullet-1"), {
          parentId: id("fd-bullet-1"),
          childIndex: 1,
        }),
      (editor) => {
        const added = addRichAdditionalChildren(editor, listCases[0]);
        expectRejectedWithoutTransaction(editor, id("fd-bullet-1"), {
          parentId: added.nestedItemId,
          childIndex: 1,
        });
      },
      (editor) =>
        expectRejectedWithoutTransaction(editor, id("fd-bullet-1"), {
          parentId: id("fd-quote"),
          childIndex: 1,
        }),
      (editor) => {
        const original = editor.getChildBlockIds.bind(editor);
        vi.spyOn(editor, "getChildBlockIds").mockImplementation((blockId) =>
          blockId === id("fd-bullet-1") ? [] : original(blockId),
        );
        expectRejectedWithoutTransaction(editor, id("fd-bullet-1"), {
          parentId: null,
          childIndex: 0,
        });
      },
      (editor) => {
        const original = editor.getBlock.bind(editor);
        vi.spyOn(editor, "getBlock").mockImplementation((blockId) => {
          const block = original(blockId);
          return blockId === id("fd-bullet-list") && block
            ? { ...block, type: "orderedList" }
            : block;
        });
        expectRejectedWithoutTransaction(editor, id("fd-bullet-1"), {
          parentId: null,
          childIndex: 0,
        });
      },
    ];

    for (const scenario of scenarios) {
      const editor = createEditor(vi.fn());
      scenario(editor);
      vi.restoreAllMocks();
    }
  });

  it("rejects a source moved to another parent or index after capture", () => {
    for (const moveRemotely of [
      (editor: ReturnType<typeof createEditor>, sourceId: BlockId) =>
        editor.moveBlockToPosition({
          blockId: sourceId,
          position: {
            parentId: id("fd-tab-overview"),
            childIndex: editor.getChildBlockIds(id("fd-tab-overview")).length,
          },
        }),
      (editor: ReturnType<typeof createEditor>, sourceId: BlockId) =>
        editor.moveBlockToPosition({
          blockId: sourceId,
          position: { parentId: null, childIndex: 0 },
        }),
    ]) {
      const editor = createEditor(vi.fn());
      const sourceId = id("fd-paragraph-outro");
      const expectedSource =
        captureFirstDraftDocumentBlockSourcePlacement(editor, sourceId)!;
      expect(moveRemotely(editor, sourceId)).toMatchObject({ ok: true });
      const currentParent = editor.getParentId(sourceId);
      const currentRoots = [...editor.getRootBlockIds()];
      const transaction = vi.spyOn(editor, "transaction");

      const result = moveFirstDraftDocumentBlock(editor, expectedSource, {
        parentId: null,
        childIndex: 1,
      });

      expect(result).toMatchObject({ ok: false, reason: "stale-plan" });
      expect(transaction).not.toHaveBeenCalled();
      expect(editor.getParentId(sourceId)).toBe(currentParent);
      expect(editor.getRootBlockIds()).toEqual(currentRoots);
      transaction.mockRestore();
    }
  });

  it("allows unrelated remote work while revalidating only the captured source", () => {
    const onChange = vi.fn();
    const editor = createEditor(onChange);
    const sourceId = id("fd-paragraph-outro");
    const expectedSource =
      captureFirstDraftDocumentBlockSourcePlacement(editor, sourceId)!;
    expect(
      editor.insertText({
        blockId: id("fd-paragraph-intro"),
        offset: 0,
        text: "Remote ",
      }),
    ).toBe(true);
    const transaction = vi.spyOn(editor, "transaction");
    onChange.mockClear();

    const result = moveFirstDraftDocumentBlock(editor, expectedSource, {
      parentId: null,
      childIndex: 0,
    });

    expect(result).toMatchObject({ ok: true });
    expect(transaction).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    expect(editor.getRootBlockIds()[0]).toBe(sourceId);
  });
});

const RICH_CONTENT = richTextDocumentWithInlineContent(
  "paragraph",
  createBlockRichTextContentFromPlainText("paragraph", ""),
  [
    { type: "text", text: "Marked", marks: [{ type: "strong" }] },
    { type: "text", text: " and " },
    { type: "mention", metadata: { id: "drag-preserved-person" } },
  ],
);

function createEditor(onChange: EditorChangeCallback) {
  const viewState = createFirstDraftViewStateStore();
  const editor = addEditorBlockOperations(
    initializeTestEditableEditor({
      definition: createFirstDraftEditorDefinition(viewState),
      snapshot: createFirstDraftSnapshot(),
      onChange,
    }),
  );
  editors.push(editor);
  return editor;
}

function addRichAdditionalChildren(
  editor: ReturnType<typeof createEditor>,
  testCase: (typeof listCases)[number],
) {
  const prefix = `drag-${testCase.kind}`;
  const richParagraphId = id(`${prefix}-rich`);
  const richResult = editor.insertBlock({
    blockId: testCase.primaryId,
    blockType: "paragraph",
    content: RICH_CONTENT,
    createBlockId: () => richParagraphId,
  });
  expect(richResult.ok).toBe(true);

  const nestedListId = id(`${prefix}-nested-list`);
  const nestedItemId = id(`${prefix}-nested-item`);
  const nestedTextId = id(`${prefix}-nested-text`);
  const ids = [nestedListId, nestedItemId, nestedTextId];
  const nestedResult = editor.insertBlock({
    blockId: richParagraphId,
    blockType: "bulletList",
    plainText: "Nested identity",
    createBlockId: () => ids.shift()!,
  });
  expect(nestedResult.ok).toBe(true);
  expect(ids).toHaveLength(0);
  return { richParagraphId, nestedListId, nestedItemId, nestedTextId };
}

function expectRejectedWithoutTransaction(
  editor: ReturnType<typeof createEditor>,
  blockId: BlockId,
  position: { readonly parentId: BlockId | null; readonly childIndex: number },
  expectedSource = captureFirstDraftDocumentBlockSourcePlacement(
    editor,
    blockId,
  ),
): void {
  if (!expectedSource) throw new Error(`Missing source placement for ${blockId}`);
  const before = editor.readSnapshot();
  const transaction = vi.spyOn(editor, "transaction");
  const result = moveFirstDraftDocumentBlock(editor, expectedSource, position);
  expect(result.ok).toBe(false);
  expect(transaction).not.toHaveBeenCalled();
  expect(editor.readSnapshot()).toEqual(before);
  transaction.mockRestore();
}

function moveCapturedFirstDraftDocumentBlock(
  editor: ReturnType<typeof createEditor>,
  blockId: BlockId,
  position: { readonly parentId: BlockId | null; readonly childIndex: number },
) {
  const sourcePlacement = captureFirstDraftDocumentBlockSourcePlacement(
    editor,
    blockId,
  );
  if (!sourcePlacement) throw new Error(`Missing source placement for ${blockId}`);
  return moveFirstDraftDocumentBlock(editor, sourcePlacement, position);
}

function collectDescendants(
  editor: ReturnType<typeof createEditor>,
  blockId: BlockId,
): readonly BlockId[] {
  const result: BlockId[] = [];
  const visit = (currentId: BlockId): void => {
    result.push(currentId);
    editor.getChildBlockIds(currentId).forEach(visit);
  };
  visit(blockId);
  return result;
}

function focusAndReadSelection(
  editor: ReturnType<typeof createEditor>,
  blockId: BlockId,
) {
  const result = editor.transaction(() => {
    editor.setTransactionSelection({ kind: "text", blockId, offset: 3 });
  });
  expect(result.ok).toBe(true);
  return readCanonicalSelection(editor);
}

function readCanonicalSelection(editor: ReturnType<typeof createEditor>) {
  return editor.selectionController.getCanonicalSnapshot();
}
