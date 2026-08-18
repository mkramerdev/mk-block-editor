import { describe, expect, it, vi } from "vitest";
import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  type CanonicalBlockFragment,
  type StructuralEditRange,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import type { VersionedBlock } from "@repo/editor-core/document";
import { resolveCanonicalEditComposition } from "./canonical-edit-composition.ts";
import { executeCanonicalBlockFragmentInsertion } from "./canonical-insertion.ts";
import { executeStructuralEditComposition } from "./structural-composition.ts";

const renderer = () => null;
const definitions: Readonly<Record<string, BlockDefinition>> = {
  paragraph: {
    kind: "text",
    type: "paragraph",
    renderer,
    rootLayout: "normal",
  },
  divider: {
    kind: "atomic",
    type: "divider",
    renderer,
    rootLayout: "normal",
  },
  collection: {
    kind: "wrapper",
    type: "collection",
    renderer,
    rootLayout: "full",
    contentBoundary: true,
    content: { required: ["collectionGroup"], additional: "collectionGroup" },
    defaultContent: "collectionGroup",
  },
  collectionGroup: {
    kind: "wrapper",
    type: "collectionGroup",
    renderer,
    rootLayout: "full",
    contentBoundary: true,
    content: { required: ["collectionText"], additional: "collectionText" },
    defaultContent: "collectionText",
  },
  collectionText: {
    kind: "text",
    type: "collectionText",
    renderer,
    rootLayout: "normal",
  },
};

describe("canonical structural edit composition", () => {
  it("turns caret insertion into delete, insert, and one open-boundary join", () => {
    const graph = graphWithText("LR");
    const fragment = textFragment("I", "text");
    const result = resolveCanonicalEditComposition({
      graph,
      target: {
        kind: "caret",
        blockId: graph.block.id,
        offset: 1,
        graphRevision: 7,
        expectedContentVersion: "1",
      },
      fragment,
    });

    expect(result?.deletion?.blocks).toMatchObject([
      { kind: "text", blockId: graph.block.id, from: 1, to: 2 },
    ]);
    expect(result?.insertions?.[0]?.placement).toEqual({
      parentId: null,
      childIndex: 1,
    });
    expect(result?.insertions?.[0]?.fragment.blocks[0]?.plainText).toBe("IR");
    expect(result?.joins).toEqual([
      {
        leftBlockId: graph.block.id,
        rightBlockId: fragment.start.blockId,
      },
    ]);
    expect(result?.finalSelection).toEqual({
      kind: "text",
      blockId: graph.block.id,
      offset: 2,
    });
  });

  it.each([0, 1, 2])(
    "settles an open-text insertion at source offset %i after the inserted content",
    (offset) => {
      const graph = graphWithText("LR");
      const result = resolveCanonicalEditComposition({
        graph,
        target: {
          kind: "caret",
          blockId: graph.block.id,
          offset,
          graphRevision: 7,
          expectedContentVersion: "1",
        },
        fragment: textFragment("I", "text"),
      });

      expect(result?.finalSelection).toEqual({
        kind: "text",
        blockId: graph.block.id,
        offset: offset + 1,
      });
    },
  );

  it("keeps placement, deletion, boundaries, and joins origin-independent across text targets", () => {
    for (const offset of [0, 1, 2]) {
      const graph = graphWithText("LR");
      const fragments = [
        textFragment("I", "text"),
        textFragment("I", "text"),
        textFragment("I", "text"),
        textFragment("I", "text"),
        textFragment("I", "text"),
      ];
      const signatures = fragments.map((fragment) =>
        compositionSignature(
          resolveCanonicalEditComposition({
            graph,
            target: {
              kind: "caret",
              blockId: graph.block.id,
              offset,
              graphRevision: 7,
              expectedContentVersion: "1",
            },
            fragment,
          }),
          graph.block.id,
        ),
      );

      expect(signatures).toEqual(
        Array.from({ length: fragments.length }, () => signatures[0]),
      );
    }
  });

  it("preserves closed block structure and materializes the trailing text as a new root", () => {
    const graph = graphWithText("LR");
    const fragment = atomicFragment();
    const result = resolveCanonicalEditComposition({
      graph,
      target: {
        kind: "caret",
        blockId: graph.block.id,
        offset: 1,
        graphRevision: 7,
        expectedContentVersion: "1",
      },
      fragment,
    });

    expect(result?.joins).toBeUndefined();
    expect(result?.insertions?.[0]?.fragment.rootBlockIds).toHaveLength(2);
    expect(result?.insertions?.[0]?.fragment.blocks.at(-1)).toMatchObject({
      type: "paragraph",
      parentId: null,
      plainText: "R",
    });
    expect(result?.insertions?.[0]?.fragment.end.kind).toBe("text");
  });

  it("replaces an empty caret text block with closed block structure", () => {
    const graph = graphWithText("");
    const fragment = atomicFragment();
    const result = resolveCanonicalEditComposition({
      graph,
      target: {
        kind: "caret",
        blockId: graph.block.id,
        offset: 0,
        graphRevision: 7,
        expectedContentVersion: "1",
      },
      fragment,
    });

    expect(result?.deletion).toEqual({
      graphRevision: 7,
      selectionRevision: 0,
      blocks: [
        {
          kind: "block",
          blockId: graph.block.id,
          blockType: "paragraph",
          parentId: null,
        },
      ],
      start: { kind: "block", blockId: graph.block.id },
      end: { kind: "block", blockId: graph.block.id },
    });
    expect(result?.insertions?.[0]).toEqual({
      placement: { parentId: null, childIndex: 0 },
      fragment,
    });
    expect(result?.joins).toBeUndefined();
  });

  it("replaces an empty collapsed document selection with closed block structure", () => {
    const graph = graphWithText("");
    const fragment = atomicFragment();
    const range: StructuralEditRange = {
      graphRevision: 7,
      selectionRevision: 3,
      blocks: [
        {
          kind: "text",
          blockId: graph.block.id,
          blockType: "paragraph",
          parentId: null,
          from: 0,
          to: 0,
          expectedContentVersion: "1",
        },
      ],
      start: { kind: "text", blockId: graph.block.id, offset: 0 },
      end: { kind: "text", blockId: graph.block.id, offset: 0 },
    };
    const result = resolveCanonicalEditComposition({
      graph,
      target: { kind: "selection", range },
      fragment,
    });

    expect(result?.deletion?.blocks).toEqual([
      {
        kind: "block",
        blockId: graph.block.id,
        blockType: "paragraph",
        parentId: null,
      },
    ]);
    expect(result?.insertions?.[0]).toEqual({
      placement: { parentId: null, childIndex: 0 },
      fragment,
    });
    expect(result?.joins).toBeUndefined();
  });

  it("preserves a wrapper whose open text boundary belongs to a descendant", () => {
    const graph = graphWithText("LR");
    const fragment = wrappedTextFragment("I");
    const result = resolveCanonicalEditComposition({
      graph,
      target: {
        kind: "caret",
        blockId: graph.block.id,
        offset: 1,
        graphRevision: 7,
        expectedContentVersion: "1",
      },
      fragment,
    });

    expect(result?.joins).toBeUndefined();
    expect(result?.insertions?.[0]?.fragment.rootBlockIds).toHaveLength(2);
    expect(result?.insertions?.[0]?.fragment.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "collection" }),
        expect.objectContaining({ type: "collectionText", plainText: "I" }),
        expect.objectContaining({
          type: "paragraph",
          parentId: null,
          plainText: "R",
        }),
      ]),
    );
  });

  it("retains the unselected suffix for same-block replacement", () => {
    const graph = graphWithText("LXR");
    const fragment = textFragment("I", "text");
    const range: StructuralEditRange = {
      graphRevision: 7,
      selectionRevision: 3,
      blocks: [
        {
          kind: "text",
          blockId: graph.block.id,
          blockType: "paragraph",
          parentId: null,
          from: 1,
          to: 2,
          expectedContentVersion: "1",
        },
      ],
      start: { kind: "text", blockId: graph.block.id, offset: 1 },
      end: { kind: "text", blockId: graph.block.id, offset: 2 },
    };
    const result = resolveCanonicalEditComposition({
      graph,
      target: { kind: "selection", range },
      fragment,
    });

    expect(result?.deletion?.blocks[0]).toMatchObject({ from: 1, to: 3 });
    expect(result?.insertions?.[0]?.fragment.blocks[0]?.plainText).toBe("IR");
    expect(result?.joins).toEqual([
      {
        leftBlockId: graph.block.id,
        rightBlockId: fragment.start.blockId,
      },
    ]);
    expect(result?.finalSelection).toEqual({
      kind: "text",
      blockId: graph.block.id,
      offset: 2,
    });
  });

  it("settles a two-block paste before the original caret suffix", () => {
    const graph = graphWithText("leftright");
    const fragment = twoTextBlockFragment("one", "two");
    const trailingId = fragment.end.blockId;
    const result = resolveCanonicalEditComposition({
      graph,
      target: {
        kind: "caret",
        blockId: graph.block.id,
        offset: 4,
        graphRevision: 7,
        expectedContentVersion: "1",
      },
      fragment,
    });

    expect(
      result?.insertions?.[0]?.fragment.blocks.find(
        (block) => block.id === trailingId,
      )?.plainText,
    ).toBe("tworight");
    expect(result?.finalSelection).toEqual({
      kind: "text",
      blockId: trailingId,
      offset: 3,
    });
  });

  it("settles a multi-block replacement at the trailing inserted join survivor", () => {
    const graph = graphWithTexts(["leftX", "Yright"]);
    const [first, last] = graph.blocks;
    if (!first || !last) throw new Error("Expected two graph blocks");
    const fragment = twoTextBlockFragment("one", "two");
    const trailingId = fragment.end.blockId;
    const range: StructuralEditRange = {
      graphRevision: 7,
      selectionRevision: 3,
      blocks: [
        {
          kind: "text",
          blockId: first.id,
          blockType: first.type,
          parentId: null,
          from: 4,
          to: 5,
          expectedContentVersion: "1",
        },
        {
          kind: "text",
          blockId: last.id,
          blockType: last.type,
          parentId: null,
          from: 0,
          to: 1,
          expectedContentVersion: "1",
        },
      ],
      start: { kind: "text", blockId: first.id, offset: 4 },
      end: { kind: "text", blockId: last.id, offset: 1 },
    };
    const result = resolveCanonicalEditComposition({
      graph,
      target: { kind: "selection", range },
      fragment,
    });

    expect(result?.deletion?.blocks).toMatchObject([
      { blockId: first.id, from: 4, to: 5 },
      { blockId: last.id, from: 0, to: 1 },
    ]);
    expect(result?.joins).toEqual([
      { leftBlockId: first.id, rightBlockId: fragment.start.blockId },
      { leftBlockId: trailingId, rightBlockId: last.id },
    ]);
    expect(result?.finalSelection).toEqual({
      kind: "text",
      blockId: trailingId,
      offset: 3,
    });
  });

  it("uses rich-text content size for a pasted endpoint containing an inline atom", () => {
    const graph = graphWithText("LR");
    const richContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A" },
            { type: "mention", metadata: { id: "u1" } },
            { type: "text", text: "Z" },
          ],
        },
      ],
    } satisfies RichTextDocumentNodeJson;
    const fragment = twoTextBlockFragment("one", richContent);
    const trailingId = fragment.end.blockId;
    const trailing = fragment.blocks.find((block) => block.id === trailingId);
    expect(trailing?.plainText).toBe("AZ");
    const result = resolveCanonicalEditComposition({
      graph,
      target: {
        kind: "caret",
        blockId: graph.block.id,
        offset: 1,
        graphRevision: 7,
        expectedContentVersion: "1",
      },
      fragment,
    });

    expect(result?.finalSelection).toEqual({
      kind: "text",
      blockId: trailingId,
      offset: 3,
    });
  });

  it("keeps a wrapper-transparent endpoint on its nested text descendant", () => {
    const graph = graphWithText("LR");
    const fragment = wrappedTextFragment("inside");
    const endpointId = fragment.end.blockId;
    const wrapperId = fragment.rootBlockIds[0];
    const result = resolveCanonicalEditComposition({
      graph,
      target: {
        kind: "caret",
        blockId: graph.block.id,
        offset: 1,
        graphRevision: 7,
        expectedContentVersion: "1",
      },
      fragment,
    });

    expect(result?.finalSelection).toEqual({
      kind: "text",
      blockId: endpointId,
      offset: 6,
    });
    expect(result?.finalSelection?.blockId).not.toBe(wrapperId);
    expect(
      result?.insertions?.[0]?.fragment.blocks.some(
        (block) => block.id === endpointId && block.type === "collectionText",
      ),
    ).toBe(true);
  });

  it("retargets open imported text to the caret text definition", () => {
    const graph = graphWithCollectionText("LR");
    const fragment = textFragment("I", "text");
    const result = resolveCanonicalEditComposition({
      graph,
      target: {
        kind: "caret",
        blockId: graph.block.id,
        offset: 1,
        graphRevision: 7,
        expectedContentVersion: "1",
      },
      fragment,
    });

    expect(result?.insertions?.[0]?.placement).toEqual({
      parentId: graph.group.id,
      childIndex: 1,
    });
    expect(result?.insertions?.[0]?.fragment.blocks[0]?.type).toBe(
      "collectionText",
    );
  });

  it("places closed block structure outside incompatible wrapper ancestors", () => {
    const graph = graphWithCollectionText("LR");
    const result = resolveCanonicalEditComposition({
      graph,
      target: {
        kind: "caret",
        blockId: graph.block.id,
        offset: 1,
        graphRevision: 7,
        expectedContentVersion: "1",
      },
      fragment: atomicFragment(),
    });

    expect(result?.insertions?.[0]?.placement).toEqual({
      parentId: null,
      childIndex: 1,
    });
  });

  it("executes one transaction and settles selection after ordinary mutations", () => {
    const order: string[] = [];
    const editor = {
      transaction: vi.fn((callback: () => unknown) => {
        order.push("transaction");
        callback();
        return { ok: true as const, changed: true as const } as never;
      }),
      deleteRange: vi.fn(() => order.push("deleteRange")),
      insertBlocks: vi.fn(() => order.push("insertBlocks")),
      joinTextBlocks: vi.fn(() => order.push("joinTextBlocks")),
      setTransactionSelection: vi.fn(() =>
        order.push("setTransactionSelection"),
      ),
    };
    const graph = graphWithText("LR");
    const fragment = textFragment("I", "text");
    executeStructuralEditComposition(editor, {
      deletion: {
        graphRevision: 7,
        selectionRevision: 1,
        blocks: [],
        start: { kind: "block", blockId: graph.block.id },
        end: { kind: "block", blockId: graph.block.id },
      },
      insertions: [
        {
          placement: { parentId: null, childIndex: 1 },
          fragment,
        },
      ],
      joins: [
        {
          leftBlockId: graph.block.id,
          rightBlockId: fragment.start.blockId,
        },
      ],
      finalSelection: {
        kind: "text",
        blockId: graph.block.id,
        offset: 1,
      },
    }, { provenance: null });
    expect(order).toEqual([
      "transaction",
      "deleteRange",
      "insertBlocks",
      "joinTextBlocks",
      "setTransactionSelection",
    ]);
    expect(editor.transaction).toHaveBeenCalledOnce();
  });

  it("exposes application insertion as one transaction accepting only a canonical fragment", () => {
    const fragment = textFragment("application", "block");
    const insertBlocks = vi.fn();
    const transaction = vi.fn((callback: () => unknown) => {
      callback();
      return { ok: true as const, changed: true as const } as never;
    });
    const result = executeCanonicalBlockFragmentInsertion(
      { transaction, insertBlocks },
      { parentId: null, childIndex: 0 },
      fragment,
    );

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(transaction).toHaveBeenCalledOnce();
    expect(insertBlocks).toHaveBeenCalledWith(
      { parentId: null, childIndex: 0 },
      fragment,
    );
  });
});

function graphWithText(text: string) {
  const content = createBlockRichTextContentFromPlainText("paragraph", text);
  const record = createCanonicalBlockRecord({
    type: "paragraph",
    parentId: null,
    content,
    plainText: text,
  });
  const block: VersionedBlock = {
    ...record,
    metadataVersion: "1",
    contentVersion: "1",
    tombstone: false,
  };
  const graph = {
    blockDefinitions: definitions,
    block,
    getBlock: (blockId: BlockId) => (blockId === block.id ? block : null),
    getRootBlockIds: () => [block.id],
    getChildBlockIds: () => [],
    readBlockContent: (blockId: BlockId) =>
      blockId === block.id ? content : null,
  };
  return graph;
}

function graphWithCollectionText(text: string) {
  const content = createBlockRichTextContentFromPlainText(
    "collectionText",
    text,
  );
  const collectionRecord = createCanonicalBlockRecord({
    type: "collection",
    parentId: null,
  });
  const groupRecord = createCanonicalBlockRecord({
    type: "collectionGroup",
    parentId: collectionRecord.id,
  });
  const textRecord = createCanonicalBlockRecord({
    type: "collectionText",
    parentId: groupRecord.id,
    content,
    plainText: text,
  });
  const collection: VersionedBlock = {
    ...collectionRecord,
    metadataVersion: "1",
    contentVersion: null,
    tombstone: false,
  };
  const group: VersionedBlock = {
    ...groupRecord,
    metadataVersion: "1",
    contentVersion: null,
    tombstone: false,
  };
  const block: VersionedBlock = {
    ...textRecord,
    metadataVersion: "1",
    contentVersion: "1",
    tombstone: false,
  };
  const blocks = new Map([
    [collection.id, collection],
    [group.id, group],
    [block.id, block],
  ]);
  return {
    blockDefinitions: definitions,
    collection,
    group,
    block,
    getBlock: (blockId: BlockId) => blocks.get(blockId) ?? null,
    getRootBlockIds: () => [collection.id],
    getChildBlockIds: (parentId: BlockId) =>
      parentId === collection.id
        ? [group.id]
        : parentId === group.id
          ? [block.id]
          : [],
    readBlockContent: (blockId: BlockId) =>
      blockId === block.id ? content : null,
  };
}

function graphWithTexts(texts: readonly string[]) {
  const contents = texts.map((text) =>
    createBlockRichTextContentFromPlainText("paragraph", text),
  );
  const blocks: VersionedBlock[] = texts.map((text, index) => ({
    ...createCanonicalBlockRecord({
      type: "paragraph",
      parentId: null,
      content: contents[index],
      plainText: text,
    }),
    metadataVersion: "1",
    contentVersion: "1",
    tombstone: false,
  }));
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const contentById = new Map(
    blocks.map((block, index) => [block.id, contents[index]!]),
  );
  return {
    blockDefinitions: definitions,
    blocks,
    getBlock: (blockId: BlockId) => blockById.get(blockId) ?? null,
    getRootBlockIds: () => blocks.map((block) => block.id),
    getChildBlockIds: () => [],
    readBlockContent: (blockId: BlockId) => contentById.get(blockId) ?? null,
  };
}

function textFragment(
  text: string,
  boundary: "text" | "block",
): CanonicalBlockFragment {
  const content = createBlockRichTextContentFromPlainText("paragraph", text);
  const record = createCanonicalBlockRecord({
    type: "paragraph",
    parentId: null,
    content,
    plainText: extractPlainTextFromRichTextDocument(content),
  });
  return createCanonicalBlockFragment({
    blocks: [record],
    rootBlockIds: [record.id],
    start: { kind: boundary, blockId: record.id },
    end: { kind: boundary, blockId: record.id },
    blockDefinitions: definitions,
  });
}

function twoTextBlockFragment(
  firstText: string,
  secondValue: string | RichTextDocumentNodeJson,
): CanonicalBlockFragment {
  const firstContent = createBlockRichTextContentFromPlainText(
    "paragraph",
    firstText,
  );
  const secondContent =
    typeof secondValue === "string"
      ? createBlockRichTextContentFromPlainText("paragraph", secondValue)
      : secondValue;
  const first = createCanonicalBlockRecord({
    type: "paragraph",
    parentId: null,
    content: firstContent,
    plainText: extractPlainTextFromRichTextDocument(firstContent),
  });
  const second = createCanonicalBlockRecord({
    type: "paragraph",
    parentId: null,
    content: secondContent,
    plainText: extractPlainTextFromRichTextDocument(secondContent),
  });
  return createCanonicalBlockFragment({
    blocks: [first, second],
    rootBlockIds: [first.id, second.id],
    start: { kind: "text", blockId: first.id },
    end: { kind: "text", blockId: second.id },
    blockDefinitions: definitions,
  });
}

function atomicFragment(): CanonicalBlockFragment {
  const record = createCanonicalBlockRecord({
    type: "divider",
    parentId: null,
  });
  return createCanonicalBlockFragment({
    blocks: [record],
    rootBlockIds: [record.id],
    start: { kind: "block", blockId: record.id },
    end: { kind: "block", blockId: record.id },
    blockDefinitions: definitions,
  });
}

function wrappedTextFragment(text: string): CanonicalBlockFragment {
  const content = createBlockRichTextContentFromPlainText(
    "collectionText",
    text,
  );
  const collection = createCanonicalBlockRecord({
    type: "collection",
    parentId: null,
  });
  const group = createCanonicalBlockRecord({
    type: "collectionGroup",
    parentId: collection.id,
  });
  const child = createCanonicalBlockRecord({
    type: "collectionText",
    parentId: group.id,
    content,
    plainText: text,
  });
  return createCanonicalBlockFragment({
    blocks: [collection, group, child],
    rootBlockIds: [collection.id],
    start: { kind: "text", blockId: child.id },
    end: { kind: "text", blockId: child.id },
    blockDefinitions: definitions,
  });
}

function compositionSignature(
  composition: ReturnType<typeof resolveCanonicalEditComposition>,
  liveBlockId: BlockId,
): unknown {
  const insertion = composition?.insertions?.[0];
  if (!composition || !insertion) return composition;
  const fragment = insertion.fragment;
  const positionById = new Map(
    fragment.blocks.map((block, index) => [block.id, index]),
  );
  const blockReference = (blockId: BlockId): string =>
    blockId === liveBlockId
      ? "live"
      : `inserted:${positionById.get(blockId) ?? -1}`;
  return {
    deletion: composition.deletion
      ? {
          start: composition.deletion.start.kind,
          end: composition.deletion.end.kind,
          blocks: composition.deletion.blocks.map((block) => ({
            kind: block.kind,
            block: blockReference(block.blockId),
            ...("from" in block ? { from: block.from, to: block.to } : {}),
          })),
        }
      : null,
    placement: insertion.placement,
    fragment: {
      blocks: fragment.blocks.map((block) => ({
        type: block.type,
        parent:
          block.parentId === null
            ? null
            : (positionById.get(block.parentId) ?? -1),
        plainText: block.plainText,
        content: block.content,
      })),
      roots: fragment.rootBlockIds.map(
        (blockId) => positionById.get(blockId) ?? -1,
      ),
      start: {
        kind: fragment.start.kind,
        block: positionById.get(fragment.start.blockId) ?? -1,
      },
      end: {
        kind: fragment.end.kind,
        block: positionById.get(fragment.end.blockId) ?? -1,
      },
    },
    joins:
      composition.joins?.map((join) => ({
        left: blockReference(join.leftBlockId),
        right: blockReference(join.rightBlockId),
      })) ?? [],
  };
}
