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
  return Object.freeze({
    kind: "moveBlocks",
    blockIds: Object.freeze([...input.blockIds]),
    sourcePlacement: Object.freeze({ ...input.sourcePlacement }),
    destinationPlacement: Object.freeze({ ...input.destinationPlacement }),
  });
}
