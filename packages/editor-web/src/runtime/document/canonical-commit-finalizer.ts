import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType } from "@repo/editor-core/document";
import type {
  CanonicalEditorCommit,
  EditorImplementation,
} from "@repo/editor-react/editor";
import type { EditorContentRuntime } from "@repo/editor-core/content";
import type { EditorTypingTriggerSessionController } from "../typing-triggers/session-controller.ts";
import type {
  EditorBlockGraphSemanticChange,
  EditorBlockMetadataSemanticChange,
  EditorChangeCallback,
  EditorSemanticChange,
} from "./contracts.ts";

export interface FinalizeCanonicalEditorCommitOptions {
  readonly editor: EditorImplementation;
  readonly contentRuntime: EditorContentRuntime;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly typingTriggerController: EditorTypingTriggerSessionController | null;
  readonly onChange?: EditorChangeCallback | null;
  readonly onChangeError?: ((error: Error) => void) | null;
}

/** Finalizes and publishes one web semantic transaction from one receipt. */
export function finalizeCanonicalEditorCommit(
  receipt: CanonicalEditorCommit,
  options: FinalizeCanonicalEditorCommitOptions,
): EditorSemanticChange | null {
  const { typingTriggerController } = options;
  if (receipt.historyAction === "undo" || receipt.historyAction === "redo") {
    typingTriggerController?.reconcileFinalizedHistoryMutation();
  } else {
    typingTriggerController?.reconcileFinalizedLocalMutation(
      receipt.provenance,
    );
  }

  let semanticChange: EditorSemanticChange;
  if (receipt.kind === "content") {
    semanticChange = {
      kind: "block-content",
      transactionId: receipt.transactionId,
      baseDocumentRevision: receipt.baseDocumentRevision,
      documentRevision: receipt.documentRevision,
      selectionBefore: receipt.selectionBefore,
      selectionAfter: receipt.selectionAfter,
      blockId: receipt.blockId,
      blockType: receipt.blockType,
      operations: receipt.operations,
      inverseOperations: receipt.inverseOperations,
      yjsUpdate: receipt.yjsUpdate,
      readProjection: options.contentRuntime.readBlockProjection(
        receipt.blockId,
        receipt.blockType,
      ),
      historyAction: receipt.historyAction,
    };
  } else if (receipt.kind === "block-metadata") {
    const canonicalOperation = receipt.operation;
    const changedBlockIds = uniqueBlockIds([
      ...canonicalOperation.updates.map((update) => update.blockId),
      ...(canonicalOperation.deletions ?? []).map(
        (deletion) => deletion.blockId,
      ),
    ]);
    semanticChange = {
      kind: "block-metadata",
      transactionId: receipt.transactionId,
      baseDocumentRevision: receipt.baseDocumentRevision,
      documentRevision: receipt.documentRevision,
      selectionBefore: receipt.selectionBefore,
      selectionAfter: receipt.selectionAfter,
      changedBlockIds,
      deletedBlockIds: [],
      historyAction: receipt.historyAction,
      change: {
        kind: "block-metadata",
        blockId:
          canonicalOperation.updates[0]?.blockId ??
          canonicalOperation.deletions?.[0]?.blockId ??
          changedBlockIds[0]!,
        update: canonicalOperation,
      },
      canonicalOperation,
    } satisfies EditorBlockMetadataSemanticChange;
  } else {
    const changedBlockIds = uniqueBlockIds([
      ...receipt.graphChanges.map((change) => change.blockId),
      ...(receipt.metadataOperation?.updates ?? []).map(
        (update) => update.blockId,
      ),
      ...(receipt.metadataOperation?.deletions ?? []).map(
        (deletion) => deletion.blockId,
      ),
    ]);
    const deletedBlockIds = receipt.graphChanges.flatMap((change) =>
      change.kind === "delete" ? [change.blockId] : [],
    );
    semanticChange = {
      kind: "block-graph",
      transactionId: receipt.transactionId,
      baseDocumentRevision: receipt.baseDocumentRevision,
      documentRevision: receipt.documentRevision,
      selectionBefore: receipt.selectionBefore,
      selectionAfter: receipt.selectionAfter,
      changedBlockIds,
      deletedBlockIds,
      historyAction: receipt.historyAction,
      change: {
        kind: "block-graph",
        blockId: changedBlockIds[0] ?? null,
        changes: receipt.graphChanges,
      },
      graphChanges: receipt.graphChanges,
      ...(receipt.metadataOperation === undefined
        ? {}
        : { metadataOperation: receipt.metadataOperation }),
      contentChanges: (receipt.contentCommit?.blocks ?? []).map((block) => ({
        kind: "block-content",
        blockId: block.blockId,
        blockType: block.blockType,
        operations: block.contentOperations,
        update: block.operationUpdate,
        readProjection: options.contentRuntime.readBlockProjection(
          block.blockId,
          block.blockType,
        ),
      })),
    } satisfies EditorBlockGraphSemanticChange;
  }

  publishEditorSemanticChange(
    options.onChange,
    options.onChangeError,
    semanticChange,
  );
  return semanticChange;
}

function publishEditorSemanticChange(
  onChange: EditorChangeCallback | null | undefined,
  onChangeError: ((error: Error) => void) | null | undefined,
  change: EditorSemanticChange,
): void {
  if (!onChange) return;
  try {
    const publication = onChange(change);
    if (publication instanceof Promise && onChangeError) {
      publication.catch((error: unknown) => onChangeError(asError(error)));
    }
  } catch (error) {
    if (!onChangeError) throw error;
    onChangeError(asError(error));
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function uniqueBlockIds<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}
