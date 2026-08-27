import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { Block, BlockType } from "@repo/editor-core/document";
import type {
  BlockId,
  EditorOpaqueContentCheckpoint,
  JsonObject,
} from "@repo/editor-core/kernel";
import type {
  EditorTextBlockContent,
  EditorInstanceSnapshot,
} from "@repo/editor-core/codecs";
import { createBlockId } from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import { encodeLocalContentCheckpoint } from "../content/local/runtime.ts";

export interface TestEditorSnapshotBlockInput {
  readonly id?: BlockId;
  readonly type: BlockType;
  readonly text?: string;
  readonly content?: EditorTextBlockContent;
  readonly metadata?: JsonObject;
}

export function createTestEditorSnapshot(
  inputBlocks: readonly TestEditorSnapshotBlockInput[],
): EditorInstanceSnapshot {
  if (inputBlocks.length === 0) {
    throw new Error("test editor snapshot requires at least one block");
  }
  const blocks = {} as Record<BlockId, Block>;
  const rootBlockIds: BlockId[] = [];
  const contentById = {} as Record<BlockId, EditorTextBlockContent>;
  const opaqueContentCheckpoints = {} as Record<
    BlockId,
    EditorOpaqueContentCheckpoint
  >;
  inputBlocks.forEach((input) => {
    const blockId = input.id ?? createBlockId();
    blocks[blockId] = createBlockRecord({
      id: blockId,
      type: input.type,
      metadata: input.metadata,
    });
    rootBlockIds.push(blockId);
    if (input.content !== undefined) {
      contentById[blockId] = input.content;
    } else if (
      input.text !== undefined ||
      input.type === "textBlock" ||
      input.type === "alternateTextBlock"
    ) {
      contentById[blockId] = createBlockRichTextContentFromPlainText(
        input.type,
        input.text ?? "",
      );
    }
    const content = contentById[blockId];
    if (content) {
      const checkpoint = encodeLocalContentCheckpoint(content);
      opaqueContentCheckpoints[blockId] = {
        kind: checkpoint.kind,
        format: checkpoint.format,
        version: checkpoint.version,
        payloadBase64: encodeBase64(checkpoint.payload.copy()),
      };
    }
  });
  return {
    blockGraphVersion: 1,
    blocks,
    rootBlockIds,
    childIdsByParentId: {},
    content: contentById,
    opaqueContentCheckpoints,
  };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
