import { describe, expect, it } from "vitest";
import {
  createBlockRichTextContentFromPlainText,
  isRichTextDocument,
} from "../../content/rich-text/rich-inline-content.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type {
  BlockType,
  OrderedBlockGraph,
  VersionedBlock,
} from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";
import { asContentVersion } from "../../kernel/versioning/versions.ts";
import { applyStructuralTransaction } from "../transactions/apply.ts";
import type { TransactionReadableContent } from "../transactions/types.ts";
import { planGenericEnter, planTextSplitAtPlacement } from "./plan-enter.ts";

const renderer = () => null;
const blockDefinitions: Readonly<Record<BlockType, BlockDefinition>> = {
  textLeaf: {
    kind: "text",
    rootLayout: "normal",
    type: "textLeaf",
    renderer,
    split: {
      default: "textLeaf",
      itemShell: "itemShell",
      compoundItem: "compoundItem",
      listItem: "listItem",
    },
  },
  otherText: {
    kind: "text",
    rootLayout: "normal",
    type: "otherText",
    renderer,
    split: { default: "textLeaf" },
  },
  atomLeaf: {
    kind: "atomic",
    rootLayout: "normal",
    type: "atomLeaf",
    renderer,
    replaceWith: "textLeaf",
  },
  oneShell: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "oneShell",
    renderer,
    content: { required: ["textLeaf"] },
    contentBoundary: false,
  },
  itemShell: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "itemShell",
    renderer,
    content: { required: ["textLeaf"] },
    contentBoundary: false,
  },
  flowShell: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "flowShell",
    renderer,
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "textLeaf",
  },
  bodyShell: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "bodyShell",
    renderer,
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "atomLeaf",
  },
  compoundItem: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "compoundItem",
    renderer,
    content: { required: ["textLeaf", "bodyShell"] },
    contentBoundary: false,
  },
  boundaryFlow: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "boundaryFlow",
    renderer,
    content: { required: ["block"], additional: "block" },
    contentBoundary: true,
    defaultContent: "textLeaf",
  },
  constrainedFlow: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "constrainedFlow",
    renderer,
    content: { required: ["otherText"], additional: "otherText" },
    contentBoundary: true,
    defaultContent: "otherText",
  },
  parallelShell: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "parallelShell",
    renderer,
    content: {
      required: ["parallelPane", "parallelPane"],
      additional: "parallelPane",
    },
    contentBoundary: false,
  },
  parallelPane: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "parallelPane",
    renderer,
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "atomLeaf",
  },
  listContainer: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "listContainer",
    renderer,
    content: { required: ["listItem"], additional: "listItem" },
    contentBoundary: false,
    defaultContent: "listItem",
    list: { kind: "container", itemType: "listItem" },
  },
  listItem: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "listItem",
    renderer,
    content: { required: ["textLeaf"], additional: "block" },
    contentBoundary: false,
    parents: { allowed: ["listContainer"] },
    list: {
      kind: "item",
      containerType: "listContainer",
      primaryTextChildType: "textLeaf",
      emptyEnter: "lift-primary-out-of-container",
    },
  },
};

describe("generic Enter planning", () => {
  it.each([
    [0, "", "abcd"],
    [2, "ab", "cd"],
    [4, "abcd", ""],
  ])("uses one split path at offset %i", (offset, left, right) => {
    const source = block(1, "textLeaf", "a0", null, "7");
    const result = run([source], source, "abcd", { from: offset, to: offset });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(types(result.transaction)).toStrictEqual(["textLeaf", "textLeaf"]);
    expect(replacedText(result.transaction.stagedContent)).toStrictEqual(
      offset === 4 ? [right] : [left, right],
    );
    expect(result.transaction.selection).toMatchObject({
      kind: "text-offset",
      offset: 0,
    });
  });

  it("deletes a same-block range and splits it atomically", () => {
    const source = block(1, "textLeaf", "a0", null, "3");
    const result = run([source], source, "abcdef", { from: 2, to: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(replacedText(result.transaction.stagedContent)).toStrictEqual([
      "ab",
      "ef",
    ]);
  });

  it("exits an exact-one wrapper and applies an override only after crossing its boundary", () => {
    const item = block(1, "itemShell", "a0");
    const source = block(2, "textLeaf", "a1", item.id, "2");
    const result = run([item, source], source, "xy", { from: 1, to: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(types(result.transaction)).toStrictEqual([
      "itemShell",
      "textLeaf",
      "itemShell",
      "textLeaf",
    ]);
    const roots = liveChildren(result.transaction, null);
    expect(roots.map((value) => value.type)).toStrictEqual([
      "itemShell",
      "itemShell",
    ]);
  });

  it("replaces an empty exact-one following wrapper with the default text block", () => {
    const item = block(1, "itemShell", "a0");
    const source = block(2, "textLeaf", "a1", item.id, "2");
    const result = run([item, source], source, "", { from: 0, to: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(types(result.transaction)).toStrictEqual(["textLeaf"]);
    expect(result.transaction.blocks[item.id]?.tombstone).not.toBeNull();
    expect(result.transaction.blocks[source.id]?.tombstone).not.toBeNull();
    expect(result.transaction.selection).toMatchObject({
      kind: "text-offset",
      offset: 0,
    });
  });

  it("keeps an empty exact-one wrapper without a following-wrapper override", () => {
    const shell = block(1, "oneShell", "a0");
    const source = block(2, "textLeaf", "a1", shell.id, "2");
    const result = run([shell, source], source, "", { from: 0, to: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(types(result.transaction)).toStrictEqual([
      "oneShell",
      "textLeaf",
      "textLeaf",
    ]);
    expect(result.transaction.blocks[shell.id]?.tombstone).toBeNull();
    expect(result.transaction.blocks[source.id]?.tombstone).toBeNull();
  });

  it("enters the canonical fixed-structure body and replaces its sole default atom", () => {
    const shell = block(1, "compoundItem", "a0");
    const source = block(2, "textLeaf", "a1", shell.id, "5");
    const body = block(3, "bodyShell", "a2", shell.id);
    const atom = block(4, "atomLeaf", "a3", body.id);
    const result = run([shell, source, body, atom], source, "xy", {
      from: 2,
      to: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      liveChildren(result.transaction, body.id).map((b) => b.type),
    ).toStrictEqual(["textLeaf"]);
    expect(result.transaction.blocks[atom.id]?.tombstone).not.toBeNull();
  });

  it("places a mid-content split in the canonical following body", () => {
    const shell = block(1, "compoundItem", "a0");
    const source = block(2, "textLeaf", "a1", shell.id, "5");
    const body = block(3, "bodyShell", "a2", shell.id);
    const atom = block(4, "atomLeaf", "a3", body.id);
    const result = run([shell, source, body, atom], source, "xy", {
      from: 1,
      to: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roots = liveChildren(result.transaction, null);
    expect(roots.map((value) => value.type)).toStrictEqual(["compoundItem"]);
    expect(
      liveChildren(result.transaction, body.id).map((value) => value.type),
    ).toStrictEqual(["textLeaf"]);
    expect(result.transaction.blocks[atom.id]?.tombstone).not.toBeNull();
  });

  it("explicitly splits a compound primary into a complete adjacent sibling", () => {
    const shell = block(1, "compoundItem", "a0");
    const source = block(2, "textLeaf", "a1", shell.id, "5");
    const body = block(3, "bodyShell", "a2", shell.id);
    const retained = block(4, "otherText", "a3", body.id, "1");
    let nextId = 100;
    const planned = planTextSplitAtPlacement({
      selectionBlockId: source.id,
      selection: { from: 1, to: 1 },
      content: {
        content: createBlockRichTextContentFromPlainText(source.type, "xy"),
        plainText: "xy",
        version: source.contentVersion,
      },
      ...records([shell, source, body, retained]),
      blockDefinitions,
      resultType: "compoundItem",
      placement: { parentId: null, childIndex: 1 },
      createBlockId: () => id(nextId++),
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const result = applyStructuralTransaction(
      planned.plan,
      contextFor([shell, source, body, retained], source, "xy"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.transaction.rootBlockIds).toEqual([
      shell.id,
      planned.insertedRootBlockId,
    ]);
    expect(result.transaction.childIdsByParentId[shell.id]).toEqual([
      source.id,
      body.id,
    ]);
    expect(result.transaction.childIdsByParentId[body.id]).toEqual([
      retained.id,
    ]);
    expect(types(result.transaction)).toEqual([
      "compoundItem",
      "textLeaf",
      "bodyShell",
      "otherText",
      "compoundItem",
      "textLeaf",
      "bodyShell",
      "atomLeaf",
    ]);
    expect(replacedText(result.transaction.stagedContent)).toEqual(["x", "y"]);
    expect(result.transaction.selection).toEqual({
      kind: "text-offset",
      blockId: planned.selectionBlockId,
      offset: 0,
    });
  });

  it("implements the three repeated-wrapper empty positions", () => {
    const onlyShell = block(1, "flowShell", "a0");
    const only = block(2, "textLeaf", "a1", onlyShell.id, "1");
    const onlyResult = run([onlyShell, only], only, "", { from: 0, to: 0 });
    expect(onlyResult.ok).toBe(true);
    if (onlyResult.ok) {
      expect(liveChildren(onlyResult.transaction, onlyShell.id)).toHaveLength(
        2,
      );
    }

    const flow = block(3, "flowShell", "a0");
    const first = block(4, "textLeaf", "a1", flow.id, "1");
    const last = block(5, "textLeaf", "a2", flow.id, "1");
    const nonLast = run([flow, first, last], first, "", { from: 0, to: 0 });
    expect(nonLast.ok).toBe(true);
    if (nonLast.ok) {
      const children = liveChildren(nonLast.transaction, flow.id);
      expect(children[1]?.id).toBe(first.id);
      expect(nonLast.transaction.selection).toMatchObject({
        blockId: first.id,
      });
    }

    const outside = block(6, "textLeaf", "a3", null, "1");
    const lastResult = run([flow, first, last, outside], last, "", {
      from: 0,
      to: 0,
    });
    expect(lastResult.ok).toBe(true);
    if (lastResult.ok) {
      expect(lastResult.transaction.blocks[last.id]?.tombstone).not.toBeNull();
      expect(
        liveChildren(lastResult.transaction, null).map((b) => b.type),
      ).toStrictEqual(["flowShell", "textLeaf", "textLeaf"]);
    }
  });

  it("retains a last empty child and inserts its definition-owned result inside a boundary", () => {
    const boundary = block(1, "boundaryFlow", "a0");
    const first = block(2, "textLeaf", "a1", boundary.id, "1");
    const focused = block(3, "otherText", "a2", boundary.id, "1");
    const result = run([boundary, first, focused], focused, "", {
      from: 0,
      to: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const children = liveChildren(result.transaction, boundary.id);
    expect(children.map(({ type }) => type)).toStrictEqual([
      "textLeaf",
      "otherText",
      "textLeaf",
    ]);
    expect(children[1]?.id).toBe(focused.id);
    expect(result.transaction.blocks[focused.id]?.tombstone).toBeNull();
    expect(result.transaction.selection).toMatchObject({
      kind: "text-offset",
      blockId: children[2]?.id,
      offset: 0,
    });
  });

  it("traverses nested wrappers up to a boundary and exits only inside it", () => {
    const boundary = block(1, "boundaryFlow", "a0");
    const compound = block(2, "compoundItem", "a1", boundary.id);
    const title = block(3, "textLeaf", "a2", compound.id, "1");
    const body = block(4, "bodyShell", "a3", compound.id);
    const retained = block(5, "textLeaf", "a4", body.id, "1");
    const focused = block(6, "textLeaf", "a5", body.id, "1");
    const result = run(
      [boundary, compound, title, body, retained, focused],
      focused,
      "",
      { from: 0, to: 0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.blocks[focused.id]?.tombstone).not.toBeNull();
    expect(
      liveChildren(result.transaction, boundary.id).map(({ type }) => type),
    ).toStrictEqual(["compoundItem", "textLeaf"]);
    expect(
      liveChildren(result.transaction, body.id).map(({ type }) => type),
    ).toStrictEqual(["textLeaf"]);
  });

  it("exits repeatable peer containers without descending into the next peer", () => {
    const shell = block(1, "parallelShell", "a0");
    const firstPane = block(2, "parallelPane", "a1", shell.id);
    const retained = block(3, "textLeaf", "a2", firstPane.id, "1");
    const focused = block(4, "textLeaf", "a3", firstPane.id, "1");
    const secondPane = block(5, "parallelPane", "a4", shell.id);
    const secondDefault = block(6, "atomLeaf", "a5", secondPane.id);
    const result = run(
      [shell, firstPane, retained, focused, secondPane, secondDefault],
      focused,
      "",
      { from: 0, to: 0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.blocks[focused.id]?.tombstone).not.toBeNull();
    expect(
      liveChildren(result.transaction, secondPane.id).map(({ type }) => type),
    ).toStrictEqual(["atomLeaf"]);
    expect(
      liveChildren(result.transaction, null).map(({ type }) => type),
    ).toStrictEqual(["parallelShell", "textLeaf"]);
  });

  it("fails atomically when the local boundary rejects the split result", () => {
    const boundary = block(1, "constrainedFlow", "a0");
    const first = block(2, "otherText", "a1", boundary.id, "1");
    const focused = block(3, "otherText", "a2", boundary.id, "1");
    const result = plan([boundary, first, focused], focused, "", {
      from: 0,
      to: 0,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid-local-boundary",
    });
  });

  it("does not use containment fallback for an ordinary navigation failure", () => {
    const missingParentId = id(99);
    const flow = block(1, "flowShell", "a0", missingParentId);
    const first = block(2, "textLeaf", "a1", flow.id, "1");
    const focused = block(3, "textLeaf", "a2", flow.id, "1");
    const blocks = [flow, first, focused];
    const result = plan(blocks, focused, "", { from: 0, to: 0 });
    expect(result).toMatchObject({ ok: false, reason: "no-destination" });
  });

  it("rejects stale canonical text before mutation", () => {
    const source = block(1, "textLeaf", "a0", null, "2");
    const planned = plan([source], source, "x", { from: 1, to: 1 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const changedSource = {
      ...source,
      contentVersion: asContentVersion("3"),
    };
    const context = contextFor([changedSource], changedSource, "x");
    expect(applyStructuralTransaction(planned.plan, context).ok).toBe(false);
  });

  it.each([
    ["only", ["textLeaf"], []],
    ["first", ["textLeaf", "listContainer"], [id(4)]],
    ["last", ["listContainer", "textLeaf"], [id(2)]],
  ] as const)(
    "lifts the existing primary paragraph for the %s empty list position",
    (position, rootTypes, remainingItemIds) => {
      const list = block(1, "listContainer", "a0");
      const firstItem = block(2, "listItem", "a1", list.id);
      const firstText = block(3, "textLeaf", "a2", firstItem.id, "1");
      const lastItem = block(4, "listItem", "a3", list.id);
      const lastText = block(5, "textLeaf", "a4", lastItem.id, "1");
      const blocks =
        position === "only"
          ? [list, firstItem, firstText]
          : [list, firstItem, firstText, lastItem, lastText];
      const focused = position === "last" ? lastText : firstText;
      const result = run(blocks, focused, "", { from: 0, to: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        liveChildren(result.transaction, null).map((b) => b.type),
      ).toStrictEqual(rootTypes);
      expect(result.transaction.blocks[focused.id]?.parentId).toBeNull();
      expect(result.transaction.selection).toEqual({
        kind: "text-offset",
        blockId: focused.id,
        offset: 0,
      });
      if (remainingItemIds.length > 0) {
        expect(
          liveChildren(result.transaction, list.id).map((b) => b.id),
        ).toStrictEqual(remainingItemIds);
      }
    },
  );

  it("splits a list around the existing middle empty paragraph", () => {
    const list = block(1, "listContainer", "a0");
    const firstItem = block(2, "listItem", "a1", list.id);
    const firstText = block(3, "textLeaf", "a2", firstItem.id, "1");
    const emptyItem = block(4, "listItem", "a3", list.id);
    const emptyText = block(5, "textLeaf", "a4", emptyItem.id, "1");
    const lastItem = block(6, "listItem", "a5", list.id);
    const lastText = block(7, "textLeaf", "a6", lastItem.id, "1");
    const result = run(
      [list, firstItem, firstText, emptyItem, emptyText, lastItem, lastText],
      emptyText,
      "",
      { from: 0, to: 0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roots = liveChildren(result.transaction, null);
    expect(roots.map((b) => b.type)).toStrictEqual([
      "listContainer",
      "textLeaf",
      "listContainer",
    ]);
    expect(roots[0]?.id).toBe(list.id);
    expect(roots[1]?.id).toBe(emptyText.id);
    expect(
      liveChildren(result.transaction, roots[2]!.id).map((b) => b.id),
    ).toStrictEqual([lastItem.id]);
    expect(result.transaction.blocks[emptyItem.id]).toBeUndefined();
    expect(result.transaction.selection).toEqual({
      kind: "text-offset",
      blockId: emptyText.id,
      offset: 0,
    });
  });

  it("does not flatten or split an empty list item with additional content", () => {
    const list = block(1, "listContainer", "a0");
    const item = block(2, "listItem", "a1", list.id);
    const text = block(3, "textLeaf", "a2", item.id, "1");
    const nestedList = block(4, "listContainer", "a3", item.id);
    const nestedItem = block(5, "listItem", "a4", nestedList.id);
    const nestedText = block(6, "textLeaf", "a5", nestedItem.id, "1");

    expect(
      plan([list, item, text, nestedList, nestedItem, nestedText], text, "", {
        from: 0,
        to: 0,
      }),
    ).toMatchObject({
      ok: false,
      handled: true,
      reason: "invalid-local-boundary",
    });
  });

  it.each([
    [0, [id(100), id(2)]],
    [1, [id(2), id(100)]],
    [2, [id(2), id(100)]],
  ] as const)(
    "splits a non-empty list item in the same container at offset %i",
    (offset, expectedItems) => {
      const list = block(1, "listContainer", "a0");
      const item = block(2, "listItem", "a1", list.id);
      const text = block(3, "textLeaf", "a2", item.id, "1");
      const result = run([list, item, text], text, "ab", {
        from: offset,
        to: offset,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        liveChildren(result.transaction, list.id).map((b) => b.id),
      ).toStrictEqual(expectedItems);
      expect(liveChildren(result.transaction, null).map((b) => b.id)).toEqual([
        list.id,
      ]);
      expect(result.transaction.selection).toMatchObject({
        kind: "text-offset",
        blockId: id(101),
        offset: 0,
      });
    },
  );
});

function run(
  blocks: readonly VersionedBlock[],
  focused: VersionedBlock,
  text: string,
  selection: { readonly from: number; readonly to: number },
) {
  const planned = plan(blocks, focused, text, selection);
  if (!planned.ok) throw new Error(planned.message);
  return applyStructuralTransaction(
    planned.plan,
    contextFor(blocks, focused, text),
  );
}

function plan(
  blocks: readonly VersionedBlock[],
  focused: VersionedBlock,
  text: string,
  selection: { readonly from: number; readonly to: number },
) {
  let nextId = 100;
  return planGenericEnter({
    selectionBlockId: focused.id,
    selection,
    content: {
      content: createBlockRichTextContentFromPlainText(focused.type, text),
      plainText: text,
      version: focused.contentVersion,
    },
    ...records(blocks),
    blockDefinitions: blockDefinitions,
    createBlockId: () => id(nextId++),
  });
}

function contextFor(
  blocks: readonly VersionedBlock[],
  focused: VersionedBlock,
  text: string,
) {
  const content = new Map<BlockId, TransactionReadableContent>();
  for (const block of blocks) {
    const definition = blockDefinitions[block.type];
    if (definition && definition.kind === "text") {
      const value = block.id === focused.id ? text : "existing";
      content.set(block.id, {
        content: createBlockRichTextContentFromPlainText(block.type, value),
        plainText: value,
        version: block.contentVersion,
      });
    }
  }
  return {
    ...records(blocks),
    blockDefinitions: blockDefinitions,
    readContent: (blockId: BlockId) => content.get(blockId) ?? null,
    validateContent: (type: BlockType, value: unknown) =>
      blockDefinitions[type] !== undefined &&
      blockDefinitions[type]!.kind === "text"
        ? isRichTextDocument(value)
        : value !== undefined,
  };
}

function replacedText(
  content: Readonly<Record<string, { readonly plainText: string } | undefined>>,
) {
  return Object.values(content).flatMap((value) =>
    value ? [value.plainText] : [],
  );
}

function types(graph: OrderedBlockGraph<VersionedBlock>) {
  return [
    ...graph.rootBlockIds.flatMap((blockId) => subtree(graph, blockId)),
  ].map((block) => block.type);
}

function liveChildren(
  graph: OrderedBlockGraph<VersionedBlock>,
  parentId: BlockId | null,
) {
  const ids =
    parentId === null
      ? graph.rootBlockIds
      : (graph.childIdsByParentId[parentId] ?? []);
  return ids.map((blockId) => graph.blocks[blockId]!);
}

function records(blocks: readonly VersionedBlock[]) {
  const byId = Object.fromEntries(
    blocks.map((value) => [value.id, value]),
  ) as Record<BlockId, VersionedBlock>;
  const rootBlockIds = blocks
    .filter((value) => value.parentId === null)
    .map((value) => value.id);
  const childIdsByParentId = {} as Partial<Record<BlockId, BlockId[]>>;
  for (const value of blocks) {
    if (value.parentId !== null) {
      (childIdsByParentId[value.parentId] ??= []).push(value.id);
    }
  }
  return { blocks: byId, rootBlockIds, childIdsByParentId };
}

function subtree(
  graph: OrderedBlockGraph<VersionedBlock>,
  blockId: BlockId,
): VersionedBlock[] {
  return [
    graph.blocks[blockId]!,
    ...(graph.childIdsByParentId[blockId] ?? []).flatMap((childId) =>
      subtree(graph, childId),
    ),
  ];
}

function block(
  number: number,
  type: BlockType,
  sequenceLabel: string,
  parentId: BlockId | null = null,
  contentVersion: string | null = null,
): VersionedBlock {
  void sequenceLabel;
  return {
    id: id(number),
    type,
    parentId,
    tombstone: null,
    metadataVersion: "1",
    contentVersion: contentVersion as VersionedBlock["contentVersion"],
  };
}

function id(number: number): BlockId {
  return asBlockId(
    `01890f07-1c00-7000-8000-${number.toString().padStart(12, "0")}`,
  );
}
