import type { BlockType } from "../../document/model/block.ts";
import type { JsonValue } from "../../kernel/json/json-value.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type {
  EditorDeleteInlineRangeOperation,
  EditorInlineMarkRangeOperation,
  EditorInsertInlineContentOperation,
  EditorLogicalContentOperation,
  EditorReplaceInlineRangeOperation,
  EditorSetInlineEntityOperation,
} from "../language/logical-operations.ts";

/** Serialized, runtime-independent identity for one operation boundary. */
export interface EditorOperationAnchor {
  readonly codec: string;
  readonly payload: JsonValue;
  readonly association: -1 | 1;
}

/**
 * A backend-independent boundary established by an earlier replay step. It is
 * intentionally not an absolute offset: the boundary exists only after the
 * named block has been introduced by the preceding graph step.
 */
export interface EditorOperationBlockStartDependency {
  readonly kind: "block-start";
  readonly blockId: BlockId;
}

/** A boundary inside content produced by an earlier ordered replay step. */
export interface EditorOperationStepOutputDependency {
  readonly kind: "step-output";
  readonly stepIndex: number;
  readonly offset: number;
}

export type EditorOperationReplayBoundary =
  | EditorOperationAnchor
  | EditorOperationBlockStartDependency
  | EditorOperationStepOutputDependency;

export type EditorOperationAnchorRequirement =
  | {
      readonly kind: "position";
      readonly offset: number;
      readonly association: -1;
    }
  | {
      readonly kind: "range";
      readonly startOffset: number;
      readonly startAssociation: 1;
      readonly endOffset: number;
      readonly endAssociation: -1;
    };

export type EditorContentOperationReplayStep =
  | {
      readonly kind: "content";
      readonly blockId: BlockId;
      readonly blockType: BlockType;
      readonly operation: EditorInsertInlineContentOperation;
      readonly anchors: {
        readonly kind: "position";
        readonly position: EditorOperationReplayBoundary;
      };
    }
  | {
      readonly kind: "content";
      readonly blockId: BlockId;
      readonly blockType: BlockType;
      readonly operation:
        | EditorDeleteInlineRangeOperation
        | EditorReplaceInlineRangeOperation
        | EditorSetInlineEntityOperation
        | EditorInlineMarkRangeOperation;
      readonly anchors: {
        readonly kind: "range";
        readonly start: EditorOperationReplayBoundary;
        readonly end: EditorOperationReplayBoundary;
      };
    };

export interface EditorAnchorFreeOperationReplayStep<TOperation> {
  readonly kind: "anchor-free";
  readonly operation: TOperation;
}

/** Ordered leaf operations. Array order is replay execution order. */
export interface EditorOperationReplayPlan<TOperation = never> {
  readonly steps: readonly (
    | EditorContentOperationReplayStep
    | EditorAnchorFreeOperationReplayStep<TOperation>
  )[];
}

/**
 * Canonical operation-boundary policy. Associations describe operation
 * semantics, never caret affinity: insertions stay before later content,
 * while range anchors bind to the two outside edges.
 */
export function operationAnchorRequirement(
  operation: EditorLogicalContentOperation,
): EditorOperationAnchorRequirement {
  if (operation.kind === "insertInlineContent") {
    return {
      kind: "position",
      offset: operation.position.offset,
      association: -1,
    };
  }
  return {
    kind: "range",
    startOffset: operation.range.from.offset,
    startAssociation: 1,
    endOffset: operation.range.to.offset,
    endAssociation: -1,
  };
}
