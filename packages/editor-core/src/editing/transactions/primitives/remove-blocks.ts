import type { BlockId } from "../../../kernel/identity/ids.ts";
import type { StructuralTransactionOperation } from "../types.ts";

export function removeBlocks(input: {
  readonly blockIds: readonly BlockId[];
  readonly includeDescendants: boolean;
  readonly expectedParents?: Readonly<Partial<Record<BlockId, BlockId | null>>>;
}): StructuralTransactionOperation {
  return {
    kind: "removeBlocks",
    blockIds: [...input.blockIds],
    includeDescendants: input.includeDescendants,
    ...(input.expectedParents === undefined
      ? {}
      : { expectedParents: { ...input.expectedParents } }),
  };
}
