import type { BlockLocalDomPluginOptions } from "../../block-editor/options/plugin-options.ts";
import { createBlockKeymap } from "../../keymap/block/bindings.ts";
import type { Plugin } from "../../prosemirror/index.ts";
import { createActiveLinePlugin } from "../decorations/active-line.ts";
import { createPlaceholderPlugin } from "../decorations/placeholder.ts";
import { createBlockDropCursorPlugin } from "../drop-cursor/drop-cursor.ts";
import { createCompositionPlugin } from "../input/composition.ts";
import { createEditorOwnedDeletionPlugin } from "../input/deletion-beforeinput.ts";

export function createBlockLocalDomPlugins(
  options: BlockLocalDomPluginOptions,
): Plugin[] {
  return [
    createCompositionPlugin(options),
    createEditorOwnedDeletionPlugin(),
    createPlaceholderPlugin(() => options.placeholder),
    createActiveLinePlugin(),
    createBlockDropCursorPlugin(),
    ...(options.additionalPlugins ?? []),
    createBlockKeymap(options),
  ];
}
