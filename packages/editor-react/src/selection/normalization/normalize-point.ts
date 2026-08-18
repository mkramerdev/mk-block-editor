import { isEditorSelectionTextAnchor } from "../anchors/text-anchor.ts";
import type {
  EditorLogicalSelectionPoint,
  EditorSelectionTextAffinity,
  EditorSelectionTextAnchor,
} from "../model/types.ts";
import type { EditorSelectionGraphReader } from "../graph/reader.ts";
import { readEditorBlockSelectionTarget } from "../graph/reader.ts";

export interface CreateEditorLogicalSelectionPointOptions {
  blockId: EditorLogicalSelectionPoint["blockId"];
  textOffset: number;
  graph: EditorSelectionGraphReader;
  textAnchor?: EditorSelectionTextAnchor | null;
  affinity?: EditorSelectionTextAffinity | null;
}

export function createEditorLogicalSelectionPoint({
  blockId,
  textOffset,
  graph,
  textAnchor = null,
  affinity = null,
}: CreateEditorLogicalSelectionPointOptions): EditorLogicalSelectionPoint | null {
  const target = readEditorBlockSelectionTarget(graph, blockId);
  if (!target) return null;
  const requiresTextAnchor =
    target.selection.projection.endpoint.kind === "content";
  if (requiresTextAnchor && !isEditorSelectionTextAnchor(textAnchor))
    return null;
  return {
    blockId: target.block.id,
    blockType: target.block.type,
    blockCategory: target.category,
    textOffset: normalizeSelectionOffset(textOffset),
    textAnchor: requiresTextAnchor ? textAnchor : null,
    affinity,
  };
}

export function normalizeSelectionPointForGraph(
  point: EditorLogicalSelectionPoint,
  graph: EditorSelectionGraphReader,
): EditorLogicalSelectionPoint | null {
  const target = readEditorBlockSelectionTarget(graph, point.blockId);
  if (!target) return null;
  const requiresTextAnchor =
    target.selection.projection.endpoint.kind === "content";
  if (requiresTextAnchor && !isEditorSelectionTextAnchor(point.textAnchor))
    return null;
  if (!requiresTextAnchor && point.textAnchor !== null) return null;
  return {
    ...point,
    blockType: target.block.type,
    blockCategory: target.category,
    textOffset: normalizeSelectionOffset(point.textOffset),
    textAnchor: requiresTextAnchor ? point.textAnchor : null,
  };
}

export function normalizeSelectionOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
