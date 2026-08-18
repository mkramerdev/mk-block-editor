import type { BlockId } from "../../../kernel/identity/ids.ts";
import type { StructuralTransactionOperation } from "../types.ts";

export function joinTextBlocks(
  leftBlockId: BlockId,
  rightBlockId: BlockId,
): StructuralTransactionOperation {
  return Object.freeze({
    kind: "joinTextBlocks",
    leftBlockId,
    rightBlockId,
  });
}
