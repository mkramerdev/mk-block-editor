import type { FirstDraftBlockType } from "./document-drag-overlay-contracts.ts";

export const FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET = "drag-visual";
export const FIRST_DRAFT_TABLE_GRID_BOUNDS_TARGET = "table-grid";

export type FirstDraftDocumentDragVisualBoundsTarget =
  | typeof FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET
  | typeof FIRST_DRAFT_TABLE_GRID_BOUNDS_TARGET
  | null;

const firstDraftDocumentDragVisualBoundsTargets = {
  paragraph: null,
  heading: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
  bulletList: null,
  orderedList: null,
  checklist: null,
  bulletListItem: null,
  orderedListItem: null,
  checklistItem: null,
  quote: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
  code: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
  callout: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
  toggleHeading: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
  toggleHeadingBody: null,
  toggleListItem: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
  toggleListItemBody: null,
  divider: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
  columns: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
  column: null,
  tabs: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
  tabPane: null,
  table: FIRST_DRAFT_TABLE_GRID_BOUNDS_TARGET,
  tableRow: null,
  tableCell: null,
} satisfies Readonly<
  Record<FirstDraftBlockType, FirstDraftDocumentDragVisualBoundsTarget>
>;

export function readFirstDraftDocumentDragVisualBoundsTarget(
  blockType: string,
): FirstDraftDocumentDragVisualBoundsTarget | undefined {
  return (
    firstDraftDocumentDragVisualBoundsTargets as Readonly<
      Record<string, FirstDraftDocumentDragVisualBoundsTarget | undefined>
    >
  )[blockType];
}
