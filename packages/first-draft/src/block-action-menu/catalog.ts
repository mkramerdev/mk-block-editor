export type FirstDraftBlockActionId =
  | "delete-block"
  | "insert-before"
  | "insert-after"
  | "duplicate-block";

export interface FirstDraftBlockAction {
  readonly id: FirstDraftBlockActionId;
  readonly label: string;
}

export const firstDraftBlockActionCatalog = Object.freeze([
  { id: "delete-block", label: "Delete block" },
  { id: "insert-before", label: "Insert before" },
  { id: "insert-after", label: "Insert after" },
  { id: "duplicate-block", label: "Duplicate block" },
] satisfies readonly FirstDraftBlockAction[]);
