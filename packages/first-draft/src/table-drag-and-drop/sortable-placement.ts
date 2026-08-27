import type { BlockId } from "@repo/editor-core/kernel";
import type { SortableDropPlacement } from "@mk-drag-and-drop/react";

export type SortablePlacementProjectionResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly order: readonly BlockId[];
    }
  | { readonly ok: false; readonly reason: string };

export type SortableRecordPlacementProjectionResult<RecordType> =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly order: readonly RecordType[];
    }
  | { readonly ok: false; readonly reason: string };

export function projectSortableBlockOrder(
  canonicalOrder: readonly BlockId[],
  sourceId: BlockId,
  containerId: string,
  placement: SortableDropPlacement,
): SortablePlacementProjectionResult {
  return projectSortableRecordOrder(
    canonicalOrder,
    sourceId,
    containerId,
    placement,
    (blockId) => blockId,
  );
}

export function projectSortableRecordOrder<RecordType>(
  canonicalOrder: readonly RecordType[],
  sourceId: string,
  containerId: string,
  placement: SortableDropPlacement,
  getDragId: (record: RecordType) => string,
): SortableRecordPlacementProjectionResult<RecordType> {
  if (
    placement.sourceContainerId !== containerId ||
    placement.containerId !== containerId
  ) {
    return invalid("sortable placement belongs to another container");
  }
  const canonicalIds = canonicalOrder.map(getDragId);
  if (canonicalIds.filter((id) => id === sourceId).length !== 1) {
    return invalid("sortable source is missing or duplicated");
  }
  if (new Set(canonicalIds).size !== canonicalIds.length) {
    return invalid("canonical sortable order contains duplicate ids");
  }

  const remaining = canonicalOrder.filter(
    (record) => getDragId(record) !== sourceId,
  );
  const remainingIds = remaining.map(getDragId);
  const previousIndex = anchorIndex(
    remainingIds,
    placement.previousDraggableId,
    "previous",
  );
  if (typeof previousIndex === "string") return invalid(previousIndex);
  const nextIndex = anchorIndex(
    remainingIds,
    placement.nextDraggableId,
    "next",
  );
  if (typeof nextIndex === "string") return invalid(nextIndex);
  if (
    previousIndex !== null &&
    nextIndex !== null &&
    previousIndex + 1 !== nextIndex
  ) {
    return invalid("sortable anchors do not describe one insertion gap");
  }

  const anchorGap =
    previousIndex !== null
      ? previousIndex + 1
      : nextIndex !== null
        ? nextIndex
        : remaining.length === 0
          ? 0
          : null;

  let targetGap: number | null = null;
  if (placement.targetDraggableId !== null) {
    if (placement.side === null) {
      return invalid("sortable target is missing its side");
    }
    const targetIndex = remainingIds.indexOf(placement.targetDraggableId);
    if (targetIndex < 0) return invalid("sortable target is missing");
    targetGap = targetIndex + (placement.side === "after" ? 1 : 0);
  } else if (placement.side !== null) {
    return invalid("sortable side was supplied without a target");
  }

  if (targetGap !== null && anchorGap !== null && targetGap !== anchorGap) {
    return invalid("sortable target and anchors disagree");
  }
  const insertionIndex = targetGap ?? anchorGap;
  if (insertionIndex === null) {
    return invalid("sortable placement has no resolvable destination");
  }
  const order = [...remaining];
  order.splice(
    insertionIndex,
    0,
    canonicalOrder[canonicalIds.indexOf(sourceId)]!,
  );
  const changed = !sameRecordOrder(order, canonicalOrder, getDragId);
  return { ok: true, changed, order: changed ? order : canonicalOrder };
}

function anchorIndex(
  order: readonly string[],
  anchor: string | null,
  name: "previous" | "next",
): number | null | string {
  if (anchor === null) return null;
  const index = order.indexOf(anchor);
  return index < 0 ? `sortable ${name} anchor is missing` : index;
}

function sameRecordOrder<RecordType>(
  left: readonly RecordType[],
  right: readonly RecordType[],
  getDragId: (record: RecordType) => string,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (record, index) => getDragId(record) === getDragId(right[index]!),
    )
  );
}

function invalid(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}
