import { describe, expect, it } from "vitest";
import type { BlockDefinition } from "../definitions/block-definition.ts";
import { asBlockId } from "../kernel/identity/uuid.ts";
import { createBlockRichTextContentFromPlainText } from "../content/rich-text/rich-inline-content.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import { wholeSelection } from "../selection/block-selection.ts";
import {
  createCanonicalBlockFragment,
  duplicateCanonicalBlockSubtrees,
  materializeCanonicalBlockCreation,
  reidentifyCanonicalBlockFragment,
  validateCanonicalBlockFragment,
  type CanonicalBlockFragment,
  type CanonicalBlockRecord,
} from "./canonical-fragment.ts";
import { createCollisionSafeBlockIdAllocator } from "./block-editing/block-id-allocator.ts";
const definitions: Readonly<Record<string, BlockDefinition>> = {
  textBlock: {
    kind: "text",
    type: "textBlock",
  },
  atomicBlock: {
    kind: "atomic",
    type: "atomicBlock",
  },
  wrapperBlock: {
    kind: "wrapper",
    type: "wrapperBlock",
    contentBoundary: false,
    content: { required: ["textBlock"], additional: "textBlock" },
  },
  selectableWrapper: {
    kind: "wrapper",
    type: "selectableWrapper",
    selection: wholeSelection(),
    contentBoundary: false,
    content: { required: [] },
  },
};

const id = (suffix: number): BlockId =>
  asBlockId(`01890f07-1c00-7000-8000-${suffix.toString().padStart(12, "0")}`);

function textRecord(
  blockId: BlockId,
  plainText = "hello",
  parentId: BlockId | null = null,
): CanonicalBlockRecord {
  return {
    id: blockId,
    type: "textBlock",
    parentId,
    content: createBlockRichTextContentFromPlainText("textBlock", plainText),
    plainText,
  };
}

function fragment(
  blocks: readonly CanonicalBlockRecord[],
  roots: readonly BlockId[],
  start = roots[0]!,
  end = roots[roots.length - 1]!,
): CanonicalBlockFragment {
  return {
    blocks,
    rootBlockIds: roots,
    start: { kind: "block", blockId: start },
    end: { kind: "block", blockId: end },
  };
}

describe("canonical block fragments", () => {
  it("constructs an ordered detached graph with explicit text boundaries", () => {
    const root = id(1);
    const child = id(2);
    const result = createCanonicalBlockFragment({
      blocks: [
        { id: root, type: "wrapperBlock", parentId: null },
        textRecord(child, "hello", root),
      ],
      rootBlockIds: [root],
      start: { kind: "text", blockId: child },
      end: { kind: "text", blockId: child },
      blockDefinitions: definitions,
    });
    expect(result.blocks.map((block) => block.id)).toEqual([root, child]);
    expect(result.start).toEqual({ kind: "text", blockId: child });
  });

  it("rejects a constrained child used as a fragment root", () => {
    const constrainedDefinitions: Readonly<Record<string, BlockDefinition>> = {
      ...definitions,
      wrapperBlock: {
        ...definitions.wrapperBlock!,
        parents: { allowed: ["containerWrapper"] },
      },
      containerWrapper: {
        kind: "wrapper",
        type: "containerWrapper",
        contentBoundary: false,
        content: { required: ["wrapperBlock"], additional: "wrapperBlock" },
      },
    };
    const root = id(10);
    const text = id(11);
    expect(
      validateCanonicalBlockFragment(
        fragment(
          [
            { id: root, type: "wrapperBlock", parentId: null },
            textRecord(text, "task", root),
          ],
          [root],
        ),
        { blockDefinitions: constrainedDefinitions },
      ),
    ).toContain(
      `fragment block ${root} has invalid direct parent for type wrapperBlock`,
    );
  });

  it.each([
    {
      name: "duplicate ids",
      value: fragment([textRecord(id(1)), textRecord(id(1))], [id(1)]),
      error: "duplicate block id",
    },
    {
      name: "missing parents",
      value: fragment([textRecord(id(1), "a", id(9))], [id(1)]),
      error: "missing parent",
    },
    {
      name: "cycles",
      value: fragment(
        [
          { id: id(1), type: "wrapperBlock", parentId: id(2) },
          { id: id(2), type: "wrapperBlock", parentId: id(1) },
        ],
        [id(1)],
      ),
      error: "parent cycle",
    },
    {
      name: "invalid roots",
      value: fragment([textRecord(id(1), "a", id(2))], [id(1)]),
      error: "parentId null",
    },
    {
      name: "invalid boundaries",
      value: {
        ...fragment([textRecord(id(1))], [id(1)]),
        start: { kind: "block", blockId: id(9) } as const,
      },
      error: "boundary refers to missing block",
    },
    {
      name: "content on non-text blocks",
      value: fragment(
        [
          {
            id: id(1),
            type: "atomicBlock",
            parentId: null,
            content: createBlockRichTextContentFromPlainText("atomicBlock", "x"),
            plainText: "x",
          },
        ],
        [id(1)],
      ),
      error: "must not carry text content",
    },
    {
      name: "missing content on text blocks",
      value: fragment(
        [{ id: id(1), type: "textBlock", parentId: null, plainText: "x" }],
        [id(1)],
      ),
      error: "missing rich-text content",
    },
  ])("rejects $name", ({ value, error }) => {
    expect(
      validateCanonicalBlockFragment(value, {
        blockDefinitions: definitions,
      }).join("; "),
    ).toContain(error);
  });

  it("duplicates content and structure with entirely new identities", () => {
    const root = id(20);
    const child = id(21);
    const source = {
      [root]: {
        id: root,
        type: "wrapperBlock",
        parentId: null,
        tombstone: null,
        metadataVersion: "1",
        contentVersion: null,
      },
      [child]: {
        id: child,
        type: "textBlock",
        parentId: root,
        tombstone: null,
        metadataVersion: "1",
        contentVersion: "1",
      },
    };
    const duplicated = duplicateCanonicalBlockSubtrees({
      blocks: source,
      childIdsByParentId: { [root]: [child] },
      rootBlockIds: [root],
      blockDefinitions: definitions,
      readContent: (blockId) =>
        blockId === child
          ? createBlockRichTextContentFromPlainText("textBlock", "same")
          : null,
    });
    expect(duplicated.blocks.map((block) => block.type)).toEqual([
      "wrapperBlock",
      "textBlock",
    ]);
    expect(duplicated.blocks[1]).toMatchObject({ plainText: "same" });
    expect(new Set(duplicated.blocks.map((block) => block.id)).has(root)).toBe(
      false,
    );
    expect(new Set(duplicated.blocks.map((block) => block.id)).has(child)).toBe(
      false,
    );
    expect(duplicated.blocks[1]?.parentId).toBe(duplicated.blocks[0]?.id);
  });

  it("materializes application-created wrapper trees as detached canonical content", () => {
    const created = materializeCanonicalBlockCreation({
      type: "wrapperBlock",
      blockDefinitions: definitions,
      initialText: "inside",
    });

    expect(created.fragment.blocks.map((block) => block.type)).toEqual([
      "wrapperBlock",
      "textBlock",
    ]);
    expect(created.fragment.rootBlockIds).toEqual([created.rootBlockId]);
    expect(created.fragment.blocks[0]?.parentId).toBeNull();
    expect(created.fragment.blocks[1]).toMatchObject({
      parentId: created.rootBlockId,
      plainText: "inside",
    });
    expect(created.selectionBlockId).toBe(created.fragment.blocks[1]?.id);
    expect(created.fragment.start).toEqual({
      kind: "block",
      blockId: created.rootBlockId,
    });
    expect(created.fragment.end).toEqual({
      kind: "block",
      blockId: created.rootBlockId,
    });
  });

  it("materializes an explicitly selectable empty wrapper with root selection intent", () => {
    const created = materializeCanonicalBlockCreation({
      type: "selectableWrapper",
      blockDefinitions: definitions,
    });

    expect(created.fragment.blocks).toHaveLength(1);
    expect(created.selectionBlockId).toBe(created.rootBlockId);
  });

  it("forwards current-document collision checks to canonical allocation", () => {
    const collision = id(90);
    const candidates = [collision, id(91), id(92)];
    const created = materializeCanonicalBlockCreation({
      type: "wrapperBlock",
      blockDefinitions: definitions,
      createBlockId: () => candidates.shift() ?? id(93),
      isBlockIdReserved: (blockId) => blockId === collision,
    });

    expect(created.fragment.blocks.map((block) => block.id)).toEqual([
      id(91),
      id(92),
    ]);
  });

  it("reidentifies detached structure with one collision-safe reservation set", () => {
    const root = id(40);
    const child = id(41);
    const metadata = { tone: "note" } as const;
    const content = createBlockRichTextContentFromPlainText(
      "textBlock",
      "same content",
    );
    const source = createCanonicalBlockFragment({
      blocks: [
        { id: root, type: "wrapperBlock", parentId: null, metadata },
        {
          id: child,
          type: "textBlock",
          parentId: root,
          content,
          plainText: "same content",
        },
      ],
      rootBlockIds: [root],
      start: { kind: "block", blockId: root },
      end: { kind: "text", blockId: child },
      blockDefinitions: definitions,
    });
    const before = structuredClone(source);
    const live = id(42);
    const tombstoned = id(43);
    const first = id(44);
    const second = id(45);
    const candidates = [
      "" as BlockId,
      root,
      live,
      tombstoned,
      first,
      first,
      second,
    ];
    const allocator = createCollisionSafeBlockIdAllocator({
      createBlockId: () => candidates.shift() ?? id(46),
      reservedBlockIds: new Set(source.blocks.map((block) => block.id)),
      isBlockIdReserved: (blockId) =>
        blockId === live || blockId === tombstoned,
      purpose: "fragment test",
    });

    const result = reidentifyCanonicalBlockFragment({
      fragment: source,
      blockDefinitions: definitions,
      allocateBlockId: allocator.allocateBlockId,
    });

    expect(result.blocks.map((block) => block.id)).toEqual([first, second]);
    expect(result.blocks[1]?.parentId).toBe(first);
    expect(result.rootBlockIds).toEqual([first]);
    expect(result.start).toEqual({ kind: "block", blockId: first });
    expect(result.end).toEqual({ kind: "text", blockId: second });
    expect(result.blocks.map((block) => block.type)).toEqual([
      "wrapperBlock",
      "textBlock",
    ]);
    expect(result.blocks[0]?.metadata).toBe(metadata);
    expect(result.blocks[1]?.content).toBe(content);
    expect(result.blocks[1]?.plainText).toBe("same content");
    expect(source).toEqual(before);
    expect(source.blocks[0]?.id).toBe(root);
    expect(source.blocks[1]?.id).toBe(child);
  });

  it("fails clearly when destination-owned allocation is exhausted", () => {
    const sourceId = id(50);
    const source = createCanonicalBlockFragment({
      blocks: [textRecord(sourceId)],
      rootBlockIds: [sourceId],
      start: { kind: "text", blockId: sourceId },
      end: { kind: "text", blockId: sourceId },
      blockDefinitions: definitions,
    });
    const collision = id(51);
    const allocator = createCollisionSafeBlockIdAllocator({
      createBlockId: () => collision,
      reservedBlockIds: new Set([sourceId]),
      isBlockIdReserved: (blockId) => blockId === collision,
      purpose: "fragment test",
    });

    expect(() =>
      reidentifyCanonicalBlockFragment({
        fragment: source,
        blockDefinitions: definitions,
        allocateBlockId: allocator.allocateBlockId,
      }),
    ).toThrow("unable to allocate a unique block id for fragment test");
  });
});
