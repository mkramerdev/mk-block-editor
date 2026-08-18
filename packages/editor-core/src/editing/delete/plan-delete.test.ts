import { describe, expect, it } from "vitest";
import {
  createBlockRichTextContentFromPlainText,
  isRichTextDocument,
  type RichTextDocumentNodeJson,
} from "../../content/rich-text/rich-inline-content.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { BlockType, VersionedBlock } from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";
import { applyStructuralTransaction } from "../transactions/apply.ts";
import type { TransactionReadableContent } from "../transactions/types.ts";
import { planBlockBoundaryDelete } from "./plan-delete.ts";

const renderer = () => null;
const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  text: { kind: "text", type: "text", renderer },
  otherText: { kind: "text", type: "otherText", renderer },
  atom: { kind: "atomic", type: "atom", renderer },
  placeholder: {
    kind: "atomic",
    type: "placeholder",
    renderer,
    replaceWith: "text",
  },
  shell: {
    kind: "wrapper",
    type: "shell",
    renderer,
    content: { required: ["text"] },
    contentBoundary: false,
  },
  body: {
    kind: "wrapper",
    type: "body",
    renderer,
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "placeholder",
  },
  compound: {
    kind: "wrapper",
    type: "compound",
    renderer,
    content: { required: ["text", "body"] },
    contentBoundary: false,
    compound: {
      kind: "primary-text-with-promoted-content",
      primaryTextChildType: "text",
      contentWrapperChildType: "body",
      emptyPrimary: "remove-wrapper",
    },
  },
};

describe("block-boundary forward Delete planning", () => {
  it.each([
    ["left", "right", "leftright"],
    ["left", "", "left"],
    ["", "right", "right"],
  ])(
    "joins current %s with next %s while retaining the current block",
    (leftText, rightText) => {
      const left = block(1, "text", null, "1");
      const right = block(2, "text", null, "1");
      const result = run([left, right], left, leftText, {
        [right.id]: rich("text", rightText),
      });
      expect(result.transaction.rootBlockIds).toEqual([left.id]);
      expect(result.transaction.blocks[right.id]).toBeUndefined();
      expect(result.transaction.stagedContent[left.id]).toBeUndefined();
      expect(result.transaction.contentOperations).toMatchObject([
        {
          blockId: left.id,
          operations: [
            {
              kind: "insertInlineContent",
              position: { blockId: left.id, offset: Array.from(leftText).length },
              content:
                rightText.length === 0
                  ? []
                  : [{ type: "text", text: rightText }],
            },
          ],
        },
      ]);
      expect(result.transaction.selection).toEqual({
        kind: "text-offset",
        blockId: left.id,
        offset: Array.from(leftText).length,
      });
    },
  );

  it("is an observable no-op at the last canonical text target", () => {
    const only = block(1, "text", null, "1");
    expect(plan([only], only, "last")).toEqual({
      ok: true,
      handled: false,
      reason: "no-next-target",
    });
  });

  it("traverses into a nested next wrapper and removes its invalid shell", () => {
    const left = block(1, "text", null, "1");
    const shell = block(2, "shell");
    const right = block(3, "text", shell.id, "1");
    const result = run([left, shell, right], left, "left", {
      [right.id]: rich("text", "right"),
    });
    expect(result.transaction.rootBlockIds).toEqual([left.id]);
    expect(result.transaction.blocks[shell.id]).toBeUndefined();
    expect(result.transaction.stagedContent[left.id]).toBeUndefined();
    expect(result.transaction.contentOperations[0]).toMatchObject({
      blockId: left.id,
      operations: [{ kind: "insertInlineContent", content: [{ text: "right" }] }],
    });
  });

  it("restores one declared default after consuming the final real body child", () => {
    const left = block(1, "text", null, "1");
    const body = block(2, "body");
    const right = block(3, "text", body.id, "1");
    const result = run([left, body, right], left, "left", {
      [right.id]: rich("text", "right"),
    });
    const bodyChildren = result.transaction.childIdsByParentId[body.id] ?? [];
    expect(bodyChildren).toHaveLength(1);
    expect(result.transaction.blocks[bodyChildren[0]!]!.type).toBe(
      "placeholder",
    );
    expect(result.transaction.blocks[right.id]).toBeUndefined();
  });

  it("does not cross an atomic next target", () => {
    const left = block(1, "text", null, "1");
    const atom = block(2, "atom");
    const right = block(3, "text", null, "1");
    expect(
      plan([left, atom, right], left, "left", {
        [right.id]: rich("text", "right"),
      }),
    ).toEqual({ ok: true, handled: false, reason: "no-next-target" });
  });

  it("uses definition-declared compound cleanup and promotes body content", () => {
    const left = block(1, "text", null, "1");
    const wrapper = block(2, "compound");
    const primary = block(3, "text", wrapper.id, "1");
    const body = block(4, "body", wrapper.id);
    const bodyText = block(5, "otherText", body.id, "1");
    const result = run([left, wrapper, primary, body, bodyText], left, "left", {
      [primary.id]: rich("text", "title"),
      [bodyText.id]: rich("otherText", "body"),
    });
    expect(result.transaction.rootBlockIds).toEqual([left.id, bodyText.id]);
    expect(result.transaction.blocks[bodyText.id]?.parentId).toBeNull();
    expect(result.transaction.blocks[wrapper.id]).toBeUndefined();
    expect(result.transaction.stagedContent[left.id]).toBeUndefined();
    expect(result.transaction.contentOperations[0]).toMatchObject({
      blockId: left.id,
      operations: [{ kind: "insertInlineContent", content: [{ text: "title" }] }],
    });
  });

  it("rejects non-end, ranged, and stale current content", () => {
    const left = block(1, "text", null, "1");
    const right = block(2, "text", null, "1");
    expect(
      plan([left, right], left, "left", {}, { from: 2, to: 2 }),
    ).toMatchObject({
      ok: false,
      reason: "local-content-route-required",
    });
    expect(
      plan([left, right], left, "left", {}, { from: 1, to: 3 }),
    ).toMatchObject({
      ok: false,
      reason: "local-content-route-required",
    });
    const planned = plan([left, right], left, "left", {
      [right.id]: rich("text", "right"),
    });
    expect(planned.ok && planned.handled).toBe(true);
    if (!planned.ok || !planned.handled) return;
    const changedRight = { ...right, contentVersion: "2" };
    expect(
      applyStructuralTransaction(
        planned.plan,
        context([left, changedRight], left, "left", {
          [changedRight.id]: rich("text", "right"),
        }),
      ).ok,
    ).toBe(false);
  });
});

function run(
  blocks: readonly VersionedBlock[],
  focused: VersionedBlock,
  focusedText: string,
  additional: Readonly<Record<BlockId, RichTextDocumentNodeJson>> = {},
) {
  const planned = plan(blocks, focused, focusedText, additional);
  if (!planned.ok) throw new Error(planned.message);
  if (!planned.handled) throw new Error(planned.reason);
  const applied = applyStructuralTransaction(
    planned.plan,
    context(blocks, focused, focusedText, additional),
  );
  if (!applied.ok) throw new Error(applied.message);
  return applied;
}

function plan(
  blocks: readonly VersionedBlock[],
  focused: VersionedBlock,
  focusedText: string,
  additional: Readonly<Record<BlockId, RichTextDocumentNodeJson>> = {},
  selection = {
    from: Array.from(focusedText).length,
    to: Array.from(focusedText).length,
  },
) {
  const graph = records(blocks);
  const content = rich(focused.type, focusedText);
  return planBlockBoundaryDelete({
    selectionBlockId: focused.id,
    selection,
    content: {
      content,
      plainText: focusedText,
      version: focused.contentVersion,
    },
    ...graph,
    blockDefinitions: definitions,
    readContent: reader(graph.blocks, focused, content, additional),
  });
}

function context(
  blocks: readonly VersionedBlock[],
  focused: VersionedBlock,
  focusedText: string,
  additional: Readonly<Record<BlockId, RichTextDocumentNodeJson>>,
) {
  const graph = records(blocks);
  const content = rich(focused.type, focusedText);
  return {
    ...graph,
    blockDefinitions: definitions,
    readContent: reader(graph.blocks, focused, content, additional),
    validateContent: (_type: BlockType, value: RichTextDocumentNodeJson) =>
      isRichTextDocument(value),
  };
}

function reader(
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
  focused: VersionedBlock,
  focusedContent: RichTextDocumentNodeJson,
  additional: Readonly<Record<BlockId, RichTextDocumentNodeJson>>,
) {
  return (blockId: BlockId): TransactionReadableContent | null => {
    const target = blocks[blockId];
    const value = blockId === focused.id ? focusedContent : additional[blockId];
    return target && value
      ? { content: value, plainText: "", version: target.contentVersion }
      : null;
  };
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
    if (value.parentId !== null)
      (childIdsByParentId[value.parentId] ??= []).push(value.id);
  }
  return { blocks: byId, rootBlockIds, childIdsByParentId };
}

function block(
  value: number,
  type: BlockType,
  parentId: BlockId | null = null,
  contentVersion: string | null = null,
): VersionedBlock {
  return {
    id: asBlockId(`01890f07-1c00-7000-8000-${String(value).padStart(12, "0")}`),
    type,
    parentId,
    tombstone: null,
    metadataVersion: "1",
    contentVersion: contentVersion as VersionedBlock["contentVersion"],
  };
}

function rich(type: BlockType, value: string) {
  return createBlockRichTextContentFromPlainText(type, value);
}
