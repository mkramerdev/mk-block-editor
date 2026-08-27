import type { BlockId } from "@repo/editor-core/kernel";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { PointerEventHandler } from "react";
import type {
  DragEndResult,
  DragRect,
  SortableDropPlacement,
  SortablePreview,
} from "@mk-drag-and-drop/react";
import type { EditorChildOrderProjection } from "@repo/editor-web/document-runtime";
import type { FirstDraftTableColumnMutationTarget } from "../blocks/table/mutations.ts";

export const TABLE_ROW_DND_GROUP = "first-draft-table-rows";
export const TABLE_COLUMN_DND_GROUP = "first-draft-table-columns";

export interface TableColumnDragItem {
  readonly dragId: string;
  readonly presentationId: string;
  readonly target: FirstDraftTableColumnMutationTarget;
}

export interface FirstDraftTableCanonicalDragStructure {
  readonly rowIds: readonly BlockId[];
  readonly cellIdsByRow: readonly (readonly BlockId[])[];
  readonly presentationColumnIds: readonly string[];
  readonly columnIdentityKind: "canonical" | "synthetic-presentation";
}

export type FirstDraftTableDragPreviewCellBlock = VersionedBlock & {
  readonly type: "tableCell";
};

export interface FirstDraftTableDragPreviewCell {
  readonly block: FirstDraftTableDragPreviewCellBlock;
  readonly content: RichTextDocumentNodeJson;
}

export interface FirstDraftTableRowDragPreview {
  readonly axis: "row";
  readonly tracks: string;
  readonly cells: readonly FirstDraftTableDragPreviewCell[];
}

export interface FirstDraftTableColumnDragPreview {
  readonly axis: "column";
  readonly columnWidth: number;
  readonly rowHeights: readonly number[];
  readonly cells: readonly FirstDraftTableDragPreviewCell[];
}

export interface FirstDraftTableDragRegistration {
  readonly tableId: BlockId;
  readonly rowContainerId: string;
  readonly columnContainerId: string;
  readonly columnItems: readonly TableColumnDragItem[];
  getHorizontalScrollElement(): HTMLElement | null;
  readCanonicalStructure(): FirstDraftTableCanonicalDragStructure;
  captureRowDragPreview(
    rowId: BlockId,
    structure: FirstDraftTableCanonicalDragStructure,
  ): FirstDraftTableRowDragPreview | null;
  captureColumnDragPreview(
    item: TableColumnDragItem,
    structure: FirstDraftTableCanonicalDragStructure,
  ): FirstDraftTableColumnDragPreview | null;
  subscribeCanonicalStructure(listener: () => void): () => void;
}

interface FirstDraftTableDragSessionBase {
  readonly status: "dragging" | "awaiting-drop" | "awaiting-commit";
  readonly tableId: BlockId;
  readonly sourceRect: DragRect;
  readonly valid: boolean;
}

export interface FirstDraftTableRowDragSession
  extends FirstDraftTableDragSessionBase {
  readonly axis: "row";
  readonly sourceRowId: BlockId;
  readonly rowContainerId: string;
  readonly canonicalRowIds: readonly BlockId[];
  readonly projectedRowIds: readonly BlockId[];
  readonly expectedFinalRowIds: readonly BlockId[] | null;
  readonly preview: FirstDraftTableRowDragPreview;
}

export interface FirstDraftTableColumnDragSession
  extends FirstDraftTableDragSessionBase {
  readonly axis: "column";
  readonly sourceDragId: string;
  readonly sourceTarget: FirstDraftTableColumnMutationTarget;
  readonly columnContainerId: string;
  readonly canonicalItems: readonly TableColumnDragItem[];
  readonly projectedItems: readonly TableColumnDragItem[];
  readonly canonicalRowIds: readonly BlockId[];
  readonly canonicalCellIdsByRow: readonly (readonly BlockId[])[];
  readonly expectedColumnIds: readonly string[] | null;
  readonly expectedCellIdsByRow: readonly (readonly BlockId[])[] | null;
  readonly preview: FirstDraftTableColumnDragPreview;
}

export type FirstDraftTableDragSession =
  | FirstDraftTableRowDragSession
  | FirstDraftTableColumnDragSession;

export interface FirstDraftTableDragSnapshot {
  readonly revision: number;
  readonly projectionRevision: number;
  readonly geometryRevision: number;
  readonly session: FirstDraftTableDragSession | null;
}

export type FirstDraftTableRowDropResolution =
  | { readonly kind: "move"; readonly finalRowIds: readonly BlockId[] }
  | { readonly kind: "no-op" }
  | { readonly kind: "invalid"; readonly reason: string };

export type FirstDraftTableColumnDropResolution =
  | {
      readonly kind: "move";
      readonly tableId: BlockId;
      readonly sourceTarget: FirstDraftTableColumnMutationTarget;
      readonly finalTargets: readonly FirstDraftTableColumnMutationTarget[];
    }
  | { readonly kind: "no-op" }
  | { readonly kind: "invalid"; readonly reason: string };

export interface FirstDraftTableColumnCommitExpectation {
  readonly columnIds: readonly string[];
  readonly cellIdsByRow: readonly (readonly BlockId[])[];
}

export type FirstDraftTableSortablePointerActivation =
  PointerEventHandler<HTMLElement>;

export interface FirstDraftTableDragStore {
  readonly childOrderProjection: EditorChildOrderProjection;
  getSnapshot(): FirstDraftTableDragSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeParent(parentId: BlockId, listener: () => void): () => void;
  getTableScrollElement(tableId: BlockId): HTMLElement | null;
  registerTable(registration: FirstDraftTableDragRegistration): () => void;
  registerRowCarrier(
    tableId: BlockId,
    rowId: BlockId,
    rowContainerId: string,
    element: HTMLElement,
  ): () => void;
  registerColumnCarrier(
    tableId: BlockId,
    item: TableColumnDragItem,
    columnContainerId: string,
    element: HTMLElement,
  ): () => void;
  registerRowCarrierActivation(
    rowId: BlockId,
    activation: FirstDraftTableSortablePointerActivation,
  ): () => void;
  registerColumnCarrierActivation(
    dragId: string,
    activation: FirstDraftTableSortablePointerActivation,
  ): () => void;
  activateRowCarrier(
    rowId: BlockId,
    event: Parameters<FirstDraftTableSortablePointerActivation>[0],
  ): boolean;
  activateColumnCarrier(
    dragId: string,
    event: Parameters<FirstDraftTableSortablePointerActivation>[0],
  ): boolean;
  beginRowDrag(rowId: BlockId, sourceRect: DragRect): boolean;
  updateRowPreview(preview: SortablePreview): boolean;
  endRowDrag(result: DragEndResult): void;
  resolveRowDrop(
    rowId: BlockId,
    placement: SortableDropPlacement | undefined,
  ): FirstDraftTableRowDropResolution;
  clearRowDrag(): void;
  beginColumnDrag(dragId: string, sourceRect: DragRect): boolean;
  updateColumnPreview(preview: SortablePreview): boolean;
  endColumnDrag(result: DragEndResult): void;
  resolveColumnDrop(
    dragId: string,
    placement: SortableDropPlacement | undefined,
  ): FirstDraftTableColumnDropResolution;
  completeColumnCommit(
    expectation: FirstDraftTableColumnCommitExpectation,
  ): void;
  clearColumnDrag(): void;
  invalidateActiveDrag(tableId: BlockId): void;
  notifyTableGeometryChanged(tableId: BlockId, layoutKey: string): void;
  reconcileActiveTable(): void;
}

export function createFirstDraftTableRowContainerId(tableId: BlockId): string {
  return `first-draft-table-row-lane:${tableId}`;
}

export function createFirstDraftTableColumnContainerId(
  tableId: BlockId,
): string {
  return `first-draft-table-column-lane:${tableId}`;
}

let nextOpaqueSortableToken = 0;

export function createFirstDraftTableColumnDragItems(
  columnIdentityKind: "canonical" | "synthetic-presentation",
  presentationColumnIds: readonly string[],
): readonly TableColumnDragItem[] {
  const columnCount = presentationColumnIds.length;
  return presentationColumnIds.map((presentationId, index) => ({
    dragId: `first-draft-sortable-${++nextOpaqueSortableToken}`,
    presentationId,
    target:
      columnIdentityKind === "canonical"
        ? { kind: "canonical", columnId: presentationId }
        : {
            kind: "synthetic-presentation",
            presentationId,
            indexAtOpen: index,
            columnCountAtOpen: columnCount,
          },
  }));
}
