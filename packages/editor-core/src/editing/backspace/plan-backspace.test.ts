import { describe, expect, it } from "vitest";
import {
  createBlockRichTextContentFromPlainText,
  isRichTextDocument,
  type RichTextDocumentNodeJson,
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
import { planBlockBoundaryBackspace } from "./plan-backspace.ts";

const renderer = () => null;
const blockDefinitions: Readonly<Record<BlockType, BlockDefinition>> = {
  textLeaf: { kind: "text", rootLayout: "normal", type: "textLeaf", renderer },
  otherText: {
    kind: "text",
    rootLayout: "normal",
    type: "otherText",
    renderer,
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
  compoundShell: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "compoundShell",
    renderer,
    content: { required: ["textLeaf", "bodyShell"] },
    contentBoundary: false,
    compound: {
      kind: "primary-text-with-promoted-content",
      primaryTextChildType: "textLeaf",
      contentWrapperChildType: "bodyShell",
      emptyPrimary: "remove-wrapper",
    },
  },
  lane: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "lane",
    renderer,
    content: { required: ["block"], additional: "block" },
    contentBoundary: true,
    defaultContent: "textLeaf",
  },
  laneGroup: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "laneGroup",
    renderer,
    content: { required: ["lane", "lane"], additional: "lane" },
    contentBoundary: false,
    defaultContent: "lane",
    underflow: { kind: "promote-single-child-contents" },
  },
  ordinaryLaneGroup: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "ordinaryLaneGroup",
    renderer,
    content: { required: ["lane", "lane"], additional: "lane" },
    contentBoundary: false,
    defaultContent: "lane",
  },
  laneGroupHost: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "laneGroupHost",
    renderer,
    content: { required: ["laneGroup"] },
    contentBoundary: false,
  },
};

describe("block-boundary Backspace planning", () => {
  it("rejects same-block deletion before structural planning", () => {
    const source = block(1, "textLeaf", "a0", null, "1");
    const result = plan([source], source, rich("textLeaf", "abc"), {
      from: 2,
      to: 2,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "local-content-route-required",
    });
  });

  it("removes empty root text and focuses the following text start", () => {
    const source = block(1, "textLeaf", "a0", null, "1");
    const next = block(2, "otherText", "a1", null, "1");
    const result = run(
      [source, next],
      source,
      rich("textLeaf", ""),
      { from: 0, to: 0 },
      { [next.id]: rich("otherText", "next") },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.blocks[source.id]?.tombstone).not.toBeNull();
    expect(result.transaction.selection).toStrictEqual({
      kind: "block-start",
      blockId: next.id,
    });
  });

  it("keeps an intervening atomic block as the previous selection target", () => {
    const previousText = block(1, "textLeaf", "a0", null, "1");
    const atomic = block(2, "atomLeaf", "a1");
    const source = block(3, "textLeaf", "a2", null, "1");
    const result = run(
      [previousText, atomic, source],
      source,
      rich("textLeaf", ""),
      { from: 0, to: 0 },
      { [previousText.id]: rich("textLeaf", "previous") },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.blocks[source.id]?.tombstone).not.toBeNull();
    expect(result.transaction.selection).toStrictEqual({
      kind: "atomic",
      blockId: atomic.id,
    });
  });

  it("removes an ordinary exact wrapper when its sole text is empty", () => {
    const previous = block(1, "textLeaf", "a0", null, "1");
    const wrapper = block(2, "oneShell", "a1");
    const source = block(3, "textLeaf", "a2", wrapper.id, "1");
    const result = run(
      [previous, wrapper, source],
      source,
      rich("textLeaf", ""),
      { from: 0, to: 0 },
      { [previous.id]: rich("textLeaf", "previous") },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.blocks[wrapper.id]?.tombstone).not.toBeNull();
    expect(result.transaction.selection).toStrictEqual({
      kind: "block-end",
      blockId: previous.id,
    });
  });

  it("keeps an ordinary repeated wrapper with siblings but removes it when empty", () => {
    const wrapper = block(1, "flowShell", "a0");
    const source = block(2, "textLeaf", "a1", wrapper.id, "1");
    const sibling = block(3, "otherText", "a2", wrapper.id, "1");
    const withSibling = run(
      [wrapper, source, sibling],
      source,
      rich("textLeaf", ""),
      { from: 0, to: 0 },
    );
    expect(withSibling.ok).toBe(true);
    if (withSibling.ok) {
      expect(withSibling.transaction.blocks[wrapper.id]?.tombstone).toBeNull();
      expect(
        withSibling.transaction.blocks[source.id]?.tombstone,
      ).not.toBeNull();
    }
    const sole = run([wrapper, source], source, rich("textLeaf", ""), {
      from: 0,
      to: 0,
    });
    expect(sole.ok).toBe(true);
    if (sole.ok) {
      expect(sole.transaction.blocks[wrapper.id]?.tombstone).not.toBeNull();
    }
  });

  it("restores the declared atomic default in a placeholder-backed body", () => {
    const body = block(1, "bodyShell", "a0");
    const source = block(2, "textLeaf", "a1", body.id, "1");
    const result = run([body, source], source, rich("textLeaf", ""), {
      from: 0,
      to: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = liveChildren(result.transaction, body.id);
    expect(restored.map((value) => value.type)).toStrictEqual(["atomLeaf"]);
    expect(result.transaction.selection).toStrictEqual({
      kind: "atomic",
      blockId: restored[0]!.id,
    });
  });

  it("case 1 removes a compound wrapper with an empty primary and placeholder body", () => {
    const previous = block(1, "otherText", "a0", null, "1");
    const wrapper = block(2, "compoundShell", "a1");
    const summary = block(3, "textLeaf", "a2", wrapper.id, "1");
    const body = block(4, "bodyShell", "a3", wrapper.id);
    const placeholder = block(5, "atomLeaf", "a4", body.id);
    const result = run(
      [previous, wrapper, summary, body, placeholder],
      summary,
      rich("textLeaf", ""),
      { from: 0, to: 0 },
      { [previous.id]: rich("otherText", "before") },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.rootBlockIds).toStrictEqual([previous.id]);
    expect(result.transaction.blocks[wrapper.id]).toBeUndefined();
    expect(result.transaction.blocks[summary.id]).toBeUndefined();
    expect(result.transaction.blocks[body.id]).toBeUndefined();
    expect(result.transaction.blocks[placeholder.id]).toBeUndefined();
    expect(result.transaction.selection).toStrictEqual({
      kind: "block-end",
      blockId: previous.id,
    });
  });

  it("case 2 removes populated compound content when the primary is empty", () => {
    const previous = block(1, "otherText", "a0", null, "1");
    const wrapper = block(2, "compoundShell", "a1");
    const summary = block(3, "textLeaf", "a2", wrapper.id, "1");
    const body = block(4, "bodyShell", "a3", wrapper.id);
    const bodyText = block(5, "otherText", "a4", body.id, "1");
    const result = run(
      [previous, wrapper, summary, body, bodyText],
      summary,
      rich("textLeaf", ""),
      { from: 0, to: 0 },
      {
        [previous.id]: rich("otherText", "before"),
        [bodyText.id]: rich("otherText", "populated"),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.rootBlockIds).toStrictEqual([previous.id]);
    expect(result.transaction.blocks[wrapper.id]).toBeUndefined();
    expect(result.transaction.blocks[bodyText.id]).toBeUndefined();
    expect(result.transaction.selection).toStrictEqual({
      kind: "block-end",
      blockId: previous.id,
    });
  });

  it("case 3 has one canonical empty-primary plan with no collapse input", () => {
    const previous = block(1, "otherText", "a0", null, "1");
    const wrapper = block(2, "compoundShell", "a1");
    const summary = block(3, "textLeaf", "a2", wrapper.id, "1");
    const body = block(4, "bodyShell", "a3", wrapper.id);
    const bodyText = block(5, "otherText", "a4", body.id, "1");
    const input = [
      [previous, wrapper, summary, body, bodyText],
      summary,
      rich("textLeaf", ""),
      { from: 0, to: 0 },
      {
        [previous.id]: rich("otherText", "before"),
        [bodyText.id]: rich("otherText", "body"),
      },
    ] as const;
    expect(plan(...input)).toStrictEqual(plan(...input));
  });

  it("case 4 merges a non-empty primary and promotes compound content", () => {
    const previous = block(1, "otherText", "a0", null, "1");
    const wrapper = block(2, "compoundShell", "a1");
    const summary = block(3, "textLeaf", "a2", wrapper.id, "1");
    const body = block(4, "bodyShell", "a3", wrapper.id);
    const bodyText = block(5, "otherText", "a4", body.id, "1");
    const result = run(
      [previous, wrapper, summary, body, bodyText],
      summary,
      rich("textLeaf", "summary"),
      { from: 0, to: 0 },
      {
        [previous.id]: rich("otherText", "before"),
        [bodyText.id]: rich("otherText", "body"),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.rootBlockIds).toStrictEqual([
      previous.id,
      bodyText.id,
    ]);
    expect(result.transaction.blocks[bodyText.id]?.parentId).toBeNull();
    expect(result.transaction.blocks[wrapper.id]).toBeUndefined();
    expect(result.transaction.stagedContent[previous.id]).toBeUndefined();
    expect(result.transaction.contentOperations).toMatchObject([
      {
        blockId: previous.id,
        operations: [
          {
            kind: "insertInlineContent",
            position: { blockId: previous.id, offset: 6 },
            content: [{ type: "text", text: "summary" }],
          },
        ],
      },
    ]);
    expect(result.transaction.selection).toStrictEqual({
      kind: "text-offset",
      blockId: previous.id,
      offset: 6,
    });
  });

  it("case 4 unwraps a non-empty primary when no merge target exists", () => {
    const wrapper = block(1, "compoundShell", "a0");
    const summary = block(2, "textLeaf", "a1", wrapper.id, "1");
    const body = block(3, "bodyShell", "a2", wrapper.id);
    const bodyText = block(4, "otherText", "a3", body.id, "1");
    const result = run(
      [wrapper, summary, body, bodyText],
      summary,
      rich("textLeaf", "summary"),
      { from: 0, to: 0 },
      { [bodyText.id]: rich("otherText", "body") },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.rootBlockIds).toStrictEqual([
      summary.id,
      bodyText.id,
    ]);
    expect(result.transaction.blocks[summary.id]?.parentId).toBeNull();
    expect(result.transaction.blocks[bodyText.id]?.parentId).toBeNull();
    expect(result.transaction.blocks[wrapper.id]).toBeUndefined();
    expect(result.transaction.selection).toStrictEqual({
      kind: "block-start",
      blockId: summary.id,
    });
  });

  it("case 5 restores the body atom while focusing the canonical primary", () => {
    const wrapper = block(1, "compoundShell", "a0");
    const title = block(2, "textLeaf", "a1", wrapper.id, "1");
    const body = block(3, "bodyShell", "a2", wrapper.id);
    const source = block(4, "textLeaf", "a3", body.id, "1");
    const result = run(
      [wrapper, title, body, source],
      source,
      rich("textLeaf", ""),
      { from: 0, to: 0 },
      { [title.id]: rich("textLeaf", "title") },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      liveChildren(result.transaction, body.id).map((value) => value.type),
    ).toStrictEqual(["atomLeaf"]);
    expect(result.transaction.selection).toStrictEqual({
      kind: "block-end",
      blockId: title.id,
    });
  });

  it("joins text across a wrapper boundary and removes the invalid wrapper", () => {
    const previous = block(1, "otherText", "a0", null, "1");
    const wrapper = block(2, "oneShell", "a1");
    const source = block(3, "textLeaf", "a2", wrapper.id, "1");
    const result = run(
      [previous, wrapper, source],
      source,
      rich("textLeaf", "right"),
      { from: 0, to: 0 },
      { [previous.id]: rich("otherText", "left") },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.stagedContent[previous.id]).toBeUndefined();
    expect(result.transaction.contentOperations).toMatchObject([
      {
        blockId: previous.id,
        operations: [
          {
            kind: "insertInlineContent",
            position: { blockId: previous.id, offset: 4 },
            content: [{ type: "text", text: "right" }],
          },
        ],
      },
    ]);
    expect(result.transaction.blocks[wrapper.id]?.tombstone).not.toBeNull();
    expect(result.transaction.selection).toStrictEqual({
      kind: "text-offset",
      blockId: previous.id,
      offset: 4,
    });
  });

  it("case 6 joins a body child into its canonical primary and restores the body atom", () => {
    const wrapper = block(1, "compoundShell", "a0");
    const title = block(2, "textLeaf", "a1", wrapper.id, "1");
    const body = block(3, "bodyShell", "a2", wrapper.id);
    const source = block(4, "textLeaf", "a3", body.id, "1");
    const result = run(
      [wrapper, title, body, source],
      source,
      rich("textLeaf", "body"),
      { from: 0, to: 0 },
      { [title.id]: rich("textLeaf", "title") },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.stagedContent[title.id]).toBeUndefined();
    expect(result.transaction.contentOperations).toMatchObject([
      {
        blockId: title.id,
        operations: [
          {
            kind: "insertInlineContent",
            position: { blockId: title.id, offset: 5 },
            content: [{ type: "text", text: "body" }],
          },
        ],
      },
    ]);
    expect(
      liveChildren(result.transaction, body.id).map((b) => b.type),
    ).toStrictEqual(["atomLeaf"]);
    expect(result.transaction.selection).toMatchObject({
      blockId: title.id,
      offset: 5,
    });
  });

  it("uses the last canonical descendant regardless of presentation state", () => {
    const wrapper = block(1, "compoundShell", "a0");
    const title = block(2, "textLeaf", "a1", wrapper.id, "1");
    const body = block(3, "bodyShell", "a2", wrapper.id);
    const bodyText = block(4, "textLeaf", "a3", body.id, "1");
    const source = block(5, "otherText", "a4", null, "1");
    const contents = {
      [title.id]: rich("textLeaf", "title"),
      [bodyText.id]: rich("textLeaf", "body"),
    };
    const planned = plan(
      [wrapper, title, body, bodyText, source],
      source,
      rich("otherText", "source"),
      { from: 0, to: 0 },
      contents,
    );
    expect(planned.ok && planned.handled).toBe(true);
    if (planned.ok && planned.handled) {
      expect(planned.plan.operations[0]).toMatchObject({
        kind: "appendTextBlockContent",
        destinationBlockId: bodyText.id,
        sourceBlockId: source.id,
      });
    }
  });

  it("cascades ordinary wrapper cleanup through multiple ancestors", () => {
    const outer = block(1, "flowShell", "a0");
    const inner = block(2, "oneShell", "a1", outer.id);
    const source = block(3, "textLeaf", "a2", inner.id, "1");
    const result = run([outer, inner, source], source, rich("textLeaf", ""), {
      from: 0,
      to: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.blocks[outer.id]?.tombstone).not.toBeNull();
    expect(result.transaction.blocks[inner.id]?.tombstone).not.toBeNull();
  });

  it("promotes configured surviving wrapper contents without product semantics", () => {
    const previous = block(1, "textLeaf", "a0", null, "1");
    const group = block(2, "laneGroup", "a1");
    const emptyLane = block(3, "lane", "a2", group.id);
    const source = block(4, "textLeaf", "a3", emptyLane.id, "1");
    const survivingLane = block(5, "lane", "a4", group.id);
    const first = block(6, "textLeaf", "a5", survivingLane.id, "1");
    const second = block(7, "otherText", "a6", survivingLane.id, "1");
    const next = block(8, "textLeaf", "a7", null, "1");
    const blocks = [
      previous,
      group,
      emptyLane,
      source,
      survivingLane,
      first,
      second,
      next,
    ];
    const contents = {
      [previous.id]: rich("textLeaf", "previous"),
      [first.id]: rich("textLeaf", "first"),
      [second.id]: rich("otherText", "second"),
      [next.id]: rich("textLeaf", "next"),
    };
    const planned = plan(
      blocks,
      source,
      rich("textLeaf", ""),
      { from: 0, to: 0 },
      contents,
    );
    expect(planned.ok && planned.handled).toBe(true);
    if (!planned.ok || !planned.handled) return;
    expect(planned.plan.operations).toStrictEqual([
      {
        kind: "moveBlocks",
        blockIds: [first.id, second.id],
        sourcePlacement: {
          parentId: survivingLane.id,
          childIndex: 0,
        },
        destinationPlacement: {
          parentId: null,
          childIndex: 1,
        },
      },
      {
        kind: "removeBlocks",
        blockIds: [group.id],
        includeDescendants: true,
        expectedParents: { [group.id]: null },
      },
      {
        kind: "setSelection",
        target: { kind: "block-start", blockId: first.id },
      },
    ]);
    const applied = run(
      blocks,
      source,
      rich("textLeaf", ""),
      { from: 0, to: 0 },
      contents,
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(
      liveChildren(applied.transaction, null).map((value) => value.id),
    ).toStrictEqual([previous.id, first.id, second.id, next.id]);
    expect(applied.transaction.blocks[first.id]?.id).toBe(first.id);
    expect(applied.transaction.blocks[second.id]?.id).toBe(second.id);
  });

  it("keeps cascading cleanup unchanged when the wrapper has no underflow policy", () => {
    const group = block(1, "ordinaryLaneGroup", "a0");
    const emptyLane = block(2, "lane", "a1", group.id);
    const source = block(3, "textLeaf", "a2", emptyLane.id, "1");
    const survivingLane = block(4, "lane", "a3", group.id);
    const survivor = block(5, "textLeaf", "a4", survivingLane.id, "1");
    const planned = plan(
      [group, emptyLane, source, survivingLane, survivor],
      source,
      rich("textLeaf", ""),
      { from: 0, to: 0 },
    );
    expect(planned.ok && planned.handled).toBe(true);
    if (!planned.ok || !planned.handled) return;
    expect(planned.plan.operations[0]).toMatchObject({
      kind: "removeBlocks",
      blockIds: [group.id],
    });
    expect(
      planned.plan.operations.some(
        (operation) => operation.kind === "moveBlocks",
      ),
    ).toBe(false);
  });

  it("fails configured underflow with typed reasons for ambiguous and unsupported graphs", () => {
    const group = block(1, "laneGroup", "a0");
    const onlyLane = block(2, "lane", "a1", group.id);
    const onlySource = block(3, "textLeaf", "a2", onlyLane.id, "1");
    expect(
      plan([group, onlyLane, onlySource], onlySource, rich("textLeaf", ""), {
        from: 0,
        to: 0,
      }),
    ).toMatchObject({ ok: false, reason: "invalid-underflow" });

    const host = block(10, "laneGroupHost", "a0");
    const nestedGroup = block(11, "laneGroup", "a1", host.id);
    const emptyLane = block(12, "lane", "a2", nestedGroup.id);
    const source = block(13, "textLeaf", "a3", emptyLane.id, "1");
    const survivingLane = block(14, "lane", "a4", nestedGroup.id);
    const survivor = block(15, "textLeaf", "a5", survivingLane.id, "1");
    expect(
      plan(
        [host, nestedGroup, emptyLane, source, survivingLane, survivor],
        source,
        rich("textLeaf", ""),
        { from: 0, to: 0 },
      ),
    ).toMatchObject({
      ok: false,
      reason: "invalid-underflow",
      message: expect.stringContaining("violates destination content"),
    });
  });

  it("does nothing when an atomic block blocks the previous merge target", () => {
    const previous = block(1, "textLeaf", "a0", null, "1");
    const atom = block(2, "atomLeaf", "a1");
    const source = block(3, "textLeaf", "a2", null, "1");
    const planned = plan(
      [previous, atom, source],
      source,
      rich("textLeaf", "source"),
      { from: 0, to: 0 },
    );
    expect(planned).toStrictEqual({
      ok: true,
      handled: false,
      reason: "no-previous-target",
    });
  });

  it("rejects stale canonical content preconditions", () => {
    const previous = block(1, "textLeaf", "a0", null, "1");
    const source = block(2, "textLeaf", "a1", null, "1");
    const contents = { [previous.id]: rich("textLeaf", "left") };
    const planned = plan(
      [previous, source],
      source,
      rich("textLeaf", "right"),
      { from: 0, to: 0 },
      contents,
    );
    expect(planned.ok && planned.handled).toBe(true);
    if (!planned.ok || !planned.handled) return;
    const changedSource = {
      ...source,
      contentVersion: asContentVersion("2"),
    };
    const context = contextFor(
      [previous, changedSource],
      changedSource,
      rich("textLeaf", "right"),
      contents,
    );
    expect(applyStructuralTransaction(planned.plan, context).ok).toBe(false);
  });
});

function run(
  blocks: readonly VersionedBlock[],
  focused: VersionedBlock,
  content: RichTextDocumentNodeJson,
  selection: { readonly from: number; readonly to: number },
  additionalContents: Readonly<Record<BlockId, RichTextDocumentNodeJson>> = {},
) {
  const planned = plan(blocks, focused, content, selection, additionalContents);
  if (!planned.ok) throw new Error(planned.message);
  if (!planned.handled) throw new Error(planned.reason);
  return applyStructuralTransaction(
    planned.plan,
    contextFor(blocks, focused, content, additionalContents),
  );
}

function plan(
  blocks: readonly VersionedBlock[],
  focused: VersionedBlock,
  content: RichTextDocumentNodeJson,
  selection: { readonly from: number; readonly to: number },
  additionalContents: Readonly<Record<BlockId, RichTextDocumentNodeJson>> = {},
) {
  let nextId = 100;
  const graph = blockRecords(blocks);
  return planBlockBoundaryBackspace({
    selectionBlockId: focused.id,
    selection,
    content: {
      content,
      plainText: "",
      version: focused.contentVersion,
    },
    ...graph,
    blockDefinitions: blockDefinitions,
    readContent: (blockId) => {
      const value =
        blockId === focused.id ? content : additionalContents[blockId];
      const block = graph.blocks[blockId];
      return value && block
        ? {
            content: value,
            plainText: "",
            version: block.contentVersion,
          }
        : null;
    },
    createBlockId: () => id(nextId++),
  });
}

function contextFor(
  blocks: readonly VersionedBlock[],
  focused: VersionedBlock,
  focusedContent: RichTextDocumentNodeJson,
  additionalContents: Readonly<Record<BlockId, RichTextDocumentNodeJson>>,
) {
  const graph = blockRecords(blocks);
  const contents = new Map<BlockId, TransactionReadableContent>();
  for (const block of blocks) {
    const definition = blockDefinitions[block.type];
    if (!definition || !(definition.kind === "text")) continue;
    const value =
      block.id === focused.id
        ? focusedContent
        : (additionalContents[block.id] ?? rich(block.type, "neighbor"));
    contents.set(block.id, {
      content: value,
      plainText: "",
      version: block.contentVersion,
    });
  }
  return {
    ...graph,
    blockDefinitions: blockDefinitions,
    readContent: (blockId: BlockId) => contents.get(blockId) ?? null,
    validateContent: (type: BlockType, value: unknown) =>
      blockDefinitions[type] !== undefined &&
      blockDefinitions[type]!.kind === "text"
        ? isRichTextDocument(value)
        : value !== undefined,
  };
}

function rich(type: BlockType, text: string) {
  return createBlockRichTextContentFromPlainText(type, text);
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

function blockRecords(blocks: readonly VersionedBlock[]) {
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
