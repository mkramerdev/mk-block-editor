import type { BlockLocalDomPluginOptions } from "../../block-editor/options/plugin-options.ts";
import { createBlockKeymap } from "../../keymap/block/bindings.ts";
import type { Plugin } from "../../prosemirror/index.ts";
import { createActiveLinePlugin } from "../decorations/active-line.ts";
import { createPlaceholderPlugin } from "../decorations/placeholder.ts";
import { createBlockDropCursorPlugin } from "../drop-cursor/drop-cursor.ts";
import { createCompositionPlugin } from "../input/composition.ts";

export function createBlockLocalDomPlugins(
  options: BlockLocalDomPluginOptions,
): Plugin[] {
  return [
    createCompositionPlugin(options),
    createPlaceholderPlugin(() => options.placeholder),
    createActiveLinePlugin(),
    createBlockDropCursorPlugin(),
    ...(options.additionalPlugins ?? []),
    createBlockKeymap(options),
  ];
}
