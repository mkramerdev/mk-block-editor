import { describe, expect, it } from "vitest";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type {
  BlockType,
  OrderedBlockGraph,
  VersionedBlock,
} from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";
import { asContentVersion } from "../../kernel/versioning/versions.ts";
import { createVersionedBlockRecord } from "../../metadata/block-record.ts";
import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  isRichTextDocument,
} from "../../content/rich-text/rich-inline-content.ts";
import type { RichTextDocumentNodeJson } from "../../content/rich-text/rich-inline-types.ts";
import { applyStructuralTransaction } from "./apply.ts";
import { deleteRange } from "./primitives/delete-range.ts";
import { insertBlocks } from "./primitives/insert-blocks.ts";
import { joinTextBlocks } from "./primitives/join-text-blocks.ts";
import type {
  StructuralEditRange,
  StructuralTransactionContext,
  StructuralTransactionOperation,
} from "./types.ts";
const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  textBlock: {
    kind: "text",
    type: "textBlock",
  },
  alternateTextBlock: {
    kind: "text",
    type: "alternateTextBlock",
  },
  atomicBlock: {
    kind: "atomic",
    type: "atomicBlock",
  },
  wrapperBlock: {
    kind: "wrapper",
    type: "wrapperBlock",
    contentBoundary: false,
    content: { required: ["block"], additional: "block" },
    defaultContent: "textBlock",
  },
  boundary: {
    kind: "wrapper",
    type: "boundary",
    contentBoundary: true,
    content: { required: ["block"], additional: "block" },
  },
  pair: {
    kind: "wrapper",
    type: "pair",
    contentBoundary: false,
    content: { required: ["bucket", "bucket"] },
  },
  bucket: {
    kind: "wrapper",
    type: "bucket",
    contentBoundary: false,
    content: { required: ["block"], additional: "block" },
  },
  primaryWrapper: {
    kind: "wrapper",
    type: "primaryWrapper",
    contentBoundary: false,
    content: { required: ["alternateTextBlock", "bucket"] },
  },
  collection: {
    kind: "wrapper",
    type: "collection",
    contentBoundary: true,
    content: { required: ["collectionGroup"], additional: "collectionGroup" },
  },
  collectionGroup: {
    kind: "wrapper",
    type: "collectionGroup",
    contentBoundary: true,
    content: { required: ["collectionText"], additional: "collectionText" },
  },
  collectionText: {
    kind: "text",
    type: "collectionText",
  },
};

const id = (suffix: number): BlockId =>
  asBlockId(`01890f07-1c00-7000-8000-${String(suffix).padStart(12, "0")}`);

function block(
  suffix: number,
  type: BlockType,
  parentId: BlockId | null = null,
): VersionedBlock {
  return createVersionedBlockRecord({
    id: id(suffix),
    type,
    parentId,
    version: {
      metadataVersion: "1",
      contentVersion:
        definitions[type]?.kind === "text" ? asContentVersion("1") : null,
    },
  });
}

function graph(
  blocks: readonly VersionedBlock[],
): OrderedBlockGraph<VersionedBlock> {
  const childIdsByParentId = {} as Partial<Record<BlockId, BlockId[]>>;
  for (const entry of blocks) {
    if (entry.parentId !== null) {
      (childIdsByParentId[entry.parentId] ??= []).push(entry.id);
    }
  }
  return {
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry])),
    rootBlockIds: blocks
      .filter((entry) => entry.parentId === null)
      .map((entry) => entry.id),
    childIdsByParentId,
  };
}

function text(blockType: BlockType, value: string): RichTextDocumentNodeJson {
  return createBlockRichTextContentFromPlainText(blockType, value);
}

function apply(
  orderedGraph: OrderedBlockGraph<VersionedBlock>,
  values: ReadonlyMap<BlockId, RichTextDocumentNodeJson>,
  operations: readonly StructuralTransactionOperation[],
  validateFinal = true,
) {
  const context: StructuralTransactionContext = {
    graphRevision: 1,
    ...orderedGraph,
    blockDefinitions: definitions,
    readContent: (blockId) => {
      const content = values.get(blockId);
      return content
        ? {
            content,
            plainText: extractPlainTextFromRichTextDocument(content),
            version: "1",
          }
        : null;
    },
    validateContent: (_blockType, content) => isRichTextDocument(content),
    nextContentVersion: "2",
  };
  return applyStructuralTransaction(
    { origin: "range-mutation-test", operations },
    context,
    { validateFinal },
  );
}

function applied(result: ReturnType<typeof apply>) {
  if (!result.ok) throw new Error(result.message);
  return result.transaction;
}

function range(
  blocks: StructuralEditRange["blocks"],
  start: StructuralEditRange["start"],
  end: StructuralEditRange["end"],
): StructuralEditRange {
  return {
    graphRevision: 1,
    selectionRevision: 4,
    blocks,
    start,
    end,
  };
}

describe("ordinary structural range mutations", () => {
  it("deletes a partial rich-text range without replacing its block", () => {
    const textBlock = block(1, "textBlock");
    const result = applied(
      apply(
        graph([textBlock]),
        new Map([[textBlock.id, text("textBlock", "abcdef")]]),
        [
          deleteRange(
            range(
              [
                {
                  kind: "text",
                  blockId: textBlock.id,
                  blockType: textBlock.type,
                  parentId: null,
                  from: 2,
                  to: 4,
                  expectedContentVersion: "1",
                },
              ],
              { kind: "text", blockId: textBlock.id, offset: 2 },
              { kind: "text", blockId: textBlock.id, offset: 4 },
            ),
          ),
        ],
      ),
    );

    expect(result.blocks[textBlock.id]?.id).toBe(textBlock.id);
    expect(result.contentOperations).toHaveLength(1);
    expect(result.stagedContent[textBlock.id]).toMatchObject({
      plainText: "abef",
    });
    expect(result.selection).toEqual({
      kind: "text-offset",
      blockId: textBlock.id,
      offset: 2,
    });
  });

  it("preserves both text boundaries and removes intervening structure", () => {
    const leading = block(1, "textBlock");
    const atom = block(2, "atomicBlock");
    const trailing = block(3, "alternateTextBlock");
    const result = applied(
      apply(
        graph([leading, atom, trailing]),
        new Map([
          [leading.id, text("textBlock", "abcd")],
          [trailing.id, text("alternateTextBlock", "wxyz")],
        ]),
        [
          deleteRange(
            range(
              [
                {
                  kind: "text",
                  blockId: leading.id,
                  blockType: leading.type,
                  parentId: null,
                  from: 2,
                  to: 4,
                  expectedContentVersion: "1",
                },
                {
                  kind: "block",
                  blockId: atom.id,
                  blockType: atom.type,
                  parentId: null,
                },
                {
                  kind: "text",
                  blockId: trailing.id,
                  blockType: trailing.type,
                  parentId: null,
                  from: 0,
                  to: 2,
                  expectedContentVersion: "1",
                },
              ],
              { kind: "text", blockId: leading.id, offset: 2 },
              { kind: "text", blockId: trailing.id, offset: 2 },
            ),
          ),
        ],
      ),
    );

    expect(result.rootBlockIds).toEqual([leading.id, trailing.id]);
    expect(result.stagedContent[leading.id]?.plainText).toBe("ab");
    expect(result.stagedContent[trailing.id]?.plainText).toBe("yz");
    expect(result.selection).toEqual({
      kind: "text-offset",
      blockId: leading.id,
      offset: 2,
    });
  });

  it("uses the nearest surviving start-side text point when the first selected block is removed", () => {
    const removed = block(1, "atomicBlock");
    const trailing = block(2, "alternateTextBlock");
    const result = applied(
      apply(
        graph([removed, trailing]),
        new Map([[trailing.id, text("alternateTextBlock", "wxyz")]]),
        [
          deleteRange(
            range(
              [
                {
                  kind: "block",
                  blockId: removed.id,
                  blockType: removed.type,
                  parentId: null,
                },
                {
                  kind: "text",
                  blockId: trailing.id,
                  blockType: trailing.type,
                  parentId: null,
                  from: 0,
                  to: 2,
                  expectedContentVersion: "1",
                },
              ],
              { kind: "block", blockId: removed.id },
              { kind: "text", blockId: trailing.id, offset: 2 },
            ),
          ),
        ],
      ),
    );

    expect(result.rootBlockIds).toEqual([trailing.id]);
    expect(result.stagedContent[trailing.id]?.plainText).toBe("yz");
    expect(result.selection).toEqual({
      kind: "text-offset",
      blockId: trailing.id,
      offset: 0,
    });
  });

  it("keeps an empty definition-owned text survivor when all roots are removed", () => {
    const textBlock = block(1, "textBlock");
    const result = applied(
      apply(
        graph([textBlock]),
        new Map([[textBlock.id, text("textBlock", "content")]]),
        [
          deleteRange(
            range(
              [
                {
                  kind: "block",
                  blockId: textBlock.id,
                  blockType: textBlock.type,
                  parentId: null,
                },
              ],
              { kind: "block", blockId: textBlock.id },
              { kind: "block", blockId: textBlock.id },
            ),
          ),
        ],
      ),
    );

    expect(result.rootBlockIds).toEqual([textBlock.id]);
    expect(result.stagedContent[textBlock.id]).toMatchObject({
      plainText: "",
    });
  });

  it("does not normalize an unrelated empty primaryWrapper wrapper", () => {
    const primaryWrapper = block(1, "primaryWrapper");
    const primary = block(2, "alternateTextBlock", primaryWrapper.id);
    const bucket = block(3, "bucket", primaryWrapper.id);
    const child = block(4, "textBlock", bucket.id);
    const removed = block(5, "atomicBlock");
    const result = applied(
      apply(
        graph([primaryWrapper, primary, bucket, child, removed]),
        new Map([
          [primary.id, text("alternateTextBlock", "")],
          [child.id, text("textBlock", "")],
        ]),
        [
          deleteRange(
            range(
              [
                {
                  kind: "block",
                  blockId: removed.id,
                  blockType: removed.type,
                  parentId: null,
                },
              ],
              { kind: "block", blockId: removed.id },
              { kind: "block", blockId: removed.id },
            ),
          ),
        ],
      ),
    );

    expect(result.rootBlockIds).toEqual([primaryWrapper.id]);
    expect(result.blocks[primaryWrapper.id]?.type).toBe("primaryWrapper");
  });

  it("removes only selected wrapper children or the complete wrapper", () => {
    const wrapper = block(1, "wrapperBlock");
    const first = block(2, "textBlock", wrapper.id);
    const second = block(3, "atomicBlock", wrapper.id);
    const values = new Map([[first.id, text("textBlock", "one")]]);
    const partial = applied(
      apply(graph([wrapper, first, second]), values, [
        deleteRange(
          range(
            [
              {
                kind: "block",
                blockId: second.id,
                blockType: second.type,
                parentId: wrapper.id,
              },
            ],
            { kind: "block", blockId: second.id },
            { kind: "block", blockId: second.id },
          ),
        ),
      ]),
    );
    expect(partial.childIdsByParentId[wrapper.id]).toEqual([first.id]);

    const complete = applied(
      apply(graph([wrapper, first, second]), values, [
        deleteRange(
          range(
            [
              {
                kind: "block",
                blockId: wrapper.id,
                blockType: wrapper.type,
                parentId: null,
              },
            ],
            { kind: "block", blockId: wrapper.id },
            { kind: "block", blockId: wrapper.id },
          ),
        ),
      ]),
    );
    expect(complete.rootBlockIds).toEqual([]);
    expect(complete.blocks[wrapper.id]).toBeUndefined();
  });

  it("clears nested text as content and removes its wrapper as structure", () => {
    const collection = block(1, "collection");
    const group = block(2, "collectionGroup", collection.id);
    const left = block(3, "collectionText", group.id);
    const right = block(4, "collectionText", group.id);
    const values = new Map([
      [left.id, text("collectionText", "left")],
      [right.id, text("collectionText", "right")],
    ]);
    const cleared = applied(
      apply(graph([collection, group, left, right]), values, [
        deleteRange(
          range(
            [
              {
                kind: "content",
                blockId: left.id,
                blockType: left.type,
                parentId: group.id,
                expectedContentVersion: "1",
              },
              {
                kind: "content",
                blockId: right.id,
                blockType: right.type,
                parentId: group.id,
                expectedContentVersion: "1",
              },
            ],
            { kind: "text", blockId: left.id, offset: 0 },
            { kind: "text", blockId: right.id, offset: 5 },
          ),
        ),
      ]),
    );
    expect(cleared.contentOperations).toHaveLength(2);
    expect(cleared.stagedContent[left.id]?.plainText).toBe("");
    expect(cleared.stagedContent[right.id]?.plainText).toBe("");

    const removed = applied(
      apply(graph([collection, group, left, right]), values, [
        deleteRange(
          range(
            [
              {
                kind: "block",
                blockId: collection.id,
                blockType: collection.type,
                parentId: null,
              },
            ],
            { kind: "block", blockId: collection.id },
            { kind: "block", blockId: collection.id },
          ),
        ),
      ]),
    );
    expect(removed.rootBlockIds).toEqual([]);
  });

  it("allows a later insertion to satisfy a transiently empty wrapper", () => {
    const collection = block(1, "collection");
    const group = block(2, "collectionGroup", collection.id);
    const left = block(3, "collectionText", group.id);
    const right = block(4, "collectionText", group.id);
    const insertedLeftId = id(10);
    const insertedRightId = id(11);
    const result = applied(
      apply(
        graph([collection, group, left, right]),
        new Map([
          [left.id, text("collectionText", "left")],
          [right.id, text("collectionText", "right")],
        ]),
        [
          deleteRange(
            range(
              [
                {
                  kind: "block",
                  blockId: left.id,
                  blockType: left.type,
                  parentId: group.id,
                },
                {
                  kind: "block",
                  blockId: right.id,
                  blockType: right.type,
                  parentId: group.id,
                },
              ],
              { kind: "block", blockId: left.id },
              { kind: "block", blockId: right.id },
            ),
          ),
          insertBlocks({
            placement: { parentId: group.id, childIndex: 0 },
            blocks: [
              {
                id: insertedLeftId,
                type: "collectionText",
                parentId: group.id,
                content: text("collectionText", "new left"),
                plainText: "new left",
              },
              {
                id: insertedRightId,
                type: "collectionText",
                parentId: group.id,
                content: text("collectionText", "new right"),
                plainText: "new right",
              },
            ],
          }),
        ],
      ),
    );

    expect(result.blocks[left.id]).toBeUndefined();
    expect(result.blocks[right.id]).toBeUndefined();
    expect(result.childIdsByParentId[group.id]).toEqual([
      insertedLeftId,
      insertedRightId,
    ]);
  });

  it("inserts an ordered canonical subtree without changing any IDs", () => {
    const existing = block(1, "textBlock");
    const wrapperId = id(10);
    const childId = id(11);
    const atomId = id(12);
    const result = applied(
      apply(
        graph([existing]),
        new Map([[existing.id, text("textBlock", "before")]]),
        [
          insertBlocks({
            placement: { parentId: null, childIndex: 0 },
            blocks: [
              { id: wrapperId, type: "wrapperBlock", parentId: null },
              {
                id: childId,
                type: "textBlock",
                parentId: wrapperId,
                content: text("textBlock", "inside"),
                plainText: "inside",
              },
              { id: atomId, type: "atomicBlock", parentId: null },
            ],
          }),
        ],
      ),
    );

    expect(result.rootBlockIds).toEqual([wrapperId, atomId, existing.id]);
    expect(result.childIdsByParentId[wrapperId]).toEqual([childId]);
    expect(result.blocks[wrapperId]?.id).toBe(wrapperId);
    expect(result.blocks[childId]?.parentId).toBe(wrapperId);
    expect(result.blocks[atomId]?.id).toBe(atomId);
  });

  it("rejects duplicate IDs and placements invalidated by earlier operations", () => {
    const textBlock = block(1, "textBlock");
    const values = new Map([[textBlock.id, text("textBlock", "one")]]);
    const duplicate = apply(graph([textBlock]), values, [
      insertBlocks({
        placement: { parentId: null, childIndex: 1 },
        blocks: [
          {
            id: textBlock.id,
            type: textBlock.type,
            parentId: null,
            content: text("textBlock", "duplicate"),
            plainText: "duplicate",
          },
        ],
      }),
    ]);
    expect(duplicate).toMatchObject({
      ok: false,
      failureKind: "invalid-plan",
    });

    const removedParent = block(2, "wrapperBlock");
    const child = block(3, "textBlock", removedParent.id);
    const invalidPlacement = apply(
      graph([removedParent, child]),
      new Map([[child.id, text("textBlock", "child")]]),
      [
        deleteRange(
          range(
            [
              {
                kind: "block",
                blockId: removedParent.id,
                blockType: removedParent.type,
                parentId: null,
              },
            ],
            { kind: "block", blockId: removedParent.id },
            { kind: "block", blockId: removedParent.id },
          ),
        ),
        insertBlocks({
          placement: { parentId: removedParent.id, childIndex: 0 },
          blocks: [{ id: id(20), type: "atomicBlock", parentId: removedParent.id }],
        }),
      ],
      false,
    );
    expect(invalidPlacement).toMatchObject({
      ok: false,
      operationIndex: 1,
      failureKind: "invalid-boundary",
    });
  });

  it("joins adjacent compatible text while preserving rich inline nodes", () => {
    const left = block(1, "textBlock");
    const right = block(2, "alternateTextBlock");
    const leftContent: RichTextDocumentNodeJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A", marks: [{ type: "strong" }] },
            {
              type: "mention",
              metadata: { id: "1" },
            },
          ],
        },
      ],
    };
    const rightContent: RichTextDocumentNodeJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "B", marks: [{ type: "em" }] }],
        },
      ],
    };
    const result = applied(
      apply(
        graph([left, right]),
        new Map([
          [left.id, leftContent],
          [right.id, rightContent],
        ]),
        [joinTextBlocks(left.id, right.id)],
      ),
    );

    expect(result.rootBlockIds).toEqual([left.id]);
    expect(result.blocks[right.id]).toBeUndefined();
    expect(result.contentOperations).toHaveLength(1);
    expect(result.stagedContent[left.id]).toBeUndefined();
    expect(result.contentOperations[0]?.operations).toMatchObject([
      {
        kind: "insertInlineContent",
        position: { blockId: left.id, offset: 2 },
        content: [{ type: "text", text: "B", marks: [{ type: "em" }] }],
      },
    ]);
  });

  it("rejects non-adjacent, atomic, and content-boundary joins", () => {
    const left = block(1, "textBlock");
    const atom = block(2, "atomicBlock");
    const right = block(3, "textBlock");
    const values = new Map([
      [left.id, text("textBlock", "left")],
      [right.id, text("textBlock", "right")],
    ]);
    expect(
      apply(graph([left, atom, right]), values, [
        joinTextBlocks(left.id, right.id),
      ]),
    ).toMatchObject({ ok: false, failureKind: "invalid-boundary" });
    expect(
      apply(graph([left, atom]), values, [joinTextBlocks(left.id, atom.id)]),
    ).toMatchObject({ ok: false, failureKind: "invalid-content" });

    const boundary = block(10, "boundary");
    const nestedLeft = block(11, "textBlock", boundary.id);
    const nestedRight = block(12, "textBlock", boundary.id);
    expect(
      apply(
        graph([boundary, nestedLeft, nestedRight]),
        new Map([
          [nestedLeft.id, text("textBlock", "left")],
          [nestedRight.id, text("textBlock", "right")],
        ]),
        [joinTextBlocks(nestedLeft.id, nestedRight.id)],
      ),
    ).toMatchObject({ ok: false, failureKind: "invalid-boundary" });
  });

  it("joins an empty right text block without emitting an empty content operation", () => {
    const left = block(20, "textBlock");
    const right = block(21, "textBlock");
    const result = applied(
      apply(
        graph([left, right]),
        new Map([
          [left.id, text("textBlock", "left")],
          [right.id, text("textBlock", "")],
        ]),
        [joinTextBlocks(left.id, right.id)],
      ),
    );

    expect(result.blocks[right.id]).toBeUndefined();
    expect(result.contentOperations).toEqual([]);
    expect(result.selection).toEqual({
      kind: "text-offset",
      blockId: left.id,
      offset: 4,
    });
  });

  it("lets later mutations observe deletion and staged text from earlier ones", () => {
    const left = block(1, "textBlock");
    const removed = block(2, "atomicBlock");
    const right = block(3, "textBlock");
    const result = applied(
      apply(
        graph([left, removed, right]),
        new Map([
          [left.id, text("textBlock", "abc")],
          [right.id, text("textBlock", "xyz")],
        ]),
        [
          deleteRange(
            range(
              [
                {
                  kind: "text",
                  blockId: left.id,
                  blockType: left.type,
                  parentId: null,
                  from: 2,
                  to: 3,
                  expectedContentVersion: "1",
                },
                {
                  kind: "block",
                  blockId: removed.id,
                  blockType: removed.type,
                  parentId: null,
                },
                {
                  kind: "text",
                  blockId: right.id,
                  blockType: right.type,
                  parentId: null,
                  from: 0,
                  to: 1,
                  expectedContentVersion: "1",
                },
              ],
              { kind: "text", blockId: left.id, offset: 2 },
              { kind: "text", blockId: right.id, offset: 1 },
            ),
          ),
          joinTextBlocks(left.id, right.id),
        ],
      ),
    );

    expect(result.rootBlockIds).toEqual([left.id]);
    expect(result.contentOperations).toHaveLength(1);
    expect(result.stagedContent[left.id]).toMatchObject({
      plainText: "ab",
    });
    expect(result.contentOperations[0]?.operations).toMatchObject([
      { kind: "replaceInlineRange" },
      {
        kind: "insertInlineContent",
        position: { blockId: left.id, offset: 2 },
        content: [{ type: "text", text: "yz" }],
      },
    ]);
    expect(result.selection).toEqual({
      kind: "text-offset",
      blockId: left.id,
      offset: 2,
    });
  });

  it("rejects stale graph and content preconditions", () => {
    const textBlock = block(1, "textBlock");
    const stale = range(
      [
        {
          kind: "text",
          blockId: textBlock.id,
          blockType: textBlock.type,
          parentId: null,
          from: 0,
          to: 1,
          expectedContentVersion: "stale",
        },
      ],
      { kind: "text", blockId: textBlock.id, offset: 0 },
      { kind: "text", blockId: textBlock.id, offset: 1 },
    );
    expect(
      apply(
        graph([textBlock]),
        new Map([[textBlock.id, text("textBlock", "value")]]),
        [deleteRange(stale)],
      ),
    ).toMatchObject({ ok: false, failureKind: "stale-precondition" });
    expect(
      apply(
        graph([textBlock]),
        new Map([[textBlock.id, text("textBlock", "value")]]),
        [deleteRange({ ...stale, graphRevision: 2 })],
      ),
    ).toMatchObject({ ok: false, failureKind: "stale-precondition" });
  });
});
