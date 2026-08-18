import { describe, expect, it, vi } from "vitest";
import { asBlockId } from "@repo/editor-core/kernel";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { VersionedBlock } from "@repo/editor-core/document";
import { wholeSelection } from "@repo/editor-core/selection";
import { commitCanonicalBlockCreation } from "./canonical-block-insertion.ts";

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
  boundary: {
    kind: "wrapper",
    type: "boundary",
    renderer,
    rootLayout: "full",
    content: { required: ["paragraph"], additional: "paragraph" },
    contentBoundary: true,
    defaultContent: "paragraph",
  },
  selectableWrapper: {
    kind: "wrapper",
    type: "selectableWrapper",
    renderer,
    rootLayout: "normal",
    selection: wholeSelection(),
    content: { required: [] },
    contentBoundary: false,
  },
  passiveWrapper: {
    kind: "wrapper",
    type: "passiveWrapper",
    renderer,
    rootLayout: "normal",
    content: { required: [] },
    contentBoundary: false,
  },
};
const sourceId = asBlockId("01890f07-1c00-7000-8000-000000000001");
const source: VersionedBlock = {
  id: sourceId,
  type: "paragraph",
  parentId: null,
  tombstone: null,
  metadataVersion: "1",
  contentVersion: "1",
};

function fixture(sourceBlock: VersionedBlock = source) {
  const deleteRange = vi.fn();
  const deleteBlocks = vi.fn();
  const insertBlocks = vi.fn();
  const setTransactionSelection = vi.fn();
  const transaction = vi.fn((callback: () => unknown) => {
    callback();
    return { ok: true as const, changed: true as const };
  });
  return {
    deleteRange,
    deleteBlocks,
    insertBlocks,
    setTransactionSelection,
    transaction,
    editor: {
      getBlock: (blockId: typeof sourceId) =>
        blockId === sourceId ? sourceBlock : null,
      getCommandState: () => ({
        blockGraphVersion: 1,
        blocks: { [sourceId]: sourceBlock },
        rootBlockIds: [sourceId],
        childIdsByParentId: {},
      }),
      getRootBlockIds: () => [sourceId],
      getChildBlockIds: () => [],
      transaction,
      deleteRange,
      deleteBlocks,
      insertBlocks,
      setTransactionSelection,
    } as never,
  };
}

describe("application-created canonical insertion", () => {
  it("materializes adjacent content and inserts it through one active transaction", () => {
    const value = fixture();
    const result = commitCanonicalBlockCreation({
      editor: value.editor,
      graphRevision: 1,
      blockDefinitions: definitions,
      targetBlockId: sourceId,
      blockType: "divider",
      placement: "after",
      selection: "created",
    });

    expect(result.ok).toBe(true);
    expect(value.transaction).toHaveBeenCalledOnce();
    expect(value.deleteRange).not.toHaveBeenCalled();
    expect(value.insertBlocks).toHaveBeenCalledOnce();
    const [placement, fragment] = value.insertBlocks.mock.calls[0]!;
    expect(placement).toEqual({ parentId: null, childIndex: 1 });
    expect(fragment).toMatchObject({
      rootBlockIds: [result.ok ? result.rootBlockId : ""],
      start: { kind: "block" },
      end: { kind: "block" },
    });
    expect(fragment.blocks[0]).toMatchObject({
      type: "divider",
      parentId: null,
    });
    expect(fragment.blocks[0].id).not.toBe(sourceId);
  });

  it("stages canonical insertion before deleting the sole source root", () => {
    const value = fixture();
    const result = commitCanonicalBlockCreation({
      editor: value.editor,
      graphRevision: 1,
      blockDefinitions: definitions,
      targetBlockId: sourceId,
      blockType: "divider",
      placement: "replace",
      selection: "created",
    });

    expect(result.ok).toBe(true);
    expect(value.transaction).toHaveBeenCalledOnce();
    expect(value.deleteBlocks).toHaveBeenCalledWith({
      blockIds: [sourceId],
      includeDescendants: true,
      expectedParents: { [sourceId]: null },
    });
    expect(value.insertBlocks.mock.invocationCallOrder[0]).toBeLessThan(
      value.deleteBlocks.mock.invocationCallOrder[0]!,
    );
  });

  it("inserts beside an explicitly targeted root content boundary", () => {
    const value = fixture({ ...source, type: "boundary" });
    const result = commitCanonicalBlockCreation({
      editor: value.editor,
      graphRevision: 1,
      blockDefinitions: definitions,
      targetBlockId: sourceId,
      blockType: "paragraph",
      placement: "after",
      selection: "created",
    });

    expect(result.ok).toBe(true);
    expect(value.insertBlocks).toHaveBeenCalledWith(
      { parentId: null, childIndex: 1 },
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: "paragraph", parentId: null }),
        ]),
      }),
    );
  });

  it("inserts and block-selects an explicitly selectable empty wrapper", () => {
    const value = fixture();
    const result = commitCanonicalBlockCreation({
      editor: value.editor,
      graphRevision: 1,
      blockDefinitions: definitions,
      targetBlockId: sourceId,
      blockType: "selectableWrapper",
      placement: "after",
      selection: "created",
    });

    expect(result.ok).toBe(true);
    expect(value.transaction).toHaveBeenCalledOnce();
    expect(value.insertBlocks).toHaveBeenCalledOnce();
    if (!result.ok) throw new Error(result.message);
    expect(result.selectionBlockId).toBe(result.rootBlockId);
    expect(value.setTransactionSelection).toHaveBeenCalledOnce();
    expect(value.setTransactionSelection).toHaveBeenCalledWith({
      kind: "block",
      blockId: result.rootBlockId,
    });
  });

  it("rejects an empty wrapper without a selectable endpoint before a transaction", () => {
    const value = fixture();
    const result = commitCanonicalBlockCreation({
      editor: value.editor,
      graphRevision: 1,
      blockDefinitions: definitions,
      targetBlockId: sourceId,
      blockType: "passiveWrapper",
      placement: "after",
      selection: "created",
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("selection target"),
    });
    expect(value.transaction).not.toHaveBeenCalled();
    expect(value.insertBlocks).not.toHaveBeenCalled();
    expect(value.setTransactionSelection).not.toHaveBeenCalled();
  });
});
