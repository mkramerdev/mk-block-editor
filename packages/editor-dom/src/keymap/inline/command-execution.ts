import {
  resolveInlineMarkCommandAction,
  resolveInlineMarkCommandAttrs,
  type InlineMarkCommandAction,
  type InlineMarkDefinition,
} from "@repo/editor-core/content/marks";
import type { Command, EditorState } from "../../prosemirror/index.ts";
import { readInlineMarkCommandState } from "./command-state.ts";

export interface InlineMarkCommandOptions {
  action?: InlineMarkCommandAction;
  attrs?: Readonly<Record<string, unknown>> | null;
}

export function executeInlineMarkCommand(
  state: EditorState,
  dispatch: Parameters<Command>[1],
  definition: InlineMarkDefinition,
  options: InlineMarkCommandOptions = {},
): boolean {
  const markName = definition.name;
  const markType = state.schema.marks[markName];
  if (!markType) return false;
  const commandState = readInlineMarkCommandState(
    state,
    definition,
    options.attrs,
  );
  if (!commandState.canExecute) return false;
  const action = resolveInlineMarkCommandAction(commandState, options.action);
  const attrs = resolveInlineMarkCommandAttrs(
    definition,
    action,
    options.attrs,
  );
  if (!attrs) return false;

  if (!dispatch) return true;
  let tr = state.tr;
  if (state.selection.empty) {
    tr =
      action === "remove"
        ? tr.removeStoredMark(markType)
        : tr.addStoredMark(markType.create(attrs));
    dispatch(tr);
    return true;
  }

  return false;
}
