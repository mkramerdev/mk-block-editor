export interface SelectionPaintSegmentEdges {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

export interface SelectionPaintSegmentDataAttributes {
  readonly "data-editor-selection-paint-perimeter": "true";
  readonly "data-editor-selection-paint-edge-top": "true" | undefined;
  readonly "data-editor-selection-paint-edge-right": "true" | undefined;
  readonly "data-editor-selection-paint-edge-bottom": "true" | undefined;
  readonly "data-editor-selection-paint-edge-left": "true" | undefined;
}

export function createRectangularSelectionPaintSegments<
  RowId extends string,
  CellId extends string,
>(
  rowIds: readonly RowId[],
  cellIdsForRow: (rowId: RowId) => readonly CellId[],
  anchorCellId: CellId,
  headCellId: CellId,
): ReadonlyMap<CellId, SelectionPaintSegmentEdges> {
  const rows = rowIds.map((rowId) => cellIdsForRow(rowId));
  const locate = (cellId: CellId) => {
    for (let row = 0; row < rows.length; row += 1) {
      const column = rows[row]!.indexOf(cellId);
      if (column >= 0) return { row, column };
    }
    return null;
  };
  const anchor = locate(anchorCellId);
  const head = locate(headCellId);
  if (!anchor || !head) return new Map();

  const firstRow = Math.min(anchor.row, head.row);
  const lastRow = Math.max(anchor.row, head.row);
  const firstColumn = Math.min(anchor.column, head.column);
  const lastColumn = Math.max(anchor.column, head.column);
  const segments = new Map<CellId, SelectionPaintSegmentEdges>();
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const cellId = rows[row]?.[column];
      if (!cellId) continue;
      segments.set(cellId, {
        top: row === firstRow,
        right: column === lastColumn,
        bottom: row === lastRow,
        left: column === firstColumn,
      });
    }
  }
  return segments;
}

export function selectionPaintSegmentDataAttributes(
  edges: SelectionPaintSegmentEdges | null,
): SelectionPaintSegmentDataAttributes {
  return {
    "data-editor-selection-paint-perimeter": "true",
    "data-editor-selection-paint-edge-top": edges?.top ? "true" : undefined,
    "data-editor-selection-paint-edge-right": edges?.right ? "true" : undefined,
    "data-editor-selection-paint-edge-bottom": edges?.bottom
      ? "true"
      : undefined,
    "data-editor-selection-paint-edge-left": edges?.left ? "true" : undefined,
  };
}
