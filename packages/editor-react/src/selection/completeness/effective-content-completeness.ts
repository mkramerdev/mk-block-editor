import type { BlockType } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorSelectionGraphReader } from "../graph/reader.ts";
import { readEditorBlockSelectionTarget } from "../graph/reader.ts";
import type { EditorSelectionRangeBlock } from "../model/types.ts";

export interface EditorSelectionContentCompletenessOptions {
  readonly graph: EditorSelectionGraphReader;
  readonly rangeById: ReadonlyMap<BlockId, EditorSelectionRangeBlock>;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly readTextContentSize: (
    blockId: BlockId,
    blockType: BlockType,
  ) => number | null;
  readonly getChildBlockIds?: (blockId: BlockId) => readonly BlockId[];
}

/**
 * Reads effective canonical content coverage without materializing a fragment.
 * Callers choose canonical or product-visible child traversal explicitly.
 */
export function createEditorSelectionContentCompletenessChecker(
  options: EditorSelectionContentCompletenessOptions,
): (blockId: BlockId) => boolean {
  const hasCompleteContent = (
    blockId: BlockId,
    ancestors: ReadonlySet<BlockId>,
  ): boolean => {
    if (ancestors.has(blockId)) return false;
    const target = readEditorBlockSelectionTarget(options.graph, blockId);
    if (!target) return false;
    const range = options.rangeById.get(blockId);
    if (range && range.blockType !== target.block.type) return false;
    if (range?.coverage === "complete-block") return true;
    const definition = options.blockDefinitions[target.block.type];
    if (!definition) return false;
    if (definition.kind === "text") {
      if (!range || range.coverage === "none") return false;
      if (range.coverage === "complete-content") return true;
      const contentSize = options.readTextContentSize(
        target.block.id,
        target.block.type,
      );
      if (
        contentSize === null ||
        !Number.isInteger(contentSize) ||
        contentSize < 0
      ) {
        return false;
      }
      const from = normalizeTextBoundary(range.startOffset, 0, contentSize);
      const to = normalizeTextBoundary(
        range.endOffset,
        contentSize,
        contentSize,
      );
      return Math.min(from, to) === 0 && Math.max(from, to) === contentSize;
    }
    if (definition.kind === "atomic") return false;
    const children =
      options.getChildBlockIds?.(blockId) ??
      options.graph.getChildBlockIds(blockId);
    if (children.length === 0) return false;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(blockId);
    return children.every((childId) =>
      hasCompleteContent(childId, nextAncestors),
    );
  };

  return (blockId) => hasCompleteContent(blockId, new Set());
}

function normalizeTextBoundary(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(0, Math.trunc(value ?? fallback)), max);
}
