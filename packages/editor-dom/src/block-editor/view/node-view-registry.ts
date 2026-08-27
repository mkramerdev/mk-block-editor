import type { NodeViewConstructor } from "../../prosemirror/index.ts";
import { hardBreakNodeView } from "../../nodeviews/hard-break-node-view.ts";

export function createBlockLocalNodeViews(
  providedNodeViews: Record<string, NodeViewConstructor> | undefined,
): Record<string, NodeViewConstructor> {
  const nodeViews: Record<string, NodeViewConstructor> = {
    hard_break: hardBreakNodeView,
  };
  Object.assign(nodeViews, providedNodeViews);
  return nodeViews;
}
