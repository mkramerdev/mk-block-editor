/**
 * Applies replayable block graph operation bodies to a block map.
 * Inputs are validated operation payloads and replay context; returns the same mutation
 * result shape as patch application. It does not plan UI actions, read block-local
 * content documents, or perform persistence side effects.
 */
import type {
  Block,
  OrderedBlockGraph,
  VersionedBlock,
} from "../../document/model/block.ts";
import type {
  EditorBlockGraphOperationBody,
  TransformBlocksPayload,
} from "../language/block-graph.ts";
import {
  applyBlockGraphPatch,
  type BlockGraphMutationResult,
} from "./block-graph-patch.ts";

/** Explicit replay metadata needed to tombstone removed blocks. */
export interface BlockGraphReplayContext {
  now: number;
}

/** Dispatches a block graph operation body to the matching pure graph reducer. */
export function applyBlockGraphOperation(
  graph: OrderedBlockGraph<VersionedBlock>,
  operation: EditorBlockGraphOperationBody,
  context?: BlockGraphReplayContext,
): BlockGraphMutationResult {
  if (operation.kind !== "transformBlocks") {
    throw new Error(
      `unsupported block graph operation kind ${String(operation.kind)}`,
    );
  }
  const payload = operation.payload as TransformBlocksPayload;
  return applyBlockGraphPatch(graph, payload, {
    contentOperations: payload.contentOperations ?? [],
    removedBlockTombstone:
      (payload.removedBlockIds?.length ?? 0) > 0
        ? tombstoneFromReplayContext(context)
        : undefined,
  });
}

function tombstoneFromReplayContext(
  context: BlockGraphReplayContext | undefined,
): NonNullable<Block["tombstone"]> {
  if (!context) {
    throw new Error(
      "block graph operation with removedBlockIds requires replay context",
    );
  }
  return {
    deletedAt: context.now,
    reason: "move-replace",
  };
}
