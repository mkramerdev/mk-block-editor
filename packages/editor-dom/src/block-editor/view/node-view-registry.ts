import type { BlockType } from "@repo/editor-core/document";
import type { NodeViewConstructor } from "../../prosemirror/index.ts";
import { createHeadingNodeView } from "../../nodeviews/heading-node-view.ts";
import { hardBreakNodeView } from "../../nodeviews/hard-break-node-view.ts";
import type { BlockLocalDomPluginOptions } from "../options/plugin-options.ts";

export function createBlockLocalNodeViews(
  blockType: BlockType,
  pluginOptions: BlockLocalDomPluginOptions,
  providedNodeViews: Record<string, NodeViewConstructor> | undefined,
): Record<string, NodeViewConstructor> {
  const nodeViews: Record<string, NodeViewConstructor> = {
    hard_break: hardBreakNodeView,
  };
  if (blockType === "heading")
    nodeViews.heading = createHeadingNodeView(pluginOptions.headingLevel);
  Object.assign(nodeViews, providedNodeViews);
  return nodeViews;
}
