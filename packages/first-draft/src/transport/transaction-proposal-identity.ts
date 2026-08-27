import { jsonValuesEqual } from "@repo/editor-core/kernel";
import type { EditorTransportTransaction } from "./transport-types.ts";

/**
 * Compares the stable semantic identity of a proposed transaction.
 * The read projection is excluded because persistence derives it canonically.
 */
export function firstDraftTransactionProposalsEqual(
  left: EditorTransportTransaction,
  right: EditorTransportTransaction,
): boolean {
  if (
    left.transactionId !== right.transactionId ||
    left.historyAction !== right.historyAction ||
    !jsonValuesEqual(left.graph, right.graph) ||
    !jsonValuesEqual(left.metadata, right.metadata) ||
    left.content.length !== right.content.length
  ) {
    return false;
  }
  return left.content.every((entry, index) => {
    const candidate = right.content[index];
    return Boolean(
      candidate &&
      entry.blockId === candidate.blockId &&
      entry.blockType === candidate.blockType &&
      entry.update.kind === candidate.update.kind &&
      entry.update.format === candidate.update.format &&
      entry.update.version === candidate.update.version &&
      entry.update.payload.equals(candidate.update.payload),
    );
  });
}
