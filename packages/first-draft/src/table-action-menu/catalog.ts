export type FirstDraftTableActionId =
  | "delete-row"
  | "insert-row-above"
  | "insert-row-below"
  | "duplicate-row"
  | "delete-column"
  | "insert-column-left"
  | "insert-column-right"
  | "duplicate-column";

export interface FirstDraftTableAction {
  readonly id: FirstDraftTableActionId;
  readonly axis: "row" | "column";
  readonly label: string;
}

export const firstDraftTableActionCatalog = Object.freeze({
  row: Object.freeze([
    { id: "delete-row", axis: "row", label: "Delete row" },
    { id: "insert-row-above", axis: "row", label: "Insert row above" },
    { id: "insert-row-below", axis: "row", label: "Insert row below" },
    { id: "duplicate-row", axis: "row", label: "Duplicate row" },
  ] satisfies readonly FirstDraftTableAction[]),
  column: Object.freeze([
    { id: "delete-column", axis: "column", label: "Delete column" },
    { id: "insert-column-left", axis: "column", label: "Insert column left" },
    { id: "insert-column-right", axis: "column", label: "Insert column right" },
    { id: "duplicate-column", axis: "column", label: "Duplicate column" },
  ] satisfies readonly FirstDraftTableAction[]),
});
