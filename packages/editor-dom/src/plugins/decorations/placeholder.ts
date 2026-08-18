import {
  Decoration,
  DecorationSet,
  Plugin,
  PluginKey,
  type EditorState,
} from "../../prosemirror/index.ts";
import type { TextPlaceholder } from "../../block-editor/options/plugin-options.ts";

const placeholderAttribute = "data-editor-placeholder";

export interface PlaceholderPluginState {
  decorations: DecorationSet;
}

export const placeholderPluginKey = new PluginKey<PlaceholderPluginState>(
  "blockPlaceholder",
);
const emptyPlaceholderDecorations = DecorationSet.empty;
const createPlaceholderDecorationSet = DecorationSet.create.bind(DecorationSet);
const createPlaceholderNodeDecoration = Decoration.node.bind(Decoration);

export function createPlaceholderPlugin(
  placeholder?: TextPlaceholder | (() => TextPlaceholder | undefined),
): Plugin<PlaceholderPluginState> {
  return new Plugin<PlaceholderPluginState>({
    key: placeholderPluginKey,
    state: {
      init: (_config, state) => buildPlaceholderState(state, placeholder),
      apply(transaction, previous, _oldState, state) {
        if (!transaction.docChanged) return previous;
        return buildPlaceholderState(state, placeholder);
      },
    },
    props: {
      decorations(state) {
        return (
          placeholderPluginKey.getState(state)?.decorations ??
          emptyPlaceholderDecorations
        );
      },
    },
  });
}

export function buildPlaceholderDecorations(
  state: EditorState,
  placeholder?: TextPlaceholder,
): DecorationSet {
  const textBlock = state.doc.firstChild;
  if (!textBlock || !placeholder?.text) return emptyPlaceholderDecorations;
  if (textBlock.content.size > 0) return emptyPlaceholderDecorations;
  return createPlaceholderDecorationSet(state.doc, [
    createPlaceholderNodeDecoration(0, textBlock.nodeSize, {
      [placeholderAttribute]: placeholder.text,
    }),
  ]);
}

function buildPlaceholderState(
  state: EditorState,
  placeholder:
    | TextPlaceholder
    | (() => TextPlaceholder | undefined)
    | undefined,
): PlaceholderPluginState {
  return {
    decorations: buildPlaceholderDecorations(
      state,
      typeof placeholder === "function" ? placeholder() : placeholder,
    ),
  };
}
