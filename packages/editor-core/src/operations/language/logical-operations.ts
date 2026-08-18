import type { BlockType } from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { InlineMarkName } from "../../content/marks/types.ts";
import type { TransformBlocksPayload } from "./block-graph.ts";
import type {
  RichTextAttrsJson,
  RichTextInlineNodeJson,
} from "../../content/rich-text/rich-inline-types.ts";
import type { JsonObject } from "../../kernel/json/json-value.ts";

/**
 * Canonical package-neutral semantic editor operation body.
 *
 * Transport metadata, materialized data, routing identity, and actor identity
 * belong outside this union.
 */
export type EditorLogicalOperation =
  | EditorLogicalBlockGraphOperation
  | EditorLogicalBlockMetadataOperation
  | EditorLogicalContentOperation;

export interface EditorLogicalBlockGraphOperation {
  readonly kind: "blockGraph";
  readonly graphKind: "transformBlocks";
  readonly payload: TransformBlocksPayload;
}

export type EditorLogicalBlockMetadataOperation = UpdateBlockMetadataOperation;

/** Ordered semantic content changes for one block in a graph transaction. */
export interface EditorBlockContentOperationBatch {
  readonly blockId: BlockId;
  readonly operations: readonly EditorLogicalContentOperation[];
}

/**
 * The sole logical representation for atomic shallow metadata updates.
 * Block types and revision data are derived by the applying editor.
 */
export interface UpdateBlockMetadataOperation {
  readonly kind: "updateBlockMetadata";
  readonly updates: readonly BlockMetadataUpdate[];
  /**
   * Explicit field removal exists for inverse/history operations. Public
   * updateBlockMetadata callers only provide updates.
   */
  readonly deletions?: readonly BlockMetadataDeletion[];
}

export interface BlockMetadataUpdate {
  readonly blockId: BlockId;
  readonly values: JsonObject;
}

export interface BlockMetadataDeletion {
  readonly blockId: BlockId;
  readonly fields: readonly string[];
}

export interface EditorLogicalRichTextPoint {
  readonly blockId: BlockId;
  readonly offset: number;
  readonly contentVersion?: string | null;
}

export interface EditorLogicalRichTextRange {
  readonly from: EditorLogicalRichTextPoint;
  readonly to: EditorLogicalRichTextPoint;
}

export type EditorLogicalInlineTarget = { readonly kind: "text" };

export type EditorLogicalContentOperation =
  | EditorInsertInlineContentOperation
  | EditorDeleteInlineRangeOperation
  | EditorReplaceInlineRangeOperation
  | EditorInlineMarkRangeOperation
  | EditorSetInlineEntityOperation;

export interface EditorLogicalContentOperationBase {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly target: EditorLogicalInlineTarget;
}

export interface EditorInsertInlineContentOperation
  extends EditorLogicalContentOperationBase {
  readonly kind: "insertInlineContent";
  readonly position: EditorLogicalRichTextPoint;
  readonly content: readonly RichTextInlineNodeJson[];
}

export interface EditorDeleteInlineRangeOperation
  extends EditorLogicalContentOperationBase {
  readonly kind: "deleteInlineRange";
  readonly range: EditorLogicalRichTextRange;
  readonly deletedContent?: readonly RichTextInlineNodeJson[];
}

export interface EditorReplaceInlineRangeOperation
  extends EditorLogicalContentOperationBase {
  readonly kind: "replaceInlineRange";
  readonly range: EditorLogicalRichTextRange;
  readonly content: readonly RichTextInlineNodeJson[];
  readonly deletedContent?: readonly RichTextInlineNodeJson[];
}

export interface EditorInlineMarkRangeOperation
  extends EditorLogicalContentOperationBase {
  readonly kind: "addInlineMark" | "removeInlineMark";
  readonly range: EditorLogicalRichTextRange;
  readonly markName: InlineMarkName;
  readonly attrs?: RichTextAttrsJson | null;
}

export interface EditorSetInlineEntityOperation
  extends EditorLogicalContentOperationBase {
  readonly kind: "setInlineEntity";
  readonly range: EditorLogicalRichTextRange;
  readonly entity: RichTextInlineNodeJson;
  readonly deletedContent?: readonly RichTextInlineNodeJson[];
}
