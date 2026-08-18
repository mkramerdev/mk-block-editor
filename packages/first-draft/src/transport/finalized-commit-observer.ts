import type { EditorSemanticChange } from "@repo/editor-web/editor";

export type FirstDraftFinalizedCommitObserver = "transaction" | "selection";

/**
 * Observes an already-finalized local edit in wire order. Each observer gets
 * one independent attempt; neither can undo or suppress the other.
 */
export function createFirstDraftFinalizedCommitObserver(options: {
  readonly publishTransaction: (change: EditorSemanticChange) => void;
  readonly publishSelection: (
    selection: EditorSemanticChange["selectionAfter"],
    transactionId: string,
  ) => void;
  readonly onObserverError?: (
    error: Error,
    observer: FirstDraftFinalizedCommitObserver,
  ) => void;
}): (change: EditorSemanticChange) => void {
  return (change) => {
    const failures: {
      readonly error: Error;
      readonly observer: FirstDraftFinalizedCommitObserver;
    }[] = [];
    try {
      options.publishTransaction(change);
    } catch (error) {
      failures.push({ error: toError(error), observer: "transaction" });
    }
    try {
      options.publishSelection(change.selectionAfter, change.transactionId);
    } catch (error) {
      failures.push({ error: toError(error), observer: "selection" });
    }
    for (const failure of failures) {
      options.onObserverError?.(failure.error, failure.observer);
    }
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
