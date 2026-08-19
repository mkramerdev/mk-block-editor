import type { CanonicalBlockRecord } from "../../canonical-fragment.ts";
import type {
  BlockPlacement,
  StructuralTransactionOperation,
} from "../types.ts";

export function insertBlocks(input: {
  readonly placement: BlockPlacement;
  readonly blocks: readonly CanonicalBlockRecord[];
}): StructuralTransactionOperation {
  return {
    kind: "insertBlocks",
    placement: { ...input.placement },
    blocks: input.blocks.map((block) => ({ ...block })),
  };
}
