import type { CanonicalBlockRecord } from "../../canonical-fragment.ts";
import type { BlockPlacement, StructuralTransactionOperation } from "../types.ts";

export function insertBlocks(input: {
  readonly placement: BlockPlacement;
  readonly blocks: readonly CanonicalBlockRecord[];
}): StructuralTransactionOperation {
  return Object.freeze({
    kind: "insertBlocks",
    placement: Object.freeze({ ...input.placement }),
    blocks: Object.freeze(
      input.blocks.map((block) => Object.freeze({ ...block })),
    ),
  });
}
