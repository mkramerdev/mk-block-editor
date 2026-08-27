import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorBlockOperationResult } from "@repo/editor-web/block-operations";
import {
  insertFirstDraftAdjacentParagraph,
  readFirstDraftAdjacentParagraphAvailability,
} from "../block-operations/adjacent-paragraph.ts";
import type { FirstDraftViewStateStore } from "../blocks/view-state.tsx";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";
import type { FirstDraftBlockActionId } from "./catalog.ts";
import type { FirstDraftOpenBlockActionMenuSession } from "./store.tsx";

export type FirstDraftBlockActionAvailability =
  | { readonly kind: "available" }
  | { readonly kind: "disabled" }
  | { readonly kind: "stale" };

export type FirstDraftBlockActionDispatchResult =
  | {
      readonly kind: "applied";
      readonly operation: Extract<EditorBlockOperationResult, { readonly ok: true }>;
    }
  | { readonly kind: "disabled" }
  | { readonly kind: "stale" }
  | { readonly kind: "rejected"; readonly error: unknown };

export function readFirstDraftBlockActionAvailability(
  editor: FirstDraftEditor,
  session: FirstDraftOpenBlockActionMenuSession,
  actionId: FirstDraftBlockActionId,
): FirstDraftBlockActionAvailability {
  const block = editor.getBlock(session.blockId);
  if (!block || block.tombstone) return { kind: "stale" };
  switch (actionId) {
    case "insert-before":
      return readFirstDraftAdjacentParagraphAvailability(
        editor,
        block.id,
        "before",
      );
    case "insert-after":
      return readFirstDraftAdjacentParagraphAvailability(
        editor,
        block.id,
        "after",
      );
    case "delete-block":
    case "duplicate-block":
      return { kind: "available" };
    default:
      return assertNever(actionId);
  }
}

export function dispatchFirstDraftBlockAction(
  editor: FirstDraftEditor,
  viewState: FirstDraftViewStateStore,
  session: FirstDraftOpenBlockActionMenuSession,
  actionId: FirstDraftBlockActionId,
): FirstDraftBlockActionDispatchResult {
  const availability = readFirstDraftBlockActionAvailability(
    editor,
    session,
    actionId,
  );
  if (availability.kind !== "available") return availability;

  try {
    let operation: EditorBlockOperationResult;
    let deletedIds: readonly BlockId[] = [];
    switch (actionId) {
      case "delete-block":
        deletedIds = collectSubtreeIds(editor, session.blockId);
        operation = editor.deleteBlock({ blockId: session.blockId });
        break;
      case "insert-before":
        operation = insertFirstDraftAdjacentParagraph(
          editor,
          session.blockId,
          "before",
        );
        break;
      case "insert-after":
        operation = insertFirstDraftAdjacentParagraph(
          editor,
          session.blockId,
          "after",
        );
        break;
      case "duplicate-block":
        operation = editor.duplicateBlock({ blockId: session.blockId });
        break;
      default:
        return assertNever(actionId);
    }
    if (operation.ok) {
      for (const blockId of deletedIds) viewState.deleteBlockState(blockId);
      return { kind: "applied", operation };
    }
    if (!editor.getBlock(session.blockId)) return { kind: "stale" };
    const currentAvailability = readFirstDraftBlockActionAvailability(
      editor,
      session,
      actionId,
    );
    if (currentAvailability.kind !== "available") return currentAvailability;
    return {
      kind: "rejected",
      error: new Error(operation.message ?? "The block action was rejected."),
    };
  } catch (error) {
    return { kind: "rejected", error };
  }
}

function collectSubtreeIds(
  editor: FirstDraftEditor,
  rootId: BlockId,
): readonly BlockId[] {
  const result: BlockId[] = [];
  const visit = (blockId: BlockId): void => {
    result.push(blockId);
    for (const childId of editor.getChildBlockIds(blockId)) visit(childId);
  };
  visit(rootId);
  return result;
}

function assertNever(value: never): never {
  throw new Error(`Unknown First Draft block action: ${String(value)}`);
}
