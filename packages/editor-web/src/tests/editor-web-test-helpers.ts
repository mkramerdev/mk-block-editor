import {
  asBlockId,
  type EditorOpaqueContentCheckpoint,
  type JsonObject,
} from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import { getCanonicalBlockOrder } from "@repo/editor-core/document";
import type { ContentVersion } from "@repo/editor-core/kernel";
import type { Block, BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorCommandState } from "@repo/editor-react/editor";
import { encodeLocalContentCheckpoint } from "../content/local/runtime.ts";
import {
  createBlockRichTextContentFromPlainText,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";

export interface EditorBlockGraphFixture {
  blockGraphVersion: number;
  createdAt: number;
  updatedAt: number;
  rootBlockIds: BlockId[];
  childIdsByParentId: Partial<Record<BlockId, BlockId[]>>;
  blocks: Record<BlockId, Block>;
}

export type EditorDocumentContentInput =
  | string
  | RichTextDocumentNodeJson
  | null;

export interface EditorDocumentBlockData {
  id: BlockId;
  type: BlockType;
  parentId: BlockId | null;
  metadataVersion: string;
  contentVersion: ContentVersion | null;
  tombstone: Block["tombstone"];
  metadata?: JsonObject;
  contentHydrationUpdate: Uint8Array;
  contentReadProjection: RichTextDocumentNodeJson | null;
}

export interface EditorDocumentSnapshotData {
  blockGraphVersion?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface EditorDocumentOrderData {
  blockIds: readonly BlockId[];
}

export interface EditorDocumentBlockBatchData {
  blocks: readonly EditorDocumentBlockData[];
}

export interface MaterializedEditorDocumentData {
  blockGraphVersion: number;
  blockIds: readonly BlockId[];
  blocks: Record<BlockId, Block>;
  rootBlockIds: readonly BlockId[];
  childIdsByParentId: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>;
  opaqueContentCheckpoints: Record<BlockId, EditorOpaqueContentCheckpoint>;
  contentById: Partial<Record<BlockId, RichTextDocumentNodeJson>>;
  createdAt: number;
  updatedAt: number;
}

export function testBlockId(index: number): BlockId {
  return asBlockId(
    `01890f07-1c00-7000-8000-${String(6001 + index).padStart(12, "0")}`,
  );
}

export function createBlockGraphFromTypes(
  types: readonly BlockType[],
): EditorBlockGraphFixture {
  const blocks: Record<BlockId, Block> = {};
  const rootBlockIds: BlockId[] = [];
  for (let index = 0; index < types.length; index += 1) {
    const id = testBlockId(index);
    blocks[id] = createBlockRecord({
      id,
      type: types[index] ?? "paragraph",
      metadata: metadataForType(types[index] ?? "paragraph"),
    });
    rootBlockIds.push(id);
  }
  const blockGraph: EditorBlockGraphFixture = {
    blockGraphVersion: 1,
    createdAt: 1,
    updatedAt: 1,
    rootBlockIds,
    childIdsByParentId: {},
    blocks,
  };
  return blockGraph;
}

export function createDocumentFromTypes(
  types: readonly BlockType[],
): MaterializedEditorDocumentData {
  const blockGraph = createBlockGraphFromTypes(types);
  return materializeEditorDocumentData(
    documentDataFromBlockGraph(blockGraph),
    createEditorDocumentOrderData(blockGraph.rootBlockIds),
    {
      blocks: blockDataFromBlockGraph(blockGraph),
    },
  );
}

export function createEditorDocumentOrderData(
  blockIds: readonly BlockId[],
): EditorDocumentOrderData {
  return { blockIds: [...blockIds] };
}

export function materializeEditorDocumentData(
  snapshot: EditorDocumentSnapshotData,
  orderData: EditorDocumentOrderData,
  blockBatch: EditorDocumentBlockBatchData,
): MaterializedEditorDocumentData {
  const blockDataById = new Map(
    blockBatch.blocks.map((block) => [block.id, block]),
  );
  const blocks: Record<BlockId, Block> = {};
  const opaqueContentCheckpoints = {} as Record<
    BlockId,
    EditorOpaqueContentCheckpoint
  >;
  const contentById = {} as Partial<Record<BlockId, RichTextDocumentNodeJson>>;
  for (const blockId of orderData.blockIds) {
    const block = blockDataById.get(blockId);
    if (!block)
      throw new Error(`document order references missing block ${blockId}`);
    blocks[blockId] = createBlockRecord({
      id: block.id,
      type: block.type,
      parentId: block.parentId,
      metadataVersion: block.metadataVersion,
      contentVersion: block.contentVersion,
      tombstone: block.tombstone,
      metadata: block.metadata,
    });
    if (block.contentReadProjection) {
      contentById[blockId] = block.contentReadProjection;
      const checkpoint = encodeLocalContentCheckpoint(block.contentReadProjection);
      opaqueContentCheckpoints[blockId] = Object.freeze({
        kind: checkpoint.kind,
        format: checkpoint.format,
        version: checkpoint.version,
        payloadBase64: encodeBase64(checkpoint.payload.copy()),
      });
    }
  }

  return {
    blockGraphVersion: snapshot.blockGraphVersion ?? 1,
    blockIds: [...orderData.blockIds],
    blocks,
    rootBlockIds: blocksInRootOrder(blocks, orderData.blockIds),
    childIdsByParentId: childSequences(blocks, orderData.blockIds),
    opaqueContentCheckpoints,
    contentById,
    createdAt: snapshot.createdAt ?? 1,
    updatedAt: snapshot.updatedAt ?? 1,
  };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function blocksInRootOrder(
  blocks: Readonly<Record<BlockId, Block>>,
  traversal: readonly BlockId[],
): BlockId[] {
  return traversal.filter((blockId) => blocks[blockId]?.parentId === null);
}

function childSequences(
  blocks: Readonly<Record<BlockId, Block>>,
  traversal: readonly BlockId[],
): Partial<Record<BlockId, BlockId[]>> {
  const result = {} as Partial<Record<BlockId, BlockId[]>>;
  for (const blockId of traversal) {
    const parentId = blocks[blockId]?.parentId;
    if (parentId) (result[parentId] ??= []).push(blockId);
  }
  return result;
}

export function documentDataFromBlockGraph(
  blockGraph: EditorBlockGraphFixture,
): EditorDocumentSnapshotData {
  return {
    blockGraphVersion: blockGraph.blockGraphVersion,
    createdAt: blockGraph.createdAt,
    updatedAt: blockGraph.updatedAt,
  };
}

export function blockDataFromBlockGraph(
  blockGraph: EditorBlockGraphFixture,
  contentByBlockId: Partial<Record<BlockId, EditorDocumentContentInput>> = {},
): EditorDocumentBlockData[] {
  return getCanonicalBlockOrder(blockGraph).map((id) => {
    const block = blockGraph.blocks[id];
    if (!block) throw new Error(`missing block ${id}`);
    const content = contentByBlockId[block.id];
    return {
      id: block.id,
      type: block.type,
      parentId: block.parentId,
      metadataVersion: block.metadataVersion,
      contentVersion: block.contentVersion ?? ("v1" as ContentVersion),
      tombstone: block.tombstone,
      metadata: block.metadata,
      contentHydrationUpdate: new Uint8Array(),
      contentReadProjection:
        typeof content === "string"
          ? createBlockRichTextContentFromPlainText(block.type, content)
          : (content ?? null),
    };
  });
}

export function blockGraphFromState(
  state: EditorCommandState,
): EditorBlockGraphFixture {
  return {
    blockGraphVersion: state.blockGraphVersion,
    rootBlockIds: [...state.rootBlockIds],
    childIdsByParentId: Object.fromEntries(
      Object.entries(state.childIdsByParentId).map(([parentId, childIds]) => [
        parentId,
        [...(childIds ?? [])],
      ]),
    ),
    blocks: state.blocks,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

export function applyBlockGraphToState(
  state: EditorCommandState,
  blockGraph: EditorBlockGraphFixture,
): EditorCommandState {
  return {
    ...state,
    blockGraphVersion: blockGraph.blockGraphVersion,
    blocks: blockGraph.blocks,
    rootBlockIds: blockGraph.rootBlockIds,
    childIdsByParentId: blockGraph.childIdsByParentId,
    createdAt: blockGraph.createdAt,
    updatedAt: blockGraph.updatedAt,
  };
}

function metadataForType(type: BlockType): JsonObject | undefined {
  switch (type) {
    case "checklistItem":
      return { checked: true };
    case "code":
      return { language: "ts" };
    case "image":
    case "video":
    case "audio":
    case "file":
      return { caption: `${type} caption` };
    case "embed":
      return { url: "https://example.test" };
    case "collection":
      return { width: 1600 };
    case "database":
      return { viewId: "view-1" };
    default:
      return undefined;
  }
}
