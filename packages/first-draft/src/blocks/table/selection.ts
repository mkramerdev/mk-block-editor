import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";
import type {
  BlockSelectionCoverageResult,
  BlockSelectionModel,
} from "@repo/editor-core/selection";
import type { BlockId, JsonObject } from "@repo/editor-core/kernel";
import {
  blockInternalSelectionSubsystemId,
  createRectangularSelectionPaintSegments,
  registerInternalSelectionSubsystem,
  type CanonicalLocalSelection,
  type SelectionPaintSegmentEdges,
} from "@repo/editor-web/block-renderer";
import type { EditorBlockInternalSelectionSubsystemDefinition } from "@repo/editor-web/document-runtime";

export const TABLE_INTERNAL_SELECTION_SUBSYSTEM_ID = "table.cell-range";
const registeredTableInternalSelectionSubsystem =
  registerInternalSelectionSubsystem(TABLE_INTERNAL_SELECTION_SUBSYSTEM_ID);

if (!registeredTableInternalSelectionSubsystem) {
  throw new Error("Table internal selection subsystem registration failed.");
}

export const tableInternalSelectionSubsystem =
  registeredTableInternalSelectionSubsystem;

export interface TableCellPoint {
  readonly row: number;
  readonly column: number;
  readonly cellId: BlockId;
}

export interface TableRange {
  readonly anchor: TableCellPoint;
  readonly head: TableCellPoint;
}

export type TableRangeSelection = JsonObject & {
  readonly kind: "cell-range";
  readonly anchorCellId: BlockId;
  readonly headCellId: BlockId;
};

export interface TableSelectionValue {
  readonly selectedIds: ReadonlySet<BlockId>;
  readonly paintSegments: ReadonlyMap<BlockId, SelectionPaintSegmentEdges>;
  readonly remoteSegments: ReadonlyMap<
    BlockId,
    readonly RemoteTableSelectionSegment[]
  >;
}

export interface RemoteTableSelectionSegment {
  readonly subject: string;
  readonly color: string | null;
  readonly edges: SelectionPaintSegmentEdges;
}

const Context = createContext<TableSelectionValue>({
  selectedIds: new Set(),
  paintSegments: new Map(),
  remoteSegments: new Map(),
});

export function TableSelectionProvider({
  value,
  children,
}: {
  readonly value: TableSelectionValue;
  readonly children: ReactNode;
}) {
  return createElement(Context.Provider, { value }, children);
}

export function useTableSelectionState() {
  return useContext(Context);
}

export function tableRangeSelectionModel(): BlockSelectionModel {
  return {
    id: TABLE_INTERNAL_SELECTION_SUBSYSTEM_ID,
    coverage: {
      selected: "complete-block",
      range: ["none", "partial", "complete-content", "complete-block"],
    },
    projection: {
      category: "object",
      endpoint: { kind: "block" },
      canStartSelection: false,
      selectable: true,
    },
    paint: {
      kind: "block-surface",
      target: "table-grid",
      coverage: ["complete-content", "complete-block"],
    },
    fragment: { kind: "custom" },
    edit: { kind: "custom" },
    delete: { kind: "custom" },
    cut: { kind: "custom" },
    move: { kind: "custom" },
  };
}

export const tableInternalSelectionDefinition: EditorBlockInternalSelectionSubsystemDefinition =
  {
    id: TABLE_INTERNAL_SELECTION_SUBSYSTEM_ID,
    validate({ blockId, block, payload, graph, mode }) {
      const selection = decodeTableRangeSelection(payload);
      const range = selection
        ? resolveTableRange(graph, blockId, selection)
        : null;
      if (!selection || !range) return { ok: false };
      return {
        ok: true,
        payload: selection,
        resolution: "resolved",
        ...(mode === "local-rebase"
          ? {
              localCoverage: createTableRangeCoverage(
                blockId,
                block.type,
                selection,
                graph,
                range,
              ),
            }
          : {}),
      };
    },
    resolveFocusTarget({ blockId, payload }) {
      return decodeTableRangeSelection(payload)
        ? { kind: "block", blockId, target: "table-grid" }
        : null;
    },
    resolveDecorationTarget({ blockId, payload, graph }) {
      const selection = decodeTableRangeSelection(payload);
      const range = selection
        ? resolveTableRange(graph, blockId, selection)
        : null;
      const cellId = range ? visualTopLeftCellId(graph, blockId, range) : null;
      return cellId ? { kind: "block", blockId: cellId, target: null } : null;
    },
  };

export function readTableRangeSelection(
  canonical: CanonicalLocalSelection,
  tableId: BlockId,
  graph: TableGraph,
): TableRange | null {
  if (
    canonical.kind !== "block-internal" ||
    canonical.snapshot.internal?.blockId !== tableId ||
    blockInternalSelectionSubsystemId(canonical.snapshot.internal.subsystem) !==
      TABLE_INTERNAL_SELECTION_SUBSYSTEM_ID
  ) {
    return null;
  }
  const selection = decodeTableRangeSelection(
    canonical.snapshot.internal.snapshot,
  );
  return selection ? resolveTableRange(graph, tableId, selection) : null;
}

export function createTableRangeCoverage(
  tableId: BlockId,
  blockType: string,
  selection: TableRangeSelection,
  graph: TableGraph,
  resolved = resolveTableRange(graph, tableId, selection),
): BlockSelectionCoverageResult {
  const rowIds = graph.getChildBlockIds(tableId);
  const columns = rowIds[0] ? graph.getChildBlockIds(rowIds[0]).length : 0;
  const complete = Boolean(
    resolved &&
      Math.min(resolved.anchor.row, resolved.head.row) === 0 &&
      Math.max(resolved.anchor.row, resolved.head.row) === rowIds.length - 1 &&
      Math.min(resolved.anchor.column, resolved.head.column) === 0 &&
      Math.max(resolved.anchor.column, resolved.head.column) === columns - 1,
  );
  return {
    blockId: tableId,
    blockType,
    modelId: TABLE_INTERNAL_SELECTION_SUBSYSTEM_ID,
    coverage: complete ? "complete-content" : "partial",
    internal: selection,
    stableSelectionPayload: selection,
    fragment: { kind: "custom" },
    edit: { kind: "custom" },
    delete: { kind: "custom" },
    cut: { kind: "custom" },
    move: { kind: "custom" },
  };
}

export function encodeTableRange(range: TableRange): TableRangeSelection {
  return {
    kind: "cell-range",
    anchorCellId: range.anchor.cellId,
    headCellId: range.head.cellId,
  };
}

export function rangeIds(
  graph: TableGraph,
  tableId: BlockId,
  range: TableRange | null,
): ReadonlySet<BlockId> {
  return new Set(rangeSelectionPaintSegments(graph, tableId, range).keys());
}

export function rangeSelectionPaintSegments(
  graph: TableGraph,
  tableId: BlockId,
  range: TableRange | null,
): ReadonlyMap<BlockId, SelectionPaintSegmentEdges> {
  if (!range) return new Map();
  const rowIds = graph.getChildBlockIds(tableId);
  return createRectangularSelectionPaintSegments(
    rowIds,
    (rowId) => graph.getChildBlockIds(rowId),
    range.anchor.cellId,
    range.head.cellId,
  );
}

export function visualTopLeftCellId(
  graph: TableGraph,
  tableId: BlockId,
  range: TableRange,
): BlockId | null {
  const rowId =
    graph.getChildBlockIds(tableId)[Math.min(range.anchor.row, range.head.row)];
  return rowId
    ? (graph.getChildBlockIds(rowId)[
        Math.min(range.anchor.column, range.head.column)
      ] ?? null)
    : null;
}

interface TableGraph {
  getParentId(blockId: BlockId): BlockId | null;
  getChildBlockIds(parentId: BlockId): readonly BlockId[];
}

export function decodeTableRangeSelection(
  value: unknown,
): TableRangeSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return record.kind === "cell-range" &&
    typeof record.anchorCellId === "string" &&
    typeof record.headCellId === "string"
    ? {
        kind: "cell-range",
        anchorCellId: record.anchorCellId as BlockId,
        headCellId: record.headCellId as BlockId,
      }
    : null;
}

export function resolveTableRange(
  graph: TableGraph,
  tableId: BlockId,
  selection: TableRangeSelection,
): TableRange | null {
  const point = (cellId: BlockId): TableCellPoint | null => {
    const rowId = graph.getParentId(cellId);
    if (!rowId || graph.getParentId(rowId) !== tableId) return null;
    const row = graph.getChildBlockIds(tableId).indexOf(rowId);
    const column = graph.getChildBlockIds(rowId).indexOf(cellId);
    return row >= 0 && column >= 0 ? { row, column, cellId } : null;
  };
  const anchor = point(selection.anchorCellId);
  const head = point(selection.headCellId);
  return anchor && head ? { anchor, head } : null;
}
