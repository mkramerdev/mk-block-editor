import type {
  BlockPlacement,
  CanonicalBlockFragment,
} from "@repo/editor-core/editing";
import type { EditorTransactionResult } from "./mutation.ts";

export interface CanonicalInsertionTransactionPort {
  transaction(callback: () => unknown): EditorTransactionResult;
  insertBlocks(
    placement: BlockPlacement,
    fragment: CanonicalBlockFragment,
  ): unknown;
}

/**
 * Inserts already materialized canonical content through one ordinary editor
 * transaction. Callers must not invoke this while another transaction is
 * active; the editor rejects that programmer error.
 */
export function executeCanonicalBlockFragmentInsertion(
  editor: CanonicalInsertionTransactionPort,
  placement: BlockPlacement,
  fragment: CanonicalBlockFragment,
): EditorTransactionResult {
  return editor.transaction(() => {
    editor.insertBlocks(placement, fragment);
  });
}
