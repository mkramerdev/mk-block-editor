import type {
  StructuralTransactionOperation,
  TransactionBlockReplacement,
} from "../types.ts";

export interface ReplaceBlocksInput {
  readonly blocks: readonly TransactionBlockReplacement[];
}

export function replaceBlocks(
  input: ReplaceBlocksInput,
): Extract<StructuralTransactionOperation, { kind: "replaceBlocks" }> {
  return {
    kind: "replaceBlocks",
    blocks: input.blocks,
  };
}
