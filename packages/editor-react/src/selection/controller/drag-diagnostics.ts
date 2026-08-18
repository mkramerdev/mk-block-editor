import type {
  EditorLogicalSelectionPoint,
  EditorSelectionDragDiagnosticPayload,
  EditorSelectionSnapshot,
} from "../model/types.ts";
import { isEditorSelectionTextAnchor } from "../anchors/text-anchor.ts";

export function createEditorSelectionDragDiagnosticPayload(
  snapshot: EditorSelectionSnapshot,
): EditorSelectionDragDiagnosticPayload | null {
  const start = snapshot.normalizedStart;
  const end = snapshot.normalizedEnd;
  if (!start || !end || !snapshot.direction) return null;
  if (!snapshotHasValidTextBoundaryAnchors(snapshot)) return null;
  return {
    selectionRevision: snapshot.selectionRevision,
    graphRevision: snapshot.graphRevision,
    direction: snapshot.direction,
    start: {
      blockId: start.blockId,
      blockType: start.blockType,
      category: start.blockCategory,
      offset: start.textOffset,
      textAnchor: start.textAnchor,
    },
    end: {
      blockId: end.blockId,
      blockType: end.blockType,
      category: end.blockCategory,
      offset: end.textOffset,
      textAnchor: end.textAnchor,
    },
    blocks: snapshot.rangeBlocks,
  };
}

export function snapshotHasValidTextBoundaryAnchors(
  snapshot: EditorSelectionSnapshot,
): boolean {
  const points = [
    snapshot.anchor,
    snapshot.focus,
    snapshot.normalizedStart,
    snapshot.normalizedEnd,
  ];
  return points.every((point) => validPointTextAnchor(point));
}

function validPointTextAnchor(
  point: EditorLogicalSelectionPoint | null,
): boolean {
  if (!point) return true;
  return (
    point.textAnchor === null || isEditorSelectionTextAnchor(point.textAnchor)
  );
}
