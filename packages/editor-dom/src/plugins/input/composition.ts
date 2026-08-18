import type { BlockLocalDomPluginOptions } from "../../block-editor/options/plugin-options.ts";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "../../prosemirror/index.ts";

export const compositionPluginKey = new PluginKey<boolean>(
  "blockCompositionGuard",
);

export function setCompositionMeta(
  transaction: Transaction,
  composing: boolean,
): Transaction {
  return transaction.setMeta(compositionPluginKey, composing);
}

export function createCompositionPlugin(
  options: Pick<BlockLocalDomPluginOptions, "blockId" | "onCompositionChange">,
): Plugin<boolean> {
  return new Plugin<boolean>({
    key: compositionPluginKey,
    state: {
      init: () => false,
      apply(transaction, previous) {
        const meta = transaction.getMeta(compositionPluginKey) as
          | boolean
          | undefined;
        return meta ?? previous;
      },
    },
    props: {
      handleDOMEvents: {
        compositionstart(view) {
          view.dispatch(setCompositionMeta(view.state.tr, true));
          options.onCompositionChange?.(true, options.blockId);
          return false;
        },
        compositionend(view) {
          view.dispatch(setCompositionMeta(view.state.tr, false));
          options.onCompositionChange?.(false, options.blockId);
          return false;
        },
      },
    },
  });
}

export function isComposing(state: EditorState): boolean {
  return compositionPluginKey.getState(state) ?? false;
}
