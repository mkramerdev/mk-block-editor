import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import { cloneJsonValue } from "@repo/editor-core/kernel";
import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  isRichTextDocument,
} from "@repo/editor-core/content/rich-text";
import type {
  EditorContentDataReconciliation,
  EditorContentRuntimeSource,
  EditorRawBlockContent,
} from "@repo/editor-core/content";

export function readSourceBlockTypes(
  source: EditorContentRuntimeSource,
): Record<BlockId, BlockType> {
  return { ...source.blockTypesById };
}

export function readSourceContent(
  source: EditorContentRuntimeSource,
  blockId: BlockId,
): EditorRawBlockContent | undefined {
  if (!source.contentById) return undefined;
  return Object.prototype.hasOwnProperty.call(source.contentById, blockId)
    ? source.contentById[blockId]
    : undefined;
}

export function readReconciliationProjection(
  data: EditorContentDataReconciliation,
  blockId: BlockId,
): EditorRawBlockContent | undefined {
  return data.contentById &&
    Object.prototype.hasOwnProperty.call(data.contentById, blockId)
    ? data.contentById[blockId]
    : undefined;
}

export function defaultContentForBlockType(
  blockType: BlockType,
): EditorRawBlockContent {
  return createBlockRichTextContentFromPlainText(blockType, "");
}

export function plainTextForContent(content: EditorRawBlockContent): string {
  return isRichTextDocument(content)
    ? extractPlainTextFromRichTextDocument(content)
    : "";
}

export function cloneContent<T extends EditorRawBlockContent | undefined>(
  content: T,
): T {
  if (content === undefined) return content;
  return cloneJsonValue(content) as T;
}

const ownedContentValues = new WeakSet<object>();

/**
 * Establishes the local runtime's immutable ownership of canonical content.
 * Prepared edits structurally share already-owned subtrees, so the ownership
 * walk only visits the newly created path on subsequent edits.
 */
export function ownContent<T extends EditorRawBlockContent>(content: T): T {
  ownContentValue(content);
  return content;
}

function ownContentValue(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (ownedContentValues.has(value)) return;
  for (const child of Object.values(value)) ownContentValue(child);
  Object.freeze(value);
  ownedContentValues.add(value);
}
