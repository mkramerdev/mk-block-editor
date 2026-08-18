import type { Block, BlockType } from "@repo/editor-core/document";
import type {
  BlockSelectionCoverage,
  BlockSelectionCoverageResult,
  BlockSelectionModel,
  BlockSelectionProjectionCategory,
} from "@repo/editor-core/selection";
import type { BlockId } from "@repo/editor-core/kernel";
import type { JsonValue } from "@repo/editor-core/kernel";
import type { CanonicalLocalSelection } from "./canonical-selection.ts";

export type EditorSelectionPhase = "idle" | "dragging" | "committed";

export type EditorSelectionDirection = "forward" | "backward";

export type EditorSelectionRangeCoverage = BlockSelectionCoverage;

export type EditorSelectionTextAffinity = "forward" | "backward";

/**
 * A logical selection intent. It contains no graph revision, derived range
 * projection, DOM node, or browser focus state.
 */
export interface EditorSelection {
  readonly direction: EditorSelectionDirection;
  readonly anchor: EditorLogicalSelectionPoint;
  readonly focus: EditorLogicalSelectionPoint;
}

declare const internalSelectionSubsystemBrand: unique symbol;

export type RegisteredInternalSelectionSubsystemId = string & {
  readonly [internalSelectionSubsystemBrand]: "RegisteredInternalSelectionSubsystemId";
};

export interface RegisteredInternalSelectionSubsystem {
  readonly kind: "registered";
  readonly id: RegisteredInternalSelectionSubsystemId;
}

export type BlockInternalSelectionSubsystem =
  RegisteredInternalSelectionSubsystem;

export type SelectionBlockOwner =
  | { readonly kind: "document" }
  | {
      readonly kind: "block-internal";
      readonly blockId: BlockId;
      readonly subsystem: BlockInternalSelectionSubsystem;
    };

export function blockInternalSelectionSubsystemId(
  subsystem: BlockInternalSelectionSubsystem,
): string {
  return subsystem.id;
}

export type EditorSelectionInvalidationReason =
  | "block-deleted"
  | "block-moved"
  | "remote-collaboration"
  | "stale-graph"
  | "graph-changed";

export interface EditorSelectionTextAnchorPayload {
  encoded: string;
  assoc?: -1 | 0 | 1;
}

export interface EditorSelectionEncodedTextAnchor {
  kind: "block-relative-text";
  /** Opaque transport-safe codec identifier owned by the content runtime. */
  codec: string;
  version: 1;
  payload: EditorSelectionTextAnchorPayload;
}

export type EditorSelectionTextAnchor = EditorSelectionEncodedTextAnchor;

export type StableDocumentSelectionPoint =
  | {
      readonly kind: "text";
      readonly blockId: BlockId;
      /** Projection-relative fallback used without hydrating inactive content. */
      readonly textOffset: number;
      readonly textAnchor: EditorSelectionTextAnchor;
      readonly affinity: EditorSelectionTextAffinity | null;
    }
  | {
      readonly kind: "block";
      readonly blockId: BlockId;
      readonly surface: "block";
    };

export interface StableDocumentSelection {
  readonly kind: "document";
  readonly direction: EditorSelectionDirection;
  readonly anchor: StableDocumentSelectionPoint;
  readonly focus: StableDocumentSelectionPoint;
}

export interface StableBlockInternalSelection {
  readonly kind: "block-internal";
  readonly blockId: BlockId;
  readonly subsystem: string;
  readonly payload: JsonValue;
}

export type StableEditorSelection =
  | StableDocumentSelection
  | StableBlockInternalSelection;

export type EditorStableSelection =
  | {
      readonly kind: "selection";
      readonly selection: StableEditorSelection;
    }
  | { readonly kind: "none" };

export type TransactionDocumentSelectionPoint =
  | Extract<StableDocumentSelectionPoint, { readonly kind: "text" }>
  | Extract<StableDocumentSelectionPoint, { readonly kind: "block" }>;

export interface TransactionDocumentSelection {
  readonly kind: "document";
  readonly direction: EditorSelectionDirection;
  readonly anchor: TransactionDocumentSelectionPoint;
  readonly focus: TransactionDocumentSelectionPoint;
}

export type TransactionStableEditorSelection =
  | TransactionDocumentSelection
  | StableBlockInternalSelection;

export type EditorTransactionSelection =
  | {
      readonly kind: "selection";
      readonly selection: TransactionStableEditorSelection;
    }
  | { readonly kind: "none" };

export type SelectionPublication =
  | {
      readonly kind: "transaction";
      readonly transactionId: string;
    }
  | { readonly kind: "standalone-local" }
  | { readonly kind: "silent" };

export type SelectionCause =
  | "native-edit"
  | "programmatic-edit"
  | "undo"
  | "redo"
  | "pointer"
  | "keyboard"
  | "focus"
  | "remote-transaction"
  | "canonical-rebase"
  | "snapshot-recovery";

export interface SelectionSettlementContext {
  readonly publication: SelectionPublication;
  readonly cause: SelectionCause;
}

export type CanonicalSelectionSettlementResult =
  | {
      readonly kind: "changed";
      readonly selection: EditorSelectionSnapshot | null;
    }
  | {
      readonly kind: "unchanged";
      readonly retainedSelection: CanonicalLocalSelection;
    }
  | {
      readonly kind: "rejected";
      readonly retainedSelection: CanonicalLocalSelection;
    };

export type EditorSelectionFailureReason =
  | "invalid"
  | "unsupported-block-type"
  | "missing-block"
  | "missing-text"
  | "hidden-block"
  | "deleted-block"
  | "permission-hidden-block"
  | "stale-graph";

export interface EditorSelectionFailure {
  ok: false;
  reason: EditorSelectionFailureReason;
  blockId?: BlockId;
  message?: string;
}

export interface EditorLogicalSelectionPoint {
  blockId: BlockId;
  blockType: BlockType;
  blockCategory: BlockSelectionProjectionCategory;
  textOffset: number;
  textAnchor: EditorSelectionTextAnchor | null;
  affinity: EditorSelectionTextAffinity | null;
}

export interface EditorSelectionRangeBlock {
  blockId: BlockId;
  blockType: BlockType;
  category: BlockSelectionProjectionCategory;
  coverage: EditorSelectionRangeCoverage;
  coverageResult: BlockSelectionCoverageResult;
  selectable: boolean;
  startOffset?: number;
  endOffset?: number;
  startTextAnchor?: EditorSelectionTextAnchor;
  endTextAnchor?: EditorSelectionTextAnchor;
  /** Present on normalized and committed local blocks. */
  readonly owner?: SelectionBlockOwner;
}

export interface EditorSelectionSnapshot {
  /** Canonical revision for projections of a committed snapshot. */
  readonly sourceSelectionRevision?: number;
  phase: EditorSelectionPhase;
  selectionRevision: number;
  graphRevision: number;
  lastInvalidationReason: EditorSelectionInvalidationReason | null;
  direction: EditorSelectionDirection | null;
  anchor: EditorLogicalSelectionPoint | null;
  focus: EditorLogicalSelectionPoint | null;
  normalizedStart: EditorLogicalSelectionPoint | null;
  normalizedEnd: EditorLogicalSelectionPoint | null;
  rangeBlocks: readonly EditorSelectionRangeBlock[];
}

export interface EditorSelectionSnapshotEndpoint {
  getSnapshot(): EditorSelectionSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeBlock(blockId: BlockId, listener: () => void): () => void;
}

export interface EditorSelectionEndpointTarget {
  readonly block: Block;
  selection: BlockSelectionModel;
  category?: BlockSelectionProjectionCategory;
}

export interface EditorSelectionInvalidation {
  reason: EditorSelectionInvalidationReason;
  graphRevision?: number;
}

export interface EditorSelectionDragDiagnosticPayload {
  selectionRevision: number;
  graphRevision: number;
  direction: EditorSelectionDirection;
  start: EditorSelectionEndpointPayload;
  end: EditorSelectionEndpointPayload;
  blocks: readonly EditorSelectionRangeBlock[];
}

export interface EditorSelectionEndpointPayload {
  blockId: BlockId;
  blockType: BlockType;
  category: BlockSelectionProjectionCategory;
  offset: number;
  textAnchor: EditorSelectionTextAnchor | null;
}

export interface EditorSelectionTextAnchorResolutionSuccess {
  ok: true;
  blockId: BlockId;
  textAnchor: EditorSelectionTextAnchor;
  textOffset: number;
  affinity: EditorSelectionTextAffinity | null;
}

export type EditorSelectionTextAnchorResolutionResult =
  | EditorSelectionTextAnchorResolutionSuccess
  | EditorSelectionFailure;

export interface EditorSelectionTextAnchorResolver {
  resolveTextAnchor(
    point: EditorLogicalSelectionPoint,
  ): EditorSelectionTextAnchorResolutionResult;
}
