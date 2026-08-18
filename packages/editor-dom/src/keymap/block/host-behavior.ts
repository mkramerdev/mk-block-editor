import type { BlockLocalDomPluginOptions } from "../../block-editor/options/plugin-options.ts";
import type { EditorState } from "../../prosemirror/index.ts";
import type { BlockDomTextSelectionRange } from "../../block-editor/options/key-behavior.ts";

export function emitKeyBehavior(
  options: BlockLocalDomPluginOptions,
  _state: EditorState,
  key: Parameters<
    NonNullable<BlockLocalDomPluginOptions["emitBlockKeyBehavior"]>
  >[0]["key"],
  cursorOffset: number,
  selectionRange?: BlockDomTextSelectionRange,
  isComposing?: boolean,
): boolean {
  if (!Number.isFinite(cursorOffset)) return false;
  const result = options.emitBlockKeyBehavior?.({
    key,
    cursorOffset,
    ...(selectionRange === undefined ? {} : { selectionRange }),
    ...(isComposing === undefined ? {} : { isComposing }),
  });
  return Boolean(result?.ok && result.handled);
}
