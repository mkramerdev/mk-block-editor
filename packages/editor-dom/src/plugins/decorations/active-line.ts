import {
  Decoration,
  DecorationSet,
  Plugin,
  PluginKey,
  type EditorState,
} from "../../prosemirror/index.ts";

const defaultActiveLineClassName = "editor-block-active-line";

export const activeLinePluginKey = new PluginKey<DecorationSet>(
  "blockActiveLine",
);

export function createActiveLinePlugin(
  className = defaultActiveLineClassName,
): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: activeLinePluginKey,
    state: {
      init: (_config, state) => buildActiveLineDecorations(state, className),
      apply: (_transaction, _previous, _oldState, state) =>
        buildActiveLineDecorations(state, className),
    },
    props: {
      decorations(state) {
        return activeLinePluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}

export function buildActiveLineDecorations(
  state: EditorState,
  className: string,
): DecorationSet {
  const { $from } = state.selection;
  const from = $from.before($from.depth);
  const to = $from.after($from.depth);
  return DecorationSet.create(state.doc, [
    Decoration.node(from, to, { class: className }),
  ]);
}
