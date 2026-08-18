import type { Command } from "../../prosemirror/index.ts";

export const insertSoftBreak: Command = (state, dispatch) => {
  if (!state.selection.empty) return false;
  if (state.selection.$from.parent.type.spec.code) {
    if (dispatch) dispatch(state.tr.insertText("\n"));
    return true;
  }
  const hardBreak = state.schema.nodes.hard_break;
  if (!hardBreak) return false;
  if (dispatch)
    dispatch(state.tr.insert(state.selection.from, hardBreak.create()));
  return true;
};
