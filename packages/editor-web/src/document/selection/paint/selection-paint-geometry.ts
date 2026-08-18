import type { BlockId } from "@repo/editor-core/kernel";
import {
  createEditorLogicalSelectionPoint,
  normalizeSelectionRangeResult,
  readEditorBlockSelectionTarget,
  type EditorLogicalSelectionPoint,
  type EditorSelectionDirection,
  type EditorSelectionGraphReader,
  type EditorSelectionRangeBlock,
  type EditorSelectionSnapshot,
} from "@repo/editor-react/selection";
import {
  deriveEditorBlockSelectionPaint,
  type EditorSelectionPaint,
} from "./selection-paint.ts";

export interface EditorSelectionPaintEndpoint {
  readonly blockId: BlockId;
  readonly offset: number;
}

export interface EditorSelectionPaintGeometry {
  readonly direction: EditorSelectionDirection;
  readonly anchor: EditorLogicalSelectionPoint;
  readonly focus: EditorLogicalSelectionPoint;
  readonly normalizedStart: EditorLogicalSelectionPoint;
  readonly normalizedEnd: EditorLogicalSelectionPoint;
  readonly rangeBlocks: readonly EditorSelectionRangeBlock[];
}

export function createEditorSelectionPaintGeometry(input: {
  readonly graph: EditorSelectionGraphReader;
  readonly anchor: EditorSelectionPaintEndpoint | null | undefined;
  readonly focus: EditorSelectionPaintEndpoint | null | undefined;
}): EditorSelectionPaintGeometry | null {
  if (!input.anchor || !input.focus) return null;
  const anchor = createEditorSelectionPaintPoint(input.anchor, input.graph);
  const focus = createEditorSelectionPaintPoint(input.focus, input.graph);
  if (!anchor || !focus) return null;
  const range = normalizeSelectionRangeResult(anchor, focus, input.graph);
  if (!range.ok) return null;
  return range.range;
}

export function deriveEditorBlockSelectionPaintFromGeometry(input: {
  readonly blockId: BlockId;
  readonly geometry: EditorSelectionPaintGeometry | null | undefined;
  readonly textLength?: number;
}): EditorSelectionPaint {
  if (!input.geometry) return { kind: "none" };
  return deriveEditorBlockSelectionPaint({
    blockId: input.blockId,
    snapshot: createPaintGeometrySnapshot(input.geometry),
    textLength: input.textLength,
  });
}

function createEditorSelectionPaintPoint(
  point: EditorSelectionPaintEndpoint,
  graph: EditorSelectionGraphReader,
): EditorLogicalSelectionPoint | null {
  if (!Number.isFinite(point.offset)) return null;
  const textOffset = Math.max(0, Math.trunc(point.offset));
  const target = readEditorBlockSelectionTarget(graph, point.blockId);
  if (!target) return null;
  return createEditorLogicalSelectionPoint({
    graph,
    blockId: target.block.id,
    textOffset,
    textAnchor: null,
  });
}

function createPaintGeometrySnapshot(
  geometry: EditorSelectionPaintGeometry,
): EditorSelectionSnapshot {
  return {
    phase: "committed",
    selectionRevision: 0,
    graphRevision: 0,
    lastInvalidationReason: null,
    direction: geometry.direction,
    anchor: geometry.anchor,
    focus: geometry.focus,
    normalizedStart: geometry.normalizedStart,
    normalizedEnd: geometry.normalizedEnd,
    rangeBlocks: geometry.rangeBlocks,
  };
}
