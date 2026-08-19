import type { Block } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorContentCheckpoint } from "@repo/editor-core/content/rich-text";
import type {
  EditorInstanceBlockSlice,
  EditorTextBlockContent,
} from "@repo/editor-core/codecs";
import { assertValidEditorInstanceBlockSlice } from "@repo/editor-core/codecs";
import { isRichTextDocument } from "@repo/editor-core/content/rich-text";
import type { EditorContentRuntime } from "@repo/editor-core/content";
import type { EditorImplementation } from "@repo/editor-react/editor";

export function createEditorBlockSliceFromEditor(
  editor: EditorImplementation,
  contentRuntime: EditorContentRuntime,
  blockDefinitions: Readonly<Record<Block["type"], BlockDefinition>>,
  options: {
    readonly affectedBlockIds: readonly BlockId[];
    readonly deletedBlockIds?: readonly BlockId[];
  },
): EditorInstanceBlockSlice {
  const info = editor.getEditorInfo();
  const manifest = editor.getManifestData();
  const blocks = {} as Record<BlockId, Block>;
  for (const blockId of options.affectedBlockIds) {
    const block = editor.getBlock(blockId);
    if (block) blocks[blockId] = block;
  }
  return createEditorBlockSliceFromDocumentState({
    blockGraphVersion: info.blockGraphVersion,
    affectedBlockIds: options.affectedBlockIds,
    blocks,
    rootBlockIds: manifest.rootBlockIds,
    childIdsByParentId: manifest.childIdsByParentId,
    contentRuntime,
    blockDefinitions,
    deletedBlockIds: options.deletedBlockIds,
  });
}

function createEditorBlockSliceFromDocumentState(input: {
  readonly blockGraphVersion: number;
  readonly affectedBlockIds: readonly BlockId[];
  readonly blocks: Readonly<Record<BlockId, Block>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly contentRuntime: EditorContentRuntime;
  readonly blockDefinitions: Readonly<Record<Block["type"], BlockDefinition>>;
  readonly deletedBlockIds?: readonly BlockId[];
}): EditorInstanceBlockSlice {
  const deletedBlockIds = new Set(input.deletedBlockIds ?? []);
  const blocks = {} as Record<BlockId, Block>;
  const contentById = {} as Record<BlockId, EditorTextBlockContent>;
  const contentCheckpoints = {} as Record<BlockId, EditorContentCheckpoint>;
  for (const blockId of uniqueEditorBlockIds(input.affectedBlockIds)) {
    if (deletedBlockIds.has(blockId)) continue;
    const block = input.blocks[blockId];
    if (!block || block.tombstone) continue;
    blocks[blockId] = canonicalBlockForSnapshot(block);
    if (input.blockDefinitions[block.type]?.kind === "text") {
      contentById[blockId] = readEditorBlockContent(
        input.contentRuntime,
        blockId,
        block.type,
      );
      contentCheckpoints[blockId] =
        input.contentRuntime.readBlockContentCheckpoint(blockId, block.type);
    }
  }
  const slice: EditorInstanceBlockSlice = {
    blockGraphVersion: input.blockGraphVersion,
    affectedBlockIds: uniqueEditorBlockIds([
      ...input.affectedBlockIds,
      ...(input.deletedBlockIds ?? []),
    ]),
    blocks,
    rootBlockIds: input.rootBlockIds,
    childIdsByParentId: input.childIdsByParentId,
    content: contentById,
    contentCheckpoints,
    ...(input.deletedBlockIds === undefined
      ? {}
      : { deletedBlockIds: uniqueEditorBlockIds(input.deletedBlockIds) }),
  };
  assertValidEditorInstanceBlockSlice(slice, {
    blockDefinitions: input.blockDefinitions,
  });
  return slice;
}

function canonicalBlockForSnapshot(block: Block): Block {
  const {
    metadataVersion: _metadataVersion,
    contentVersion: _contentVersion,
    ...canonicalBlock
  } = block as Block & {
    readonly metadataVersion?: unknown;
    readonly contentVersion?: unknown;
  };
  void _metadataVersion;
  void _contentVersion;
  return canonicalBlock;
}

function readEditorBlockContent(
  contentRuntime: EditorContentRuntime,
  blockId: BlockId,
  blockType: Block["type"],
): EditorTextBlockContent {
  const content = contentRuntime.readBlockProjection(blockId, blockType);
  if (!isRichTextDocument(content)) {
    throw new Error(
      `Editor mutation is missing rich-text content for block ${blockId}`,
    );
  }
  return content;
}

function uniqueEditorBlockIds(
  blockIds: readonly BlockId[],
): readonly BlockId[] {
  const seen = new Set<BlockId>();
  const unique: BlockId[] = [];
  for (const blockId of blockIds) {
    if (seen.has(blockId)) continue;
    seen.add(blockId);
    unique.push(blockId);
  }
  return unique;
}
