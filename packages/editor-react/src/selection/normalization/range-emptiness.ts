import type { EditorSelectionSnapshot } from "../model/types.ts";

export function isEditorSelectionSnapshotSemanticallyEmpty(
  snapshot: EditorSelectionSnapshot,
): boolean {
  if (snapshot.rangeBlocks.length === 0) return true;
  return !snapshot.rangeBlocks.some((rangeBlock) => {
    if (rangeBlock.coverage === "none") return false;
    if (
      rangeBlock.coverage === "complete-block" ||
      rangeBlock.coverage === "complete-content"
    )
      return true;
    if (
      rangeBlock.startOffset !== undefined &&
      rangeBlock.endOffset !== undefined
    ) {
      return rangeBlock.startOffset !== rangeBlock.endOffset;
    }
    return (
      hasSelectionEditDescriptor(rangeBlock.coverageResult.edit) ||
      hasSelectionEditDescriptor(rangeBlock.coverageResult.delete) ||
      hasSelectionEditDescriptor(rangeBlock.coverageResult.cut)
    );
  });
}

function hasSelectionEditDescriptor(value: unknown): boolean {
  return value !== null && typeof value === "object" && "kind" in value;
}
