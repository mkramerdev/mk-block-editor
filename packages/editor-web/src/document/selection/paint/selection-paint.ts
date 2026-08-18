import type { BlockId } from "@repo/editor-core/kernel";
import {
  isEditorSelectionTextAnchor,
  normalizeSelectionOffset,
  type EditorLogicalSelectionPoint,
  type EditorSelectionRangeBlock,
  type EditorSelectionSnapshot,
  type BlockInternalSelectionSubsystem,
} from "@repo/editor-react/selection";

export interface EditorSelectionTextRangePaint {
  startOffset: number;
  endOffset: number;
  coverage: "partial" | "complete-content";
}

export type EditorSelectionPaint =
  | {
      kind: "none";
    }
  | {
      kind: "text-range";
      blockId: BlockId;
      ranges: readonly EditorSelectionTextRangePaint[];
      coverageResult: EditorSelectionRangeBlock["coverageResult"];
    }
  | {
      kind: "block-surface";
      blockId: BlockId;
      target: string | null;
      coverageResult: EditorSelectionRangeBlock["coverageResult"];
    }
  | {
      kind: "block-internal";
      blockId: BlockId;
      subsystem: BlockInternalSelectionSubsystem;
      selection: unknown;
      coverageResult: EditorSelectionRangeBlock["coverageResult"];
    };

export interface DeriveEditorBlockSelectionPaintOptions {
  blockId: BlockId;
  snapshot: EditorSelectionSnapshot;
  textLength?: number;
}

export function deriveEditorBlockSelectionPaint({
  blockId,
  snapshot,
  textLength = 0,
}: DeriveEditorBlockSelectionPaintOptions): EditorSelectionPaint {
  if (snapshot.phase !== "dragging" && snapshot.phase !== "committed")
    return noSelectionPaint();
  if (!snapshotHasValidTextBoundaryAnchors(snapshot)) return noSelectionPaint();
  const rangeBlock = deriveEditorSelectionRangeBlockForBlock(blockId, snapshot);
  if (!rangeBlock) return noSelectionPaint();
  return deriveEditorSelectionRangeBlockPaint({
    rangeBlock,
    textLength,
  });
}

export function deriveEditorSelectionRangeBlockPaint({
  rangeBlock,
  textLength = 0,
}: {
  rangeBlock: EditorSelectionRangeBlock;
  textLength?: number;
}): EditorSelectionPaint {
  if (rangeBlock.coverage === "none") return noSelectionPaint();
  if (rangeBlock.owner?.kind === "block-internal") {
    return {
      kind: "block-internal",
      blockId: rangeBlock.blockId,
      subsystem: rangeBlock.owner.subsystem,
      selection: rangeBlock.coverageResult.internal,
      coverageResult: rangeBlock.coverageResult,
    };
  }
  const modelPaint = rangeBlock.coverageResult.paint;
  if (isContentSelectionPaintDescriptor(modelPaint)) {
    if (
      rangeBlock.coverage !== "partial" &&
      rangeBlock.coverage !== "complete-content"
    )
      return noSelectionPaint();
    const range = deriveTextPaintRange(rangeBlock, textLength);
    return range
      ? {
          kind: "text-range",
          blockId: rangeBlock.blockId,
          ranges: Object.freeze([
            range,
          ]) as readonly EditorSelectionTextRangePaint[],
          coverageResult: rangeBlock.coverageResult,
        }
      : noSelectionPaint();
  }
  if (isBlockSurfaceSelectionPaintDescriptor(modelPaint)) {
    return blockSurfacePaintCovers(modelPaint, rangeBlock.coverage)
      ? {
          kind: "block-surface",
          blockId: rangeBlock.blockId,
          target:
            typeof modelPaint.target === "string" ? modelPaint.target : null,
          coverageResult: rangeBlock.coverageResult,
        }
      : noSelectionPaint();
  }
  return noSelectionPaint();
}

export function isSelectionCoverageContentPaint(
  rangeBlock: EditorSelectionRangeBlock,
): boolean {
  return isContentSelectionPaintDescriptor(rangeBlock.coverageResult.paint);
}

function isContentSelectionPaintDescriptor(
  value: unknown,
): value is { readonly kind: "content" } {
  return isRecord(value) && value.kind === "content";
}

function isBlockSurfaceSelectionPaintDescriptor(value: unknown): value is {
  readonly kind: "block-surface";
  readonly target?: unknown;
  readonly coverage?: unknown;
} {
  return isRecord(value) && value.kind === "block-surface";
}

function blockSurfacePaintCovers(
  descriptor: { readonly coverage?: unknown },
  coverage: EditorSelectionRangeBlock["coverage"],
): boolean {
  if (coverage !== "complete-content" && coverage !== "complete-block")
    return false;
  if (!Array.isArray(descriptor.coverage)) return coverage === "complete-block";
  return descriptor.coverage.includes(coverage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function deriveEditorSelectionRangeBlockForBlock(
  blockId: BlockId,
  snapshot: EditorSelectionSnapshot,
): EditorSelectionRangeBlock | null {
  if (snapshot.phase !== "dragging" && snapshot.phase !== "committed")
    return null;
  if (!snapshotHasValidTextBoundaryAnchors(snapshot)) return null;
  for (const rangeBlock of snapshot.rangeBlocks) {
    if (rangeBlock.blockId === blockId) return rangeBlock;
  }
  return null;
}

function deriveTextPaintRange(
  rangeBlock: EditorSelectionRangeBlock,
  textLength: number,
): EditorSelectionTextRangePaint | null {
  const length = normalizeSelectionOffset(textLength);
  const startOffset =
    rangeBlock.coverage === "complete-content"
      ? 0
      : (rangeBlock.startOffset ?? 0);
  const endOffset =
    rangeBlock.coverage === "complete-content"
      ? length
      : (rangeBlock.endOffset ?? length);
  const start = clampSelectionPaintOffset(startOffset, length);
  const end = clampSelectionPaintOffset(endOffset, length);
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (from === to) return null;
  return {
    startOffset: from,
    endOffset: to,
    coverage:
      rangeBlock.coverage === "complete-content"
        ? "complete-content"
        : "partial",
  };
}

function clampSelectionPaintOffset(offset: number, textLength: number): number {
  const normalized = normalizeSelectionOffset(offset);
  return Math.min(normalized, textLength);
}

function noSelectionPaint(): EditorSelectionPaint {
  return { kind: "none" };
}

function snapshotHasValidTextBoundaryAnchors(
  snapshot: EditorSelectionSnapshot,
): boolean {
  const points = [
    snapshot.anchor,
    snapshot.focus,
    snapshot.normalizedStart,
    snapshot.normalizedEnd,
  ];
  return points.every((point) => !point || pointHasValidAnchorShape(point));
}

function pointHasValidAnchorShape(point: EditorLogicalSelectionPoint): boolean {
  return (
    point.textAnchor === null || isEditorSelectionTextAnchor(point.textAnchor)
  );
}
