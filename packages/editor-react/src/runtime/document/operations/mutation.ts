import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorBlockContentOperationBatch } from "@repo/editor-core/operations";
import type { BlockSelectionCoverageResult } from "@repo/editor-core/selection";
import type { EditorCommandState } from "../state/command-state.ts";
import type { EditorBlockGraphOperation } from "./block-graph-operation.ts";
import type { EditorLogicalOperation } from "@repo/editor-core/operations";
import type { EditorDocumentUpdate } from "./document-update.ts";
import type {
  AppliedStructuralTransaction,
  StructuralTransactionResult,
} from "@repo/editor-core/editing";
import type {
  BlockInternalSelectionSubsystem,
  EditorSelection,
  EditorSelectionTextAffinity,
} from "../../../selection/model/types.ts";
import type { EditorHistorySelection } from "../history.ts";
import type { EditorLocalMutationProvenance } from "./local-mutation-provenance.ts";

export interface EditorContentOperationFailure {
  index: number;
  blockId: BlockId;
  reason: "invalid-operation" | "missing-content" | "mutation-failed";
  message?: string;
}

export interface EditorContentOperationApplyResult {
  ok: boolean;
  applied: number;
  failures: readonly EditorContentOperationFailure[];
}

export type EditorOperationFailureReason =
  | "no-change"
  | "invalid-operation"
  | "content-operations-rejected"
  | "durable-operation-rejected"
  | "runtime-disposed";

export interface EditorSelectionSuggestion {
  readonly blockId: BlockId;
  readonly offset?: number | null;
  readonly placement?: "start" | "end";
  readonly affinity?: EditorSelectionTextAffinity | null;
}

export interface EditorOperationSuggestion {
  readonly selection?: EditorSelectionSuggestion | null;
}

/** A general post-operation logical selection intent. */
export interface EditorSelectionEffect {
  readonly kind: "selection";
  readonly selection: EditorSelection;
}

/** A block-owned canonical selection intent validated by that block's model. */
export interface EditorBlockInternalSelectionEffect {
  readonly kind: "block-internal";
  readonly blockId: BlockId;
  readonly subsystem: BlockInternalSelectionSubsystem;
  readonly coverageResult: BlockSelectionCoverageResult;
}

/** A historical canonical point re-anchored against the replay result. */
export interface EditorHistorySelectionEffect {
  readonly kind: "history-selection";
  readonly selection: EditorHistorySelection;
}

export type EditorCanonicalSelectionEffect =
  | EditorSelectionEffect
  | EditorBlockInternalSelectionEffect
  | EditorHistorySelectionEffect
  | { readonly kind: "preserve" }
  | { readonly kind: "clear" };

export type EditorTransactionSelectionEffect =
  | EditorCanonicalSelectionEffect
  | {
      readonly kind: "text";
      readonly blockId: BlockId;
      readonly offset: number;
    }
  | {
      readonly kind: "block";
      readonly blockId: BlockId;
      readonly placement?: "start" | "end";
    };

export interface EditorOperationRequest {
  reason: "runtime-mutation";
  nextState: EditorCommandState;
  contentOperations: readonly EditorBlockContentOperationBatch[];
  /** Call-local block identities already proven affected by the command. */
  candidateBlockIds?: readonly BlockId[];
  targetBlockId?: BlockId | null;
  operationTargetId?: string;
  editorSuggestion?: EditorOperationSuggestion | null;
  /** Commit-time freshness checks used by atomic metadata undo/redo plans. */
  readonly expectedMetadataVersions?: Readonly<Record<BlockId, string>>;
  canonicalOperation?: EditorLogicalOperation;
  semanticOperation?: EditorLogicalOperation;
  origin?: "local-command" | "undo" | "redo";
  selectionEffect?: EditorCanonicalSelectionEffect;
  provenance: EditorLocalMutationProvenance | null;
}

export interface EditorOperationResult {
  ok: boolean;
  reason?: EditorOperationFailureReason;
  operation?: EditorBlockGraphOperation;
  contentResult?: EditorContentOperationApplyResult;
  update?: EditorDocumentUpdate;
}

export type EditorStructuralTransactionResult =
  | {
      readonly ok: true;
      readonly transaction: AppliedStructuralTransaction;
      readonly operationResult: EditorOperationResult;
    }
  | {
      readonly ok: false;
      readonly phase: "planning";
      readonly failure: Extract<StructuralTransactionResult, { ok: false }>;
    }
  | {
      readonly ok: false;
      readonly phase: "commit";
      readonly operationResult: EditorOperationResult;
    };

export type EditorTransactionFailurePhase =
  | "nested"
  | "mutation"
  | "validation"
  | "commit"
  | "callback"
  | "async-callback";

export type EditorTransactionResult =
  | {
      readonly ok: true;
      readonly changed: false;
    }
  | {
      readonly ok: true;
      readonly changed: true;
      readonly transaction: AppliedStructuralTransaction;
      readonly operationResult: EditorOperationResult;
    }
  | {
      readonly ok: false;
      readonly phase: EditorTransactionFailurePhase;
      readonly message: string;
      readonly failure?: Extract<StructuralTransactionResult, { ok: false }>;
      readonly operationResult?: EditorOperationResult;
      readonly cause?: unknown;
    };
