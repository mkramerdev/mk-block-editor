import type {
  StructuralEditRange,
  StructuralTransactionOperation,
} from "../types.ts";

export function deleteRange(
  range: StructuralEditRange,
): StructuralTransactionOperation {
  return {
    kind: "deleteRange",
    range: {
      ...range,
      blocks: range.blocks.map((block) => ({ ...block })),
      start: { ...range.start },
      end: { ...range.end },
    },
  };
}
