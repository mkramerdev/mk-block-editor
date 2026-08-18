import type { BlockId } from "@repo/editor-core/kernel";
import {
  validateCommittedSelectionOwnership,
  type CommittedSelectionSnapshot,
} from "../model/committed-selection-snapshot.ts";
import type {
  EditorLogicalSelectionPoint,
  EditorSelectionFailure,
  EditorSelectionSnapshot,
  EditorSelectionTextAnchorResolver,
} from "../model/types.ts";
import type { EditorSelectionGraphReader } from "../graph/reader.ts";
import { readEditorBlockSelectionTarget } from "../graph/reader.ts";
import {
  isEditorSelectionTextAnchor,
  resolveEditorSelectionTextAnchorPoint,
} from "./text-anchor.ts";

export type SelectionAnchorRebaseFailureReason =
  | "stale-selection-revision"
  | "invalid-projection-revision"
  | "missing-block"
  | "missing-endpoint"
  | "invalid-endpoint"
  | "deleted-endpoint-content"
  | "unsupported-endpoint-kind"
  | "internal-identity-mismatch"
  | "internal-range-invalidated"
  | "block-order-mismatch"
  | "disposed-runtime"
  | "dom-unavailable"
  | "anchor-mapping-failed"
  | "owner-changed-during-rebase";

export interface SelectionAnchorRebaseContext {
  readonly graph: EditorSelectionGraphReader;
  readonly graphRevision: number;
  readonly expectedSelectionRevision?: number;
  readonly disposed?: boolean;
  readonly domAvailable?: boolean;
  readonly textAnchorResolver?: EditorSelectionTextAnchorResolver | null;
}

export interface RebasedCommittedSelectionSnapshot {
  readonly committed: CommittedSelectionSnapshot;
  readonly documentSelection: EditorSelectionSnapshot;
}

export type SelectionAnchorRebaseResult =
  | {
      readonly ok: true;
      readonly sourceSelectionRevision: number;
      readonly rebasedEndpoints: CommittedSelectionSnapshot["endpoints"];
      readonly snapshot: RebasedCommittedSelectionSnapshot;
      readonly changed: boolean;
      readonly normalizationInvoked: false;
    }
  | {
      readonly ok: false;
      readonly reason: SelectionAnchorRebaseFailureReason;
      readonly sourceSelectionRevision: number;
      readonly affectedBlockIds?: readonly BlockId[];
    };

/**
 * Refreshes DOM/runtime-dependent anchors for one captured committed snapshot.
 * It deliberately preserves all committed semantics and never normalizes or
 * commits a selection.
 */
export function rebaseCommittedSelectionAnchors(
  snapshot: CommittedSelectionSnapshot,
  context: SelectionAnchorRebaseContext,
): SelectionAnchorRebaseResult {
  const failure = (
    reason: SelectionAnchorRebaseFailureReason,
    affectedBlockIds?: readonly BlockId[],
  ): SelectionAnchorRebaseResult => ({
    ok: false,
    reason,
    sourceSelectionRevision: snapshot.revision,
    ...(affectedBlockIds ? { affectedBlockIds } : {}),
  });
  if (context.disposed) return failure("disposed-runtime");
  const ownership = validateCommittedSelectionOwnership(snapshot);
  if (!ownership.ok) return failure("owner-changed-during-rebase");
  if (context.domAvailable === false) return failure("dom-unavailable");
  if (
    context.expectedSelectionRevision !== undefined &&
    context.expectedSelectionRevision !== snapshot.revision
  )
    return failure("stale-selection-revision");
  if (!Number.isSafeInteger(context.graphRevision) || context.graphRevision < 0)
    return failure("invalid-projection-revision");

  for (const block of snapshot.blocks) {
    if (!context.graph.getBlock(block.blockId))
      return failure("missing-block", [block.blockId]);
  }
  if (
    !snapshot.endpoints.anchor ||
    !snapshot.endpoints.head ||
    !snapshot.endpoints.normalizedStart ||
    !snapshot.endpoints.normalizedEnd
  )
    return failure("missing-endpoint");

  const internalFailure = validateInternalSelection(snapshot, context);
  if (internalFailure)
    return failure(internalFailure.reason, internalFailure.blockIds);

  const resolvedAnchor = rebasePoint(
    snapshot.endpoints.anchor,
    context.graph,
    context,
  );
  if (!resolvedAnchor.ok)
    return failure(resolvedAnchor.reason, resolvedAnchor.blockIds);
  const resolvedHead = rebasePoint(
    snapshot.endpoints.head,
    context.graph,
    context,
  );
  if (!resolvedHead.ok)
    return failure(resolvedHead.reason, resolvedHead.blockIds);
  const resolvedStart = rebasePoint(
    snapshot.endpoints.normalizedStart,
    context.graph,
    context,
  );
  if (!resolvedStart.ok)
    return failure(resolvedStart.reason, resolvedStart.blockIds);
  const resolvedEnd = rebasePoint(
    snapshot.endpoints.normalizedEnd,
    context.graph,
    context,
  );
  if (!resolvedEnd.ok) return failure(resolvedEnd.reason, resolvedEnd.blockIds);

  const endpointChanged =
    resolvedAnchor.point !== snapshot.endpoints.anchor ||
    resolvedHead.point !== snapshot.endpoints.head ||
    resolvedStart.point !== snapshot.endpoints.normalizedStart ||
    resolvedEnd.point !== snapshot.endpoints.normalizedEnd;
  const projectionChanged =
    context.graphRevision !== snapshot.documentSelection.graphRevision;
  const changed = endpointChanged || projectionChanged;
  const endpoints = endpointChanged
    ? Object.freeze({
        anchor: resolvedAnchor.point,
        head: resolvedHead.point,
        normalizedStart: resolvedStart.point,
        normalizedEnd: resolvedEnd.point,
      })
    : snapshot.endpoints;
  const rebasedBlocks = rebaseBoundaryBlocks(
    snapshot.documentSelection.rangeBlocks,
    resolvedStart.point,
    resolvedEnd.point,
  );
  const documentSelection =
    endpointChanged || projectionChanged
      ? Object.freeze({
          ...snapshot.documentSelection,
          graphRevision: context.graphRevision,
          anchor: resolvedAnchor.point,
          focus: resolvedHead.point,
          normalizedStart: resolvedStart.point,
          normalizedEnd: resolvedEnd.point,
          rangeBlocks: rebasedBlocks,
        })
      : snapshot.documentSelection;
  return {
    ok: true,
    sourceSelectionRevision: snapshot.revision,
    rebasedEndpoints: endpoints,
    snapshot: Object.freeze({ committed: snapshot, documentSelection }),
    changed,
    normalizationInvoked: false,
  };
}

function rebaseBoundaryBlocks(
  blocks: EditorSelectionSnapshot["rangeBlocks"],
  start: EditorLogicalSelectionPoint,
  end: EditorLogicalSelectionPoint,
): EditorSelectionSnapshot["rangeBlocks"] {
  let changed = false;
  const rebased = blocks.map((rangeBlock) => {
    const isStart =
      rangeBlock.blockId === start.blockId && Boolean(start.textAnchor);
    const isEnd = rangeBlock.blockId === end.blockId && Boolean(end.textAnchor);
    if (!isStart && !isEnd) return rangeBlock;
    const nextStart = isStart ? start.textOffset : rangeBlock.startOffset;
    const nextEnd = isEnd ? end.textOffset : rangeBlock.endOffset;
    if (
      nextStart === rangeBlock.startOffset &&
      nextEnd === rangeBlock.endOffset
    )
      return rangeBlock;
    changed = true;
    return Object.freeze({
      ...rangeBlock,
      ...(isStart
        ? { startOffset: nextStart, startTextAnchor: start.textAnchor! }
        : {}),
      ...(isEnd ? { endOffset: nextEnd, endTextAnchor: end.textAnchor! } : {}),
    });
  });
  return changed ? Object.freeze(rebased) : blocks;
}

type PointResult =
  | { readonly ok: true; readonly point: EditorLogicalSelectionPoint }
  | {
      readonly ok: false;
      readonly reason: SelectionAnchorRebaseFailureReason;
      readonly blockIds?: readonly BlockId[];
    };

function rebasePoint(
  point: EditorLogicalSelectionPoint,
  graph: EditorSelectionGraphReader,
  context: SelectionAnchorRebaseContext,
): PointResult {
  const target = readEditorBlockSelectionTarget(graph, point.blockId);
  if (!target) return pointFailure("missing-block", point.blockId);
  if (
    target.block.type !== point.blockType ||
    target.category !== point.blockCategory
  )
    return pointFailure("invalid-endpoint", point.blockId);
  if (!point.textAnchor) return { ok: true, point };
  if (!isEditorSelectionTextAnchor(point.textAnchor))
    return pointFailure("unsupported-endpoint-kind", point.blockId);
  if (!context.textAnchorResolver)
    return pointFailure("anchor-mapping-failed", point.blockId);
  const resolved = resolveEditorSelectionTextAnchorPoint(
    point,
    graph,
    context.textAnchorResolver,
  );
  if (!resolved.ok) return mapResolutionFailure(resolved, point.blockId);
  if (
    resolved.textOffset === point.textOffset &&
    resolved.affinity === point.affinity
  )
    return { ok: true, point };
  return {
    ok: true,
    point: Object.freeze({
      ...point,
      textOffset: resolved.textOffset,
      textAnchor: point.textAnchor,
      affinity: resolved.affinity,
    }),
  };
}

function validateInternalSelection(
  snapshot: CommittedSelectionSnapshot,
  context: SelectionAnchorRebaseContext,
): {
  reason: SelectionAnchorRebaseFailureReason;
  blockIds: readonly BlockId[];
} | null {
  if (snapshot.kind !== "block-internal") return null;
  const blockId = snapshot.internal?.blockId;
  if (
    !blockId ||
    snapshot.owner.kind !== "block-internal" ||
    snapshot.owner.blockId !== blockId
  )
    return {
      reason: "internal-identity-mismatch",
      blockIds: blockId ? [blockId] : [],
    };
  const block = context.graph.getBlock(blockId);
  if (!block)
    return { reason: "internal-identity-mismatch", blockIds: [blockId] };
  return null;
}

function pointFailure(
  reason: SelectionAnchorRebaseFailureReason,
  blockId: BlockId,
): PointResult {
  return { ok: false, reason, blockIds: [blockId] };
}

function mapResolutionFailure(
  failure: EditorSelectionFailure,
  blockId: BlockId,
): PointResult {
  const reason: SelectionAnchorRebaseFailureReason =
    failure.reason === "missing-block"
      ? "missing-block"
      : failure.reason === "missing-text" || failure.reason === "deleted-block"
        ? "deleted-endpoint-content"
        : failure.reason === "stale-graph"
          ? "invalid-projection-revision"
          : "anchor-mapping-failed";
  return pointFailure(reason, blockId);
}
