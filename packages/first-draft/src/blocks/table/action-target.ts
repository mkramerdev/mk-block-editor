import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditor } from "@repo/editor-web/editor";
import {
  readFirstDraftTableMutationStructure,
  resolveFirstDraftTableColumnTargetIndex,
  type FirstDraftTableColumnMutationTarget,
  type FirstDraftTableMutationStructure,
} from "./mutations.ts";
import { encodeTableRange, type TableRangeSelection } from "./selection.ts";

export type FirstDraftTableActionTarget =
  | {
      readonly kind: "row";
      readonly rowId: BlockId;
    }
  | {
      readonly kind: "column";
      readonly identity: FirstDraftTableColumnMutationTarget;
    };

export interface ResolvedFirstDraftTableActionTarget {
  readonly structure: FirstDraftTableMutationStructure;
  readonly targetIndex: number;
}

/** Strictly resolves a stable action target against one current rectangular table. */
export function resolveFirstDraftTableActionTarget(
  editor: EditableEditor,
  tableId: BlockId,
  target: FirstDraftTableActionTarget,
): ResolvedFirstDraftTableActionTarget {
  const structure = readFirstDraftTableMutationStructure(editor, tableId);
  const targetIndex =
    target.kind === "row"
      ? structure.rowIds.indexOf(target.rowId)
      : resolveFirstDraftTableColumnTargetIndex(structure, target.identity);
  if (targetIndex < 0) {
    throw new Error("cannot resolve a missing table action target");
  }
  return { structure, targetIndex };
}

/** Materializes the complete current axis as the canonical table range payload. */
export function materializeFirstDraftTableActionRange(
  target: FirstDraftTableActionTarget,
  resolution: ResolvedFirstDraftTableActionTarget,
): TableRangeSelection {
  const { structure, targetIndex } = resolution;
  if (target.kind === "row") {
    const cells = structure.cellIdsByRow[targetIndex];
    const firstCellId = cells?.[0];
    const lastCellId = cells?.at(-1);
    if (!firstCellId || !lastCellId) {
      throw new Error("cannot select an empty table row");
    }
    return encodeTableRange({
      anchor: { row: targetIndex, column: 0, cellId: firstCellId },
      head: {
        row: targetIndex,
        column: structure.columnCount - 1,
        cellId: lastCellId,
      },
    });
  }

  const firstCellId = structure.cellIdsByRow[0]?.[targetIndex];
  const lastRowIndex = structure.rowIds.length - 1;
  const lastCellId = structure.cellIdsByRow[lastRowIndex]?.[targetIndex];
  if (!firstCellId || !lastCellId) {
    throw new Error("cannot select an empty table column");
  }
  return encodeTableRange({
    anchor: { row: 0, column: targetIndex, cellId: firstCellId },
    head: { row: lastRowIndex, column: targetIndex, cellId: lastCellId },
  });
}

export function tableRangeSelectionsEqual(
  left: TableRangeSelection,
  right: TableRangeSelection,
): boolean {
  return (
    left.kind === right.kind &&
    left.anchorCellId === right.anchorCellId &&
    left.headCellId === right.headCellId
  );
}
