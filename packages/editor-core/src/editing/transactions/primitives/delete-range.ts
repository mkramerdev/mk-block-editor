import type {
  StructuralEditRange,
  StructuralTransactionOperation,
} from "../types.ts";

export function deleteRange(
  range: StructuralEditRange,
): StructuralTransactionOperation {
  return Object.freeze({
    kind: "deleteRange",
    range: Object.freeze({
      ...range,
      blocks: Object.freeze(
        range.blocks.map((block) => Object.freeze({ ...block })),
      ),
      start: Object.freeze({ ...range.start }),
      end: Object.freeze({ ...range.end }),
    }),
  });
}
