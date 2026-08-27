import type { EditableEditor } from "@repo/editor-web/editor";
import {
  deleteFirstDraftTableColumn,
  deleteFirstDraftTableRow,
  duplicateFirstDraftTableColumn,
  duplicateFirstDraftTableRow,
  insertFirstDraftTableColumn,
  insertFirstDraftTableRow,
} from "../blocks/table/mutations.ts";
import { resolveFirstDraftTableActionTarget } from "../blocks/table/action-target.ts";
import type { FirstDraftTableActionId } from "./catalog.ts";
import type { FirstDraftOpenTableActionMenuSession } from "./store.tsx";

export type FirstDraftTableActionAvailability =
  | { readonly kind: "available"; readonly targetIndex: number }
  | { readonly kind: "disabled"; readonly targetIndex: number }
  | { readonly kind: "stale" };

export type FirstDraftTableActionDispatchResult =
  | { readonly kind: "applied" }
  | { readonly kind: "disabled" }
  | { readonly kind: "stale" }
  | { readonly kind: "rejected"; readonly error: unknown };

export function readFirstDraftTableActionAvailability(
  editor: EditableEditor,
  session: FirstDraftOpenTableActionMenuSession,
  actionId: FirstDraftTableActionId,
): FirstDraftTableActionAvailability {
  if (session.target.kind !== axisForAction(actionId)) {
    return { kind: "stale" };
  }
  try {
    const { structure, targetIndex } = resolveFirstDraftTableActionTarget(
      editor,
      session.tableId,
      session.target,
    );
    const deletingFinalTarget =
      (actionId === "delete-row" && structure.rowIds.length === 1) ||
      (actionId === "delete-column" && structure.columnCount === 1);
    return {
      kind: deletingFinalTarget ? "disabled" : "available",
      targetIndex,
    };
  } catch {
    return { kind: "stale" };
  }
}

export function dispatchFirstDraftTableAction(
  editor: EditableEditor,
  session: FirstDraftOpenTableActionMenuSession,
  actionId: FirstDraftTableActionId,
): FirstDraftTableActionDispatchResult {
  const availability = readFirstDraftTableActionAvailability(
    editor,
    session,
    actionId,
  );
  if (availability.kind === "disabled") return { kind: "disabled" };
  if (availability.kind === "stale") return { kind: "stale" };

  try {
    if (session.target.kind === "row") {
      const rowId = session.target.rowId;
      switch (actionId) {
        case "delete-row":
          deleteFirstDraftTableRow(editor, session.tableId, rowId);
          break;
        case "insert-row-above":
          insertFirstDraftTableRow(
            editor,
            session.tableId,
            availability.targetIndex,
          );
          break;
        case "insert-row-below":
          insertFirstDraftTableRow(
            editor,
            session.tableId,
            availability.targetIndex + 1,
          );
          break;
        case "duplicate-row":
          duplicateFirstDraftTableRow(editor, session.tableId, rowId);
          break;
        default:
          return { kind: "stale" };
      }
    } else {
      switch (actionId) {
        case "delete-column":
          deleteFirstDraftTableColumn(
            editor,
            session.tableId,
            session.target.identity,
          );
          break;
        case "insert-column-left":
          insertFirstDraftTableColumn(
            editor,
            session.tableId,
            availability.targetIndex,
          );
          break;
        case "insert-column-right":
          insertFirstDraftTableColumn(
            editor,
            session.tableId,
            availability.targetIndex + 1,
          );
          break;
        case "duplicate-column":
          duplicateFirstDraftTableColumn(
            editor,
            session.tableId,
            session.target.identity,
          );
          break;
        default:
          return { kind: "stale" };
      }
    }
    return { kind: "applied" };
  } catch (error) {
    return { kind: "rejected", error };
  }
}

function axisForAction(actionId: FirstDraftTableActionId): "row" | "column" {
  return actionId.endsWith("row") || actionId.includes("row-")
    ? "row"
    : "column";
}
