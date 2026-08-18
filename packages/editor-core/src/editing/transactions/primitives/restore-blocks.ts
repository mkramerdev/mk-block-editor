import type {
  StructuralTransactionOperation,
  TransactionRestoredBlockRecord,
} from "../types.ts";

export interface RestoreBlocksInput {
  readonly blocks: readonly TransactionRestoredBlockRecord[];
}

export function restoreBlocks(
  input: RestoreBlocksInput,
): Extract<StructuralTransactionOperation, { kind: "restoreBlocks" }> {
  return {
    kind: "restoreBlocks",
    blocks: input.blocks,
  };
}
