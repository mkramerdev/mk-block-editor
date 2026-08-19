import type { BlockId } from "../../../kernel/identity/ids.ts";
import type {
  BlockPlacement,
  StructuralTransactionOperation,
} from "../types.ts";

export function moveBlocks(input: {
  readonly blockIds: readonly BlockId[];
  readonly sourcePlacement: BlockPlacement;
  readonly destinationPlacement: BlockPlacement;
}): StructuralTransactionOperation {
  return {
    kind: "moveBlocks",
    blockIds: [...input.blockIds],
    sourcePlacement: { ...input.sourcePlacement },
    destinationPlacement: { ...input.destinationPlacement },
  };
}
