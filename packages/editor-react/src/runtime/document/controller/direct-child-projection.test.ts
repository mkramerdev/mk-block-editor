import { describe, expect, it, vi } from "vitest";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import {
  asBlockId,
  asContentVersion,
  type BlockId,
  type JsonObject,
} from "@repo/editor-core/kernel";
import { createVersionedBlockRecord } from "@repo/editor-core/metadata";
import { createEditorExternalStore } from "../../../store/external-store.ts";
import { createInitialEditorSessionState } from "../../../store/session-state.ts";
import { createInitialEditorManifestState } from "../state/command-state.ts";
import { EditorImplementation } from "./editor-implementation.ts";

const parentAId = asBlockId("direct-children-parent-a");
const parentBId = asBlockId("direct-children-parent-b");
const nestedParentId = asBlockId("direct-children-nested-parent");
const childOneId = asBlockId("direct-children-one");
const childTwoId = asBlockId("direct-children-two");
const childBId = asBlockId("direct-children-b");
const grandchildId = asBlockId("direct-children-grandchild");
const unrelatedId = asBlockId("direct-children-unrelated");
const insertedId = asBlockId("direct-children-inserted");

const renderer = () => null;
const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  paragraph: {
    kind: "text",
    type: "paragraph",
    rootLayout: "normal",
    renderer,
    split: { default: "paragraph" },
  },
  callout: {
    kind: "wrapper",
    type: "callout",
    rootLayout: "normal",
    renderer,
    contentBoundary: false,
    content: { required: ["block"], additional: "block" },
    defaultContent: "paragraph",
  },
};

describe("EditorImplementation direct-child projections", () => {
  it("publishes stable manifest-owned child arrays and rebuilds only affected parents", () => {
    const editor = createProjectionEditor();
    const first = editor.getDirectChildBlocks(parentAId);

    expect(first).toBe(editor.getDirectChildBlocks(parentAId));
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.map((block) => block.id)).toEqual([
      nestedParentId,
      childOneId,
      childTwoId,
    ]);
    expect(first[0]).toBe(editor.getBlock(nestedParentId));
    expect(first[1]).toBe(editor.getBlock(childOneId));
    expect(first[2]).toBe(editor.getBlock(childTwoId));

    expect(
      editor.updateBlockMetadata([
        { blockId: unrelatedId, values: { unrelated: true } },
      ]),
    ).toBe(true);
    expect(editor.getDirectChildBlocks(parentAId)).toBe(first);

    expect(
      editor.updateBlockMetadata([
        { blockId: childOneId, values: { label: "updated" } },
      ]),
    ).toBe(true);
    const metadataChanged = editor.getDirectChildBlocks(parentAId);
    expect(metadataChanged).not.toBe(first);
    expect(metadataChanged[0]).toBe(first[0]);
    expect(metadataChanged[1]).toBe(editor.getBlock(childOneId));
    expect(metadataChanged[1]).not.toBe(first[1]);
    expect(metadataChanged[2]).toBe(first[2]);

    const metadataVersionState = editor.getCommandState();
    editor.commitRemoteRecoveryState({
      nextState: {
        ...metadataVersionState,
        blockGraphVersion: metadataVersionState.blockGraphVersion + 1,
        blocks: {
          ...metadataVersionState.blocks,
          [childOneId]: replaceBlock(metadataVersionState.blocks[childOneId]!, {
            metadataVersion: "metadata-version-only",
          }),
        },
      },
      candidateBlockIds: [childOneId],
      afterCanonicalStateInstalled: () => undefined,
    });
    const metadataVersionChanged = editor.getDirectChildBlocks(parentAId);
    expect(metadataVersionChanged).not.toBe(metadataChanged);
    expect(metadataVersionChanged[0]).toBe(metadataChanged[0]);
    expect(metadataVersionChanged[1]).toBe(editor.getBlock(childOneId));
    expect(metadataVersionChanged[2]).toBe(metadataChanged[2]);

    const contentState = editor.getCommandState();
    editor.commitRemoteRecoveryState({
      nextState: {
        ...contentState,
        blockGraphVersion: contentState.blockGraphVersion + 1,
        blocks: {
          ...contentState.blocks,
          [childOneId]: replaceBlock(contentState.blocks[childOneId]!, {
            contentVersion: "content-2",
          }),
        },
      },
      candidateBlockIds: [childOneId],
      afterCanonicalStateInstalled: () => undefined,
    });
    const contentChanged = editor.getDirectChildBlocks(parentAId);
    expect(contentChanged).not.toBe(metadataVersionChanged);
    expect(contentChanged[0]).toBe(metadataVersionChanged[0]);
    expect(contentChanged[1]).toBe(editor.getBlock(childOneId));
    expect(contentChanged[2]).toBe(metadataVersionChanged[2]);

    recover(editor, ({ blocks, rootBlockIds, childIdsByParentId }) => ({
      blocks,
      rootBlockIds,
      childIdsByParentId: {
        ...childIdsByParentId,
        [parentAId]: [childTwoId, nestedParentId, childOneId],
      },
    }));
    const reordered = editor.getDirectChildBlocks(parentAId);
    expect(reordered).not.toBe(contentChanged);
    expect(reordered.map((block) => block.id)).toEqual([
      childTwoId,
      nestedParentId,
      childOneId,
    ]);

    recover(editor, ({ blocks, rootBlockIds, childIdsByParentId }) => ({
      blocks: {
        ...blocks,
        [insertedId]: block(insertedId, "paragraph", parentAId),
      },
      rootBlockIds,
      childIdsByParentId: {
        ...childIdsByParentId,
        [parentAId]: [...childIdsByParentId[parentAId]!, insertedId],
      },
    }));
    const inserted = editor.getDirectChildBlocks(parentAId);
    expect(inserted).not.toBe(reordered);
    expect(inserted.at(-1)).toBe(editor.getBlock(insertedId));

    recover(editor, ({ blocks, rootBlockIds, childIdsByParentId }) => {
      const remainingBlocks = { ...blocks };
      delete remainingBlocks[childTwoId];
      return {
        blocks: remainingBlocks,
        rootBlockIds,
        childIdsByParentId: {
          ...childIdsByParentId,
          [parentAId]: childIdsByParentId[parentAId]!.filter(
            (blockId) => blockId !== childTwoId,
          ),
        },
      };
    });
    const removed = editor.getDirectChildBlocks(parentAId);
    expect(removed).not.toBe(inserted);
    expect(removed.some((block) => block.id === childTwoId)).toBe(false);

    const parentBBeforeMove = editor.getDirectChildBlocks(parentBId);
    recover(editor, ({ blocks, rootBlockIds, childIdsByParentId }) => ({
      blocks: {
        ...blocks,
        [insertedId]: replaceBlock(blocks[insertedId]!, {
          parentId: parentBId,
        }),
      },
      rootBlockIds,
      childIdsByParentId: {
        ...childIdsByParentId,
        [parentAId]: childIdsByParentId[parentAId]!.filter(
          (blockId) => blockId !== insertedId,
        ),
        [parentBId]: [...childIdsByParentId[parentBId]!, insertedId],
      },
    }));
    expect(editor.getDirectChildBlocks(parentAId)).not.toBe(removed);
    expect(editor.getDirectChildBlocks(parentBId)).not.toBe(parentBBeforeMove);
    expect(editor.getDirectChildBlocks(parentBId).at(-1)?.id).toBe(insertedId);

    editor.dispose();
  });

  it("notifies each affected parent once and shares one rebuilt snapshot", () => {
    const editor = createProjectionEditor();
    const parentAFirstListener = vi.fn(() =>
      editor.getDirectChildBlocks(parentAId),
    );
    const parentASecondListener = vi.fn(() =>
      editor.getDirectChildBlocks(parentAId),
    );
    const nestedListener = vi.fn();
    const parentBListener = vi.fn();
    const releaseFirst = editor.subscribeDirectChildBlocks(
      parentAId,
      parentAFirstListener,
    );
    const releaseSecond = editor.subscribeDirectChildBlocks(
      parentAId,
      parentASecondListener,
    );
    editor.subscribeDirectChildBlocks(nestedParentId, nestedListener);
    editor.subscribeDirectChildBlocks(parentBId, parentBListener);
    editor.getDirectChildBlocks(parentAId);

    expect(
      editor.updateBlockMetadata([
        { blockId: unrelatedId, values: { unrelated: true } },
      ]),
    ).toBe(true);
    expect(parentAFirstListener).not.toHaveBeenCalled();
    expect(nestedListener).not.toHaveBeenCalled();
    expect(parentBListener).not.toHaveBeenCalled();

    expect(
      editor.updateBlockMetadata([
        { blockId: grandchildId, values: { nested: true } },
      ]),
    ).toBe(true);
    expect(nestedListener).toHaveBeenCalledOnce();
    expect(parentAFirstListener).not.toHaveBeenCalled();

    expect(
      editor.updateBlockMetadata([
        { blockId: nestedParentId, values: { first: true } },
        { blockId: childOneId, values: { second: true } },
      ]),
    ).toBe(true);
    expect(parentAFirstListener).toHaveBeenCalledOnce();
    expect(parentASecondListener).toHaveBeenCalledOnce();
    expect(parentAFirstListener.mock.results[0]?.value).toBe(
      parentASecondListener.mock.results[0]?.value,
    );

    releaseFirst();
    releaseFirst();
    releaseSecond();
    parentAFirstListener.mockClear();
    parentASecondListener.mockClear();
    expect(
      editor.updateBlockMetadata([
        { blockId: childTwoId, values: { released: true } },
      ]),
    ).toBe(true);
    expect(parentAFirstListener).not.toHaveBeenCalled();
    expect(parentASecondListener).not.toHaveBeenCalled();

    editor.dispose();
    const internals = editor as unknown as {
      readonly directChildBlocksByParentId: ReadonlyMap<BlockId, unknown>;
      readonly directChildBlockListenersByParentId: ReadonlyMap<
        BlockId,
        unknown
      >;
    };
    expect(internals.directChildBlocksByParentId.size).toBe(0);
    expect(internals.directChildBlockListenersByParentId.size).toBe(0);
    expect(editor.subscribeDirectChildBlocks(parentAId, vi.fn())).not.toThrow();
  });

  it("filters tombstoned and mismatched records even if a stale sequence names them", () => {
    const editor = createProjectionEditor();
    const manifest = editor.getManifestData();
    const tombstoned = createVersionedBlockRecord({
      id: childOneId,
      type: "paragraph",
      parentId: parentAId,
      version: {
        metadataVersion: "metadata-2",
        contentVersion: asContentVersion("content-1"),
      },
      tombstone: { deletedAt: 1, reason: "user-delete" },
    });
    const mismatched = replaceBlock(manifest.blocks[childTwoId]!, {
      parentId: parentBId,
    });
    const internals = editor as unknown as {
      manifestState: {
        readonly blockGraphVersion: number;
        readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
        readonly rootBlockIds: readonly BlockId[];
        readonly childIdsByParentId: Readonly<
          Partial<Record<BlockId, readonly BlockId[]>>
        >;
        readonly createdAt: number;
        readonly updatedAt: number;
      };
      readonly directChildBlocksByParentId: Map<
        BlockId,
        readonly VersionedBlock[]
      >;
    };
    internals.manifestState = {
      ...internals.manifestState,
      blocks: {
        ...manifest.blocks,
        [childOneId]: tombstoned,
        [childTwoId]: mismatched,
      },
    };
    internals.directChildBlocksByParentId.clear();

    expect(
      editor.getDirectChildBlocks(parentAId).map((block) => block.id),
    ).toEqual([nestedParentId]);
    editor.dispose();
  });

  it("invalidates old and new parents for moves, undo, redo, remote, and recovery", () => {
    const editor = createProjectionEditor();
    const parentAListener = vi.fn();
    const parentBListener = vi.fn();
    editor.subscribeDirectChildBlocks(parentAId, parentAListener);
    editor.subscribeDirectChildBlocks(parentBId, parentBListener);

    const moved = editor.moveBlocks({
      blockIds: [childTwoId],
      destination: { parentId: parentBId, childIndex: 1 },
    });
    if (!moved.ok) throw new Error(JSON.stringify(moved));
    expect(moved).toMatchObject({ ok: true, changed: true });
    expect(parentAListener).toHaveBeenCalledOnce();
    expect(parentBListener).toHaveBeenCalledOnce();

    parentAListener.mockClear();
    parentBListener.mockClear();
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(parentAListener).toHaveBeenCalledOnce();
    expect(parentBListener).toHaveBeenCalledOnce();

    parentAListener.mockClear();
    parentBListener.mockClear();
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(parentAListener).toHaveBeenCalledOnce();
    expect(parentBListener).toHaveBeenCalledOnce();

    parentAListener.mockClear();
    parentBListener.mockClear();
    const childB = editor.getBlock(childBId)!;
    editor.applyEditorBlockGraphPatch({
      origin: "remote-materialized-patch",
      blockGraphVersion: editor.getEditorInfo().blockGraphVersion + 1,
      patch: {
        affectedBlockIds: [childBId],
        upsertedBlocks: [
          replaceBlock(childB, {
            metadataVersion: "remote-2",
            metadata: { remote: true },
          }),
        ],
        rootBlockIds: editor.getRootBlockIds(),
        childIdsByParentId: editor.getManifestData().childIdsByParentId,
      },
    });
    expect(parentAListener).not.toHaveBeenCalled();
    expect(parentBListener).toHaveBeenCalledOnce();

    parentAListener.mockClear();
    parentBListener.mockClear();
    recover(editor, ({ blocks, rootBlockIds, childIdsByParentId }) => ({
      blocks: {
        ...blocks,
        [childOneId]: replaceBlock(blocks[childOneId]!, {
          metadataVersion: "recovery-2",
          metadata: { recovered: true },
        }),
      },
      rootBlockIds,
      childIdsByParentId,
    }));
    expect(parentAListener).toHaveBeenCalledOnce();
    expect(parentBListener).not.toHaveBeenCalled();

    editor.dispose();
  });
});

function createProjectionEditor(): EditorImplementation {
  const blocks = [
    block(parentAId, "callout"),
    block(nestedParentId, "callout", parentAId),
    block(grandchildId, "paragraph", nestedParentId),
    block(childOneId, "paragraph", parentAId),
    block(childTwoId, "paragraph", parentAId),
    block(parentBId, "callout"),
    block(childBId, "paragraph", parentBId),
    block(unrelatedId, "paragraph"),
  ];
  return new EditorImplementation({
    store: createEditorExternalStore(createInitialEditorSessionState({})),
    manifest: createInitialEditorManifestState({
      blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry])),
      rootBlockIds: [parentAId, parentBId, unrelatedId],
      childIdsByParentId: {
        [parentAId]: [nestedParentId, childOneId, childTwoId],
        [nestedParentId]: [grandchildId],
        [parentBId]: [childBId],
      },
    }),
    blockDefinitions: definitions,
    defaultRootBlockType: "paragraph",
    inlineMarks: [],
    readBlockContent: (_blockId, blockType) =>
      definitions[blockType]?.kind === "text"
        ? createBlockRichTextContentFromPlainText(blockType, "content")
        : null,
    readBlockPlainText: () => "",
  });
}

function block(
  id: BlockId,
  type: BlockType,
  parentId: BlockId | null = null,
): VersionedBlock {
  return createVersionedBlockRecord({
    id,
    type,
    parentId,
    version: {
      metadataVersion: "metadata-1",
      contentVersion:
        definitions[type]?.kind === "text"
          ? asContentVersion("content-1")
          : null,
    },
  });
}

function replaceBlock(
  current: VersionedBlock,
  changes: {
    readonly parentId?: BlockId;
    readonly metadataVersion?: string;
    readonly contentVersion?: string;
    readonly metadata?: JsonObject;
  },
): VersionedBlock {
  return createVersionedBlockRecord({
    id: current.id,
    type: current.type,
    parentId: changes.parentId ?? current.parentId,
    metadata: changes.metadata ?? current.metadata,
    version: {
      metadataVersion: changes.metadataVersion ?? current.metadataVersion,
      contentVersion:
        changes.contentVersion === undefined
          ? current.contentVersion
          : asContentVersion(changes.contentVersion),
    },
    tombstone: current.tombstone,
  });
}

function recover(
  editor: EditorImplementation,
  transform: (state: {
    readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
    readonly rootBlockIds: readonly BlockId[];
    readonly childIdsByParentId: Readonly<
      Partial<Record<BlockId, readonly BlockId[]>>
    >;
  }) => {
    readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
    readonly rootBlockIds: readonly BlockId[];
    readonly childIdsByParentId: Readonly<
      Partial<Record<BlockId, readonly BlockId[]>>
    >;
  },
): void {
  const current = editor.getManifestData();
  const next = transform(current);
  editor.reconcileEditorSnapshotForRecovery({
    origin: "external-snapshot",
    blockGraphVersion: editor.getEditorInfo().blockGraphVersion + 1,
    blocks: next.blocks,
    rootBlockIds: next.rootBlockIds,
    childIdsByParentId: next.childIdsByParentId,
  });
}
