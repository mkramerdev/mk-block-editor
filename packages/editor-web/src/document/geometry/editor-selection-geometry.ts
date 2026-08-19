import type { EditorSelectionRangeBlock } from "@repo/editor-react/selection";
import type {
  EditorDocumentGeometryReader,
  EditorDocumentRect,
} from "./editor-document-geometry.ts";
import { deriveEditorSelectionRangeBlockPaint } from "../selection/paint/selection-paint.ts";

export type EditorSelectionDocumentGeometry =
  | {
      readonly kind: "text";
      readonly rects: readonly EditorDocumentRect[];
    }
  | {
      readonly kind: "block-surface";
      readonly rects: readonly EditorDocumentRect[];
    };

export function readEditorSelectionRangeBlockGeometry(
  geometry: EditorDocumentGeometryReader,
  rangeBlock: EditorSelectionRangeBlock,
): EditorSelectionDocumentGeometry | null {
  const paint = deriveEditorSelectionRangeBlockPaint({
    rangeBlock,
    textLength: geometry.readTextCanonicalLength(rangeBlock.blockId) ?? 0,
  });
  if (paint.kind === "text-range") {
    const rects = paint.ranges.flatMap((range) =>
      geometry.readTextRangeRects(rangeBlock.blockId, {
        from: range.startOffset,
        to: range.endOffset,
      }),
    );
    return rects.length === 0 ? null : { kind: "text", rects };
  }
  if (paint.kind === "block-surface") {
    const rect = geometry.readBlockSelectionRect(
      rangeBlock.blockId,
      paint.target,
    );
    return rect ? { kind: "block-surface", rects: [rect] } : null;
  }
  return null;
}
