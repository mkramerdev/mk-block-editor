import { describe, expect, it } from "vitest";
import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  isRichTextDocument,
} from "../../content/rich-text/rich-inline-content.ts";
import { applyLogicalContentOperationToRichTextDocument } from "../../content/rich-text/content-operations.ts";
import type { RichTextDocumentNodeJson } from "../../content/rich-text/rich-inline-types.ts";
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
import { applyStructuralTransaction } from "../transactions/apply.ts";
import type {
  StructuralEditRange,
  StructuralTransactionContext,
} from "../transactions/types.ts";
import { planStructuralRangeDeletion } from "./plan-range-deletion.ts";

const textDefinition = (type: BlockType): BlockDefinition => ({
  kind: "text",
  type,
  rootLayout: "normal",
});
const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  paragraph: { ...textDefinition("paragraph"), split: { item: "item" } },
  heading: textDefinition("heading"),
  callout: {
    kind: "wrapper",
    type: "callout",
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["block"], additional: "block" },
    rangeDeletion: { kind: "unwrap-boundary-contents" },
  },
  quote: {
    kind: "wrapper",
    type: "quote",
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["paragraph"] },
    rangeDeletion: { kind: "unwrap-boundary-contents" },
  },
  code: {
    kind: "wrapper",
    type: "code",
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["paragraph"] },
    rangeDeletion: { kind: "unwrap-boundary-contents" },
  },
  columns: {
    kind: "wrapper",
    type: "columns",
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["column", "column"], additional: "column" },
    underflow: { kind: "promote-single-child-contents" },
    rangeDeletion: { kind: "unwrap-boundary-child" },
  },
  column: {
    kind: "wrapper",
    type: "column",
    rootLayout: "normal",
    contentBoundary: true,
    content: { required: ["block"], additional: "block" },
  },
  tabs: {
    kind: "wrapper",
    type: "tabs",
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["pane"], additional: "pane" },
    rangeDeletion: { kind: "unwrap-visible-boundary-child" },
  },
  pane: {
    kind: "wrapper",
    type: "pane",
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["block"], additional: "block" },
  },
  compound: {
    kind: "wrapper",
    type: "compound",
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["heading", "body"] },
    compound: {
      kind: "primary-text-with-promoted-content",
      primaryTextChildType: "heading",
      contentWrapperChildType: "body",
      emptyPrimary: "remove-wrapper",
    },
  },
  body: {
    kind: "wrapper",
    type: "body",
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["block"], additional: "block" },
  },
  list: {
    kind: "wrapper",
    type: "list",
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["item"], additional: "item" },
    list: { kind: "container", itemType: "item" },
  },
  item: {
    kind: "wrapper",
    type: "item",
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["paragraph"], additional: "block" },
    parents: { allowed: ["list"] },
    list: {
      kind: "item",
      containerType: "list",
      primaryTextChildType: "paragraph",
      emptyEnter: "lift-primary-out-of-container",
    },
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

function content(type: BlockType, value: string): RichTextDocumentNodeJson {
  return createBlockRichTextContentFromPlainText(type, value);
}

function execute(input: {
  readonly graph: OrderedBlockGraph<VersionedBlock>;
  readonly values: ReadonlyMap<BlockId, RichTextDocumentNodeJson>;
  readonly range: StructuralEditRange;
  readonly visible?: (input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly childBlockIds: readonly BlockId[];
  }) => readonly BlockId[];
}) {
  const context: StructuralTransactionContext = {
    ...input.graph,
    graphRevision: 1,
    blockDefinitions: definitions,
    readContent: (blockId) => {
      const value = input.values.get(blockId);
      return value
        ? {
            content: value,
            plainText: extractPlainTextFromRichTextDocument(value),
            version: asContentVersion("1"),
          }
        : null;
    },
    validateContent: (_type, value) => isRichTextDocument(value),
    nextContentVersion: asContentVersion("2"),
  };
  const planned = planStructuralRangeDeletion({
    intent: "cut",
    range: input.range,
    ...context,
    graphRevision: context.graphRevision ?? 1,
    ...(input.visible ? { resolveVisibleChildBlockIds: input.visible } : {}),
  });
  if (!planned.ok) throw new Error(planned.message);
  const result = applyStructuralTransaction(planned.plan, context);
  if (!result.ok) throw new Error(result.message);
  return result.transaction;
}

function openRange(
  start: VersionedBlock,
  end: VersionedBlock,
  middle: readonly VersionedBlock[] = [],
): StructuralEditRange {
  return {
    graphRevision: 1,
    selectionRevision: 2,
    blocks: [
      {
        kind: "text",
        blockId: start.id,
        blockType: start.type,
        parentId: start.parentId,
        from: 3,
        to: 6,
        expectedContentVersion: "1",
      },
      ...middle.map((entry) => ({
        kind: "block" as const,
        blockId: entry.id,
        blockType: entry.type,
        parentId: entry.parentId,
      })),
      {
        kind: "text",
        blockId: end.id,
        blockType: end.type,
        parentId: end.parentId,
        from: 0,
        to: 3,
        expectedContentVersion: "1",
      },
    ],
    start: { kind: "text", blockId: start.id, offset: 3 },
    end: { kind: "text", blockId: end.id, offset: 3 },
  };
}

function plainText(
  transaction: ReturnType<typeof execute>,
  blockId: BlockId,
  base: RichTextDocumentNodeJson,
): string {
  const content = transaction.contentOperations
    .filter((batch) => batch.blockId === blockId)
    .flatMap((batch) => batch.operations)
    .reduce((current, operation) => {
      const next = applyLogicalContentOperationToRichTextDocument(
        transaction.blocks[blockId]!.type,
        current,
        operation,
        {
          blockDefinitions: definitions,
          inlineMarks: [],
          validatedCanonicalBase: true,
        },
      );
      if (!next) throw new Error("content operation failed");
      return next;
    }, base);
  return extractPlainTextFromRichTextDocument(content);
}

describe("planStructuralRangeDeletion", () => {
  it("joins open boundaries into the normalized start block without changing its type", () => {
    const start = block(1, "heading");
    const middle = block(2, "paragraph");
    const end = block(3, "paragraph");
    const transaction = execute({
      graph: graph([start, middle, end]),
      values: new Map([
        [start.id, content("heading", "abcDEF")],
        [middle.id, content("paragraph", "middle")],
        [end.id, content("paragraph", "GHIjkl")],
      ]),
      range: openRange(start, end, [middle]),
    });

    expect(transaction.rootBlockIds).toEqual([start.id]);
    expect(transaction.blocks[start.id]).toMatchObject({
      id: start.id,
      type: "heading",
    });
    expect(plainText(transaction, start.id, content("heading", "abcDEF"))).toBe(
      "abcjkl",
    );
    expect(transaction.selection).toEqual({
      kind: "text-offset",
      blockId: start.id,
      offset: 3,
    });
  });

  it("preserves donor marks and inline atoms under the start block type", () => {
    const start = {
      ...block(1, "heading"),
      metadata: { level: 2 },
    } satisfies VersionedBlock;
    const end = block(2, "paragraph");
    const donor: RichTextDocumentNodeJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "GHI" },
            { type: "text", text: "j", marks: [{ type: "strong" }] },
            { type: "mention", metadata: { id: "ada" } },
            {
              type: "text",
              text: "kl",
              marks: [{ type: "link", attrs: { href: "/docs" } }],
            },
          ],
        },
      ],
    };
    const transaction = execute({
      graph: graph([start, end]),
      values: new Map([
        [start.id, content("heading", "abcDEF")],
        [end.id, donor],
      ]),
      range: openRange(start, end),
    });
    const replacement = transaction.contentOperations
      .flatMap((batch) => batch.operations)
      .find(
        (operation) =>
          operation.blockId === start.id &&
          operation.kind === "replaceInlineRange",
      );

    expect(transaction.blocks[start.id]).toMatchObject({
      id: start.id,
      type: "heading",
      metadata: { level: 2 },
    });
    expect(replacement).toMatchObject({
      content: [
        { type: "text", text: "j", marks: [{ type: "strong" }] },
        { type: "mention", metadata: { id: "ada" } },
        {
          type: "text",
          text: "kl",
          marks: [{ type: "link", attrs: { href: "/docs" } }],
        },
      ],
    });
  });

  it("promotes surviving callout children in order and removes the wrapper", () => {
    const start = block(1, "paragraph");
    const wrapper = block(2, "callout");
    const end = block(3, "paragraph", wrapper.id);
    const after = block(4, "heading", wrapper.id);
    const transaction = execute({
      graph: graph([start, wrapper, end, after]),
      values: new Map([
        [start.id, content("paragraph", "abcDEF")],
        [end.id, content("paragraph", "GHIjkl")],
        [after.id, content("heading", "after")],
      ]),
      range: openRange(start, end),
    });

    expect(transaction.rootBlockIds).toEqual([start.id, after.id]);
    expect(transaction.blocks[wrapper.id]).toBeUndefined();
    expect(transaction.blocks[end.id]).toBeUndefined();
    expect(transaction.blocks[after.id]?.parentId).toBeNull();
    expect(
      plainText(transaction, start.id, content("paragraph", "abcDEF")),
    ).toBe("abcjkl");
  });

  it.each(["quote", "code"] as const)(
    "uses the shared unwrap policy for a %s boundary",
    (wrapperType) => {
      const start = block(1, "paragraph");
      const wrapper = block(2, wrapperType);
      const end = block(3, "paragraph", wrapper.id);
      const transaction = execute({
        graph: graph([start, wrapper, end]),
        values: new Map([
          [start.id, content("paragraph", "abcDEF")],
          [end.id, content("paragraph", "GHIjkl")],
        ]),
        range: openRange(start, end),
      });

      expect(transaction.rootBlockIds).toEqual([start.id]);
      expect(transaction.blocks[wrapper.id]).toBeUndefined();
      expect(transaction.blocks[end.id]).toBeUndefined();
      expect(
        plainText(transaction, start.id, content("paragraph", "abcDEF")),
      ).toBe("abcjkl");
    },
  );

  it("applies compound primary cleanup and promotes its body contents", () => {
    const start = block(1, "paragraph");
    const wrapper = block(2, "compound");
    const end = block(3, "heading", wrapper.id);
    const body = block(4, "body", wrapper.id);
    const bodyText = block(5, "paragraph", body.id);
    const transaction = execute({
      graph: graph([start, wrapper, end, body, bodyText]),
      values: new Map([
        [start.id, content("paragraph", "abcDEF")],
        [end.id, content("heading", "GHIjkl")],
        [bodyText.id, content("paragraph", "body")],
      ]),
      range: openRange(start, end),
    });

    expect(transaction.rootBlockIds).toEqual([start.id, bodyText.id]);
    expect(transaction.blocks[wrapper.id]).toBeUndefined();
    expect(transaction.blocks[body.id]).toBeUndefined();
    expect(transaction.blocks[bodyText.id]?.parentId).toBeNull();
  });

  it("unwraps one boundary column while retaining two valid lanes", () => {
    const start = block(1, "paragraph");
    const columns = block(2, "columns");
    const lane1 = block(3, "column", columns.id);
    const end = block(4, "paragraph", lane1.id);
    const survivor = block(5, "heading", lane1.id);
    const lane2 = block(6, "column", columns.id);
    const lane2Text = block(7, "paragraph", lane2.id);
    const lane3 = block(8, "column", columns.id);
    const lane3Text = block(9, "paragraph", lane3.id);
    const transaction = execute({
      graph: graph([
        start,
        columns,
        lane1,
        end,
        survivor,
        lane2,
        lane2Text,
        lane3,
        lane3Text,
      ]),
      values: new Map([
        [start.id, content("paragraph", "abcDEF")],
        [end.id, content("paragraph", "GHIjkl")],
        [survivor.id, content("heading", "survivor")],
        [lane2Text.id, content("paragraph", "two")],
        [lane3Text.id, content("paragraph", "three")],
      ]),
      range: openRange(start, end),
    });

    expect(transaction.rootBlockIds).toEqual([
      start.id,
      survivor.id,
      columns.id,
    ]);
    expect(transaction.childIdsByParentId[columns.id]).toEqual([
      lane2.id,
      lane3.id,
    ]);
    expect(transaction.blocks[lane1.id]).toBeUndefined();
    expect(transaction.blocks[survivor.id]?.parentId).toBeNull();
  });

  it("applies column underflow and preserves the remaining lane contents", () => {
    const start = block(1, "paragraph");
    const columns = block(2, "columns");
    const lane1 = block(3, "column", columns.id);
    const end = block(4, "paragraph", lane1.id);
    const lane1After = block(5, "heading", lane1.id);
    const lane2 = block(6, "column", columns.id);
    const lane2Text = block(7, "paragraph", lane2.id);
    const transaction = execute({
      graph: graph([start, columns, lane1, end, lane1After, lane2, lane2Text]),
      values: new Map([
        [start.id, content("paragraph", "abcDEF")],
        [end.id, content("paragraph", "GHIjkl")],
        [lane1After.id, content("heading", "one")],
        [lane2Text.id, content("paragraph", "two")],
      ]),
      range: openRange(start, end),
    });

    expect(transaction.rootBlockIds).toEqual([
      start.id,
      lane1After.id,
      lane2Text.id,
    ]);
    expect(transaction.blocks[columns.id]).toBeUndefined();
    expect(transaction.blocks[lane1.id]).toBeUndefined();
    expect(transaction.blocks[lane2.id]).toBeUndefined();
  });

  it("promotes only the visible tab pane and removes every inactive pane", () => {
    const start = block(1, "paragraph");
    const tabs = block(2, "tabs");
    const hiddenPane = block(3, "pane", tabs.id);
    const hidden = block(4, "paragraph", hiddenPane.id);
    const activePane = block(5, "pane", tabs.id);
    const end = block(6, "paragraph", activePane.id);
    const survivor = block(7, "heading", activePane.id);
    const transaction = execute({
      graph: graph([
        start,
        tabs,
        hiddenPane,
        hidden,
        activePane,
        end,
        survivor,
      ]),
      values: new Map([
        [start.id, content("paragraph", "abcDEF")],
        [hidden.id, content("paragraph", "hidden")],
        [end.id, content("paragraph", "GHIjkl")],
        [survivor.id, content("heading", "visible")],
      ]),
      range: openRange(start, end),
      visible: ({ blockId, childBlockIds }) =>
        blockId === tabs.id ? [activePane.id] : childBlockIds,
    });

    expect(transaction.rootBlockIds).toEqual([start.id, survivor.id]);
    expect(transaction.blocks[tabs.id]).toBeUndefined();
    expect(transaction.blocks[hidden.id]).toBeUndefined();
    expect(transaction.blocks[activePane.id]).toBeUndefined();
  });

  it("consumes a list item, keeps unaffected items, and adopts nested descendants", () => {
    const start = block(1, "heading");
    const list = block(2, "list");
    const item1 = block(3, "item", list.id);
    const end = block(4, "paragraph", item1.id);
    const nested = block(5, "callout", item1.id);
    const nestedText = block(6, "paragraph", nested.id);
    const item2 = block(7, "item", list.id);
    const item2Text = block(8, "paragraph", item2.id);
    const item3 = block(9, "item", list.id);
    const item3Text = block(10, "paragraph", item3.id);
    const transaction = execute({
      graph: graph([
        start,
        list,
        item1,
        end,
        nested,
        nestedText,
        item2,
        item2Text,
        item3,
        item3Text,
      ]),
      values: new Map([
        [start.id, content("heading", "abcDEF")],
        [end.id, content("paragraph", "GHIjkl")],
        [nestedText.id, content("paragraph", "nested")],
        [item2Text.id, content("paragraph", "two")],
        [item3Text.id, content("paragraph", "three")],
      ]),
      range: openRange(start, end),
    });

    expect(plainText(transaction, start.id, content("heading", "abcDEF"))).toBe(
      "abcjkl",
    );
    expect(transaction.blocks[item1.id]).toBeUndefined();
    expect(transaction.childIdsByParentId[list.id]).toEqual([
      item2.id,
      item3.id,
    ]);
    expect(transaction.childIdsByParentId[item2.id]).toEqual([
      item2Text.id,
      nested.id,
    ]);
    expect(transaction.blocks[nested.id]?.parentId).toBe(item2.id);
  });
});
