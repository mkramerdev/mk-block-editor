import type {
  EditorBlockCommandDefinition,
  EditorBlockCommandExecutionContext,
  EditorStructuralTextBoundaryRequest,
} from "@repo/editor-web/document-runtime";
import type { EditorKeyBinding } from "@repo/editor-web/keybindings";
import type { FirstDraftViewStateStore } from "../blocks/view-state.tsx";
import { planFirstDraftBoundaryJoin } from "./plan-boundary-join.ts";
import { planFirstDraftEnter } from "./plan-enter.ts";
import { planFirstDraftListIndent } from "./plan-list-indent.ts";
import type { FirstDraftBoundaryResult } from "./structural-command-model.ts";

export const FIRST_DRAFT_STRUCTURAL_TEXT_COMMAND_ID =
  "first-draft.structural-text-boundary";

export function createFirstDraftStructuralTextCommand(
  viewState: FirstDraftViewStateStore,
): EditorBlockCommandDefinition {
  return Object.freeze({
    id: FIRST_DRAFT_STRUCTURAL_TEXT_COMMAND_ID,
    scope: "block",
    execute(context: EditorBlockCommandExecutionContext) {
      const request = context.structuralTextBoundary;
      if (!request || request.isComposing) return false;
      if (
        context.blockType === "tableCell" &&
        (request.intent === "enter" ||
          request.intent === "backspace" ||
          request.intent === "delete")
      ) {
        return true;
      }
      const planned = routeFirstDraftStructuralTextBoundary(
        context,
        request,
        viewState,
      );
      if (!planned) return false;
      if ("handled" in planned) return true;
      const result = request.executeStructuralTransaction(planned.plan);
      if (!result.ok) {
        if (planned.createdCollapsedBlockId) {
          viewState.deleteBlockState(planned.createdCollapsedBlockId);
        }
        return false;
      }
      if (planned.createdCollapsedBlockId) {
        viewState.setBlockCollapsed(planned.createdCollapsedBlockId, true);
      }
      if (planned.focus) {
        context.editor.focusText(planned.focus.blockId, {
          offset: planned.focus.offset,
          preventScroll: true,
        });
      }
      return true;
    },
  });
}

export const firstDraftStructuralTextKeybindings = Object.freeze(
  ["Enter", "Backspace", "Delete", "Tab", "Shift-Tab"].map((key) => ({
    key,
    commandId: FIRST_DRAFT_STRUCTURAL_TEXT_COMMAND_ID,
    scope: "block" as const,
  })),
) satisfies readonly EditorKeyBinding[];

function routeFirstDraftStructuralTextBoundary(
  context: EditorBlockCommandExecutionContext,
  request: EditorStructuralTextBoundaryRequest,
  viewState: FirstDraftViewStateStore,
): FirstDraftBoundaryResult | null {
  switch (request.intent) {
    case "enter":
      return planFirstDraftEnter(context, request, viewState);
    case "backspace":
      return planFirstDraftBoundaryJoin(context, request, viewState, "previous");
    case "delete":
      return planFirstDraftBoundaryJoin(context, request, viewState, "next");
    case "tab":
      return planFirstDraftListIndent(context, request, false);
    case "shiftTab":
      return planFirstDraftListIndent(context, request, true);
  }
}
