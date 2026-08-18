import type { BlockSelectionFragmentDescriptor } from "@repo/editor-core/selection";
import type { EditorSelectionSnapshot } from "../model/types.ts";
import { isEditorSelectionSnapshotSemanticallyEmpty } from "../normalization/range-emptiness.ts";

export type EditorSelectionCommandIneligibleReason =
  | "not-committed"
  | "invalidated"
  | "missing-boundary"
  | "empty-range"
  | "invalid-text-boundary";

export type EditorSelectionCommandEligibility =
  | {
      readonly eligible: true;
      readonly snapshot: EditorSelectionSnapshot & { phase: "committed" };
    }
  | {
      readonly eligible: false;
      readonly reason: EditorSelectionCommandIneligibleReason;
    };

export function getEditorSelectionCommandEligibility(
  snapshot: EditorSelectionSnapshot,
): EditorSelectionCommandEligibility {
  if (snapshot.lastInvalidationReason)
    return { eligible: false, reason: "invalidated" };
  if (snapshot.phase !== "committed")
    return { eligible: false, reason: "not-committed" };
  if (
    !snapshot.normalizedStart ||
    !snapshot.normalizedEnd ||
    !snapshot.direction
  )
    return { eligible: false, reason: "missing-boundary" };
  if (isEditorSelectionSnapshotSemanticallyEmpty(snapshot))
    return { eligible: false, reason: "empty-range" };
  if (!snapshotHasValidTextBoundaryBlocks(snapshot))
    return { eligible: false, reason: "invalid-text-boundary" };
  if (snapshot.rangeBlocks.every((block) => block.coverage === "none"))
    return { eligible: false, reason: "empty-range" };
  return {
    eligible: true,
    snapshot: snapshot as EditorSelectionSnapshot & { phase: "committed" },
  };
}

function snapshotHasValidTextBoundaryBlocks(
  snapshot: EditorSelectionSnapshot,
): boolean {
  return snapshot.rangeBlocks.every((rangeBlock) => {
    if (
      fragmentDescriptor(rangeBlock.coverageResult.fragment)?.kind !==
        "content" ||
      rangeBlock.coverage === "complete-content"
    )
      return true;
    if (
      rangeBlock.blockId === snapshot.normalizedStart?.blockId &&
      rangeBlock.startOffset === undefined
    )
      return false;
    if (
      rangeBlock.blockId === snapshot.normalizedEnd?.blockId &&
      rangeBlock.endOffset === undefined
    )
      return false;
    return true;
  });
}

function fragmentDescriptor(
  value: unknown,
): BlockSelectionFragmentDescriptor | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  return value.kind === "content" ||
    value.kind === "wrapper" ||
    value.kind === "block" ||
    value.kind === "custom"
    ? (value as unknown as BlockSelectionFragmentDescriptor)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
