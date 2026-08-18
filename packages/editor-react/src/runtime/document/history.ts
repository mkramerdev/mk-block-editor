import type {
  EditorLogicalBlockGraphOperation,
  EditorLogicalBlockMetadataOperation,
  EditorLogicalContentOperation,
} from "@repo/editor-core/operations";
import { cloneJsonValue } from "@repo/editor-core/kernel";
import type { BlockSelectionCoverageResult } from "@repo/editor-core/selection";
import type {
  BlockInternalSelectionSubsystem,
  EditorSelection,
} from "../../selection/model/types.ts";
import type { BlockId } from "@repo/editor-core/kernel";
import type { StructuralTransactionOperation } from "@repo/editor-core/editing";

/**
 * Canonical immutable operations replayed by both ordinary edits and history.
 * Atomic mixed graph/content edits use one block-graph transform whose
 * per-block logical operations retain execution order.
 */
export type EditorOperation =
  | EditorLogicalBlockGraphOperation
  | EditorLogicalBlockMetadataOperation
  | EditorLogicalContentOperation
  | EditorStructuralHistoryOperation
  | EditorCompositeOperation;

/** Incremental graph/content history for one finalized structural edit. */
export interface EditorStructuralHistoryOperation {
  readonly kind: "structuralTransaction";
  readonly origin: string;
  readonly graphOperations: readonly StructuralTransactionOperation[];
  readonly contentOperations: readonly EditorLogicalContentOperation[];
  readonly contentOrder: "before-graph" | "after-graph";
}

/**
 * An immutable ordered operation used when one user-visible edit consists of
 * multiple canonical editor operations. Steps execute in array order.
 */
export interface EditorCompositeOperation {
  readonly kind: "composite";
  readonly operations: readonly EditorOperation[];
}

export interface EditorHistoryEntry {
  readonly forward: EditorOperation;
  readonly inverse: EditorOperation;
  readonly selectionBefore: EditorHistorySelection;
  readonly selectionAfter: EditorHistorySelection;
}

export type EditorHistorySelection =
  | { readonly kind: "none" }
  | {
      readonly kind: "document";
      readonly selection: EditorSelection;
    }
  | {
      readonly kind: "block-internal";
      readonly blockId: BlockId;
      readonly subsystem: BlockInternalSelectionSubsystem;
      readonly coverageResult: BlockSelectionCoverageResult;
    };

export type EditorHistoryResult =
  | { readonly status: "applied" }
  | { readonly status: "history-empty" }
  | {
      readonly status: "execution-unavailable";
      readonly reason: "history-replay-in-progress";
    }
  | {
      readonly status: "operation-application-failed";
      readonly message: string;
    };

export const DEFAULT_MAXIMUM_HISTORY_ENTRIES = 100;

export function cloneAndFreezeHistoryEntry(
  entry: EditorHistoryEntry,
): EditorHistoryEntry {
  return Object.freeze({
    forward: freezeHistoryOperation(entry.forward),
    inverse: freezeHistoryOperation(entry.inverse),
    selectionBefore: entry.selectionBefore,
    selectionAfter: entry.selectionAfter,
  });
}

function freezeHistoryOperation(operation: EditorOperation): EditorOperation {
  return contentOnlyOperation(operation)
    ? deepFreeze(operation)
    : deepFreeze(cloneJsonValue(operation));
}

function contentOnlyOperation(operation: EditorOperation): boolean {
  if (operation.kind === "composite")
    return operation.operations.every(contentOnlyOperation);
  if (operation.kind === "structuralTransaction") return false;
  return (
    operation.kind === "insertInlineContent" ||
    operation.kind === "deleteInlineRange" ||
    operation.kind === "replaceInlineRange" ||
    operation.kind === "setInlineEntity" ||
    operation.kind === "addInlineMark" ||
    operation.kind === "removeInlineMark"
  );
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
