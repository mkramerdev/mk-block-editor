import type { BlockId } from "@repo/editor-core/kernel";
import type {
  BlockSelectionChildCoverage,
  BlockSelectionCoverage,
  BlockSelectionCoverageResult,
} from "@repo/editor-core/selection";
import type {
  EditorLogicalSelectionPoint,
  EditorSelectionDirection,
  EditorSelectionFailure,
  EditorSelectionRangeBlock,
  SelectionBlockOwner,
} from "../model/types.ts";
import type {
  EditorBlockSelectionTarget,
  EditorSelectionGraphReader,
} from "../graph/reader.ts";
import {
  canTargetEditorBlockSelection,
  readEditorBlockSelectionTarget,
} from "../graph/reader.ts";
import { collectEditorSelectionTraversalIds } from "../graph/traversal.ts";
import { normalizeSelectionPointForGraph } from "./normalize-point.ts";

const documentSelectionOwner = Object.freeze({
  kind: "document" as const,
}) satisfies SelectionBlockOwner;

export interface EditorNormalizedSelectionRange {
  direction: EditorSelectionDirection;
  anchor: EditorLogicalSelectionPoint;
  focus: EditorLogicalSelectionPoint;
  normalizedStart: EditorLogicalSelectionPoint;
  normalizedEnd: EditorLogicalSelectionPoint;
  rangeBlocks: readonly EditorSelectionRangeBlock[];
}

export type NormalizeEditorSelectionRangeResult =
  | { ok: true; range: EditorNormalizedSelectionRange }
  | (EditorSelectionFailure & { point: "anchor" | "focus" });

export interface NormalizeNewSelectionInput {
  readonly anchor: EditorLogicalSelectionPoint;
  readonly focus: EditorLogicalSelectionPoint;
}

export function normalizeNewSelection(
  input: NormalizeNewSelectionInput,
  graph: EditorSelectionGraphReader,
): NormalizeEditorSelectionRangeResult {
  const normalized = normalizeSelectionRangeResult(
    input.anchor,
    input.focus,
    graph,
  );
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    range: {
      ...normalized.range,
      rangeBlocks: Object.freeze(
        normalized.range.rangeBlocks.map((block) => ({
          ...block,
          owner: documentSelectionOwner,
        })),
      ),
    },
  };
}

export function normalizeSelectionRange(
  anchor: EditorLogicalSelectionPoint,
  focus: EditorLogicalSelectionPoint,
  graph: EditorSelectionGraphReader,
): EditorNormalizedSelectionRange | null {
  const result = normalizeSelectionRangeResult(anchor, focus, graph);
  return result.ok ? result.range : null;
}

export function normalizeSelectionRangeResult(
  anchor: EditorLogicalSelectionPoint,
  focus: EditorLogicalSelectionPoint,
  graph: EditorSelectionGraphReader,
): NormalizeEditorSelectionRangeResult {
  const anchorValidation = validateSelectionPointForNormalization(
    anchor,
    graph,
    "anchor",
  );
  if (!anchorValidation.ok) return anchorValidation;
  const focusValidation = validateSelectionPointForNormalization(
    focus,
    graph,
    "focus",
  );
  if (!focusValidation.ok) return focusValidation;
  const normalizedAnchor = anchorValidation.pointValue;
  const normalizedFocus = focusValidation.pointValue;
  if (normalizedAnchor.blockId === normalizedFocus.blockId) {
    const target = readEditorBlockSelectionTarget(
      graph,
      normalizedAnchor.blockId,
    );
    if (target?.selection.projection.endpoint.kind === "content") {
      const direction =
        normalizedAnchor.textOffset <= normalizedFocus.textOffset
          ? "forward"
          : "backward";
      const normalizedStart =
        direction === "forward" ? normalizedAnchor : normalizedFocus;
      const normalizedEnd =
        direction === "forward" ? normalizedFocus : normalizedAnchor;
      const model = target.selection;
      const coverageResult: BlockSelectionCoverageResult = {
        blockId: target.block.id,
        blockType: target.block.type,
        modelId: model.id,
        coverage: "partial",
        ...(model.paint === undefined ? {} : { paint: model.paint }),
        ...(model.fragment === undefined ? {} : { fragment: model.fragment }),
        ...(model.edit === undefined ? {} : { edit: model.edit }),
        ...(model.delete === undefined ? {} : { delete: model.delete }),
        ...(model.cut === undefined ? {} : { cut: model.cut }),
        ...(model.move === undefined ? {} : { move: model.move }),
      };
      return {
        ok: true,
        range: {
          direction,
          anchor: normalizedAnchor,
          focus: normalizedFocus,
          normalizedStart,
          normalizedEnd,
          rangeBlocks: Object.freeze([
            createRangeBlock(
              target,
              coverageResult,
              normalizedStart,
              normalizedEnd,
            ),
          ]),
        },
      };
    }
  }
  const operationBlockIds = collectEditorSelectionTraversalIds(graph);
  const orderByBlockId = new Map<BlockId, number>();
  operationBlockIds.forEach((blockId, index) =>
    orderByBlockId.set(blockId, index),
  );
  const direction =
    compareSelectionPoints(orderByBlockId, normalizedAnchor, normalizedFocus) <=
    0
      ? "forward"
      : "backward";
  const normalizedStart =
    direction === "forward" ? normalizedAnchor : normalizedFocus;
  const normalizedEnd =
    direction === "forward" ? normalizedFocus : normalizedAnchor;

  return {
    ok: true,
    range: {
      direction,
      anchor: normalizedAnchor,
      focus: normalizedFocus,
      normalizedStart,
      normalizedEnd,
      rangeBlocks: createSelectionRangeBlocks(
        graph,
        operationBlockIds,
        orderByBlockId,
        normalizedStart,
        normalizedEnd,
      ),
    },
  };
}

function validateSelectionPointForNormalization(
  point: EditorLogicalSelectionPoint,
  graph: EditorSelectionGraphReader,
  pointRole: "anchor" | "focus",
):
  | { ok: true; pointValue: EditorLogicalSelectionPoint }
  | (EditorSelectionFailure & { point: "anchor" | "focus" }) {
  const target = readEditorBlockSelectionTarget(graph, point.blockId);
  if (!target)
    return normalizationFailure("missing-block", pointRole, point.blockId);
  if (!canTargetEditorBlockSelection(target))
    return normalizationFailure(
      "unsupported-block-type",
      pointRole,
      point.blockId,
    );
  const normalized = normalizeSelectionPointForGraph(point, graph);
  if (!normalized)
    return normalizationFailure("invalid", pointRole, point.blockId);
  return { ok: true, pointValue: normalized };
}

function compareSelectionPoints(
  orderByBlockId: ReadonlyMap<BlockId, number>,
  left: EditorLogicalSelectionPoint,
  right: EditorLogicalSelectionPoint,
): number {
  if (left.blockId !== right.blockId) {
    const leftOrder = orderByBlockId.get(left.blockId);
    const rightOrder = orderByBlockId.get(right.blockId);
    if (leftOrder !== undefined && rightOrder !== undefined)
      return leftOrder - rightOrder;
  }
  return left.textOffset - right.textOffset;
}

interface CoverageEvaluationContext {
  readonly graph: EditorSelectionGraphReader;
  readonly selectedBlockIds: ReadonlySet<BlockId>;
  readonly targets: readonly EditorBlockSelectionTarget[];
  readonly normalizedStart: EditorLogicalSelectionPoint;
  readonly normalizedEnd: EditorLogicalSelectionPoint;
}

function createSelectionRangeBlocks(
  graph: EditorSelectionGraphReader,
  operationBlockIds: readonly BlockId[],
  orderByBlockId: ReadonlyMap<BlockId, number>,
  normalizedStart: EditorLogicalSelectionPoint,
  normalizedEnd: EditorLogicalSelectionPoint,
): readonly EditorSelectionRangeBlock[] {
  const startIndex = orderByBlockId.get(normalizedStart.blockId);
  const endIndex = orderByBlockId.get(normalizedEnd.blockId);
  if (startIndex === undefined || endIndex === undefined) return [];
  const selectedBlockIds = new Set(
    operationBlockIds.slice(startIndex, endIndex + 1),
  );
  const targetIds = new Set(selectedBlockIds);
  for (const blockId of selectedBlockIds) {
    let parentId = graph.getParentId(blockId);
    const visited = new Set<BlockId>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      targetIds.add(parentId);
      parentId = graph.getParentId(parentId);
    }
  }
  const targets = operationBlockIds
    .filter((blockId) => targetIds.has(blockId))
    .map((blockId) => readEditorBlockSelectionTarget(graph, blockId))
    .filter((target): target is EditorBlockSelectionTarget => target !== null);
  const context: CoverageEvaluationContext = {
    graph,
    selectedBlockIds,
    targets,
    normalizedStart,
    normalizedEnd,
  };
  const rangeBlocks: EditorSelectionRangeBlock[] = [];
  for (const target of targets) {
    const coverageResult = evaluateSelectionCoverage(target, context);
    if (
      !selectedBlockIds.has(target.block.id) &&
      coverageResult.coverage === "none"
    )
      continue;
    rangeBlocks.push(
      createRangeBlock(target, coverageResult, normalizedStart, normalizedEnd),
    );
  }
  return Object.freeze(rangeBlocks);
}

function evaluateSelectionCoverage(
  target: EditorBlockSelectionTarget,
  context: CoverageEvaluationContext,
): BlockSelectionCoverageResult {
  const blockId = target.block.id;
  const model = target.selection;
  const directCoverage = directCoverageForBlock(target, context);
  let coverage = directCoverage;
  let childCoverages: readonly BlockSelectionChildCoverage[] | undefined;
  const childScope = model.children?.scope;
  if (childScope) {
    const evaluatedChildren = relevantChildBlocks(target, context).map(
      (child) => evaluateSelectionCoverage(child, context),
    );
    childCoverages = Object.freeze(
      evaluatedChildren.map((result) => ({
        blockId: result.blockId,
        coverage: result.coverage,
      })),
    );
    coverage = aggregateContainerCoverage(directCoverage, childCoverages);
  }
  const result: BlockSelectionCoverageResult = {
    blockId,
    blockType: target.block.type,
    modelId: model.id,
    coverage,
    ...(model.paint === undefined ? {} : { paint: model.paint }),
    ...(model.fragment === undefined ? {} : { fragment: model.fragment }),
    ...(model.edit === undefined ? {} : { edit: model.edit }),
    ...(model.delete === undefined ? {} : { delete: model.delete }),
    ...(model.cut === undefined ? {} : { cut: model.cut }),
    ...(model.move === undefined ? {} : { move: model.move }),
    ...(childCoverages && childCoverages.length > 0 ? { childCoverages } : {}),
  };
  return result;
}

function directCoverageForBlock(
  target: EditorBlockSelectionTarget,
  context: CoverageEvaluationContext,
): BlockSelectionCoverage {
  const blockId = target.block.id;
  if (!context.selectedBlockIds.has(blockId)) return "none";
  if (target.selection.projection.endpoint.kind === "content") {
    return blockId === context.normalizedStart.blockId ||
      blockId === context.normalizedEnd.blockId
      ? "partial"
      : "complete-content";
  }
  return target.selection.coverage.selected;
}

function relevantChildBlocks(
  target: EditorBlockSelectionTarget,
  context: CoverageEvaluationContext,
): readonly EditorBlockSelectionTarget[] {
  return context.graph
    .getChildBlockIds(target.block.id)
    .map((blockId) => readEditorBlockSelectionTarget(context.graph, blockId))
    .filter((child): child is EditorBlockSelectionTarget => child !== null);
}

function aggregateContainerCoverage(
  directCoverage: BlockSelectionCoverage,
  childCoverages: readonly BlockSelectionChildCoverage[],
): BlockSelectionCoverage {
  if (directCoverage === "complete-block") return "complete-block";
  if (directCoverage === "partial") return "partial";
  if (childCoverages.length === 0) return directCoverage;
  const selectedChildren = childCoverages.filter(
    (childCoverage) => childCoverage.coverage !== "none",
  );
  if (selectedChildren.length === 0) return directCoverage;
  if (
    childCoverages.some((childCoverage) => childCoverage.coverage === "partial")
  )
    return "partial";
  if (selectedChildren.length !== childCoverages.length) return "partial";
  return "complete-content";
}

function createRangeBlock(
  target: EditorBlockSelectionTarget,
  coverageResult: BlockSelectionCoverageResult,
  normalizedStart: EditorLogicalSelectionPoint,
  normalizedEnd: EditorLogicalSelectionPoint,
): EditorSelectionRangeBlock {
  const blockId = target.block.id;
  const rangeBlock: EditorSelectionRangeBlock = {
    blockId,
    blockType: target.block.type,
    category: target.category,
    coverage: coverageResult.coverage,
    coverageResult,
    selectable: target.selectable,
  };
  if (target.selection.projection.endpoint.kind !== "content")
    return rangeBlock;
  if (blockId === normalizedStart.blockId) {
    rangeBlock.startOffset = normalizedStart.textOffset;
    if (normalizedStart.textAnchor)
      rangeBlock.startTextAnchor = normalizedStart.textAnchor;
  }
  if (blockId === normalizedEnd.blockId) {
    rangeBlock.endOffset = normalizedEnd.textOffset;
    if (normalizedEnd.textAnchor)
      rangeBlock.endTextAnchor = normalizedEnd.textAnchor;
  }
  return rangeBlock;
}

function normalizationFailure(
  reason: EditorSelectionFailure["reason"],
  point: "anchor" | "focus",
  blockId: EditorLogicalSelectionPoint["blockId"],
): EditorSelectionFailure & { point: "anchor" | "focus" } {
  return { ok: false, reason, point, blockId };
}
