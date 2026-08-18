import type { VersionedBlock } from "@repo/editor-core/document";
import { createVersionedBlockRecordOverlay } from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorCommandState } from "../state/command-state.ts";
import type { EditorBlockGraphOperation } from "./block-graph-operation.ts";
import type {
  EditorContentOperationFailure,
  EditorOperationRequest,
} from "./mutation.ts";

export function createBlocksForDurableOperation(
  previousState: EditorCommandState,
  request: EditorOperationRequest,
): Record<BlockId, VersionedBlock> {
  if (request.contentOperations.length === 0) return request.nextState.blocks;
  const overlay = createVersionedBlockRecordOverlay(request.nextState.blocks);
  const blocks = overlay.blocks;
  const nextContentVersion =
    `v${previousState.blockGraphVersion + 1}` as VersionedBlock["contentVersion"];
  for (const batch of request.contentOperations) {
    const block = blocks[batch.blockId];
    if (!block || block.tombstone) continue;
    if (
      !previousState.blocks[batch.blockId] ||
      block.contentVersion === nextContentVersion
    )
      continue;
    blocks[batch.blockId] = { ...block, contentVersion: nextContentVersion };
  }
  return overlay.seal() as Record<BlockId, VersionedBlock>;
}

export function stateFromDurableOperationResult(
  previousState: EditorCommandState,
  requestedState: EditorCommandState,
  operation: EditorBlockGraphOperation,
  mutation: {
    blocks: Record<BlockId, VersionedBlock>;
    rootBlockIds: readonly BlockId[];
    childIdsByParentId: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>;
  },
): EditorCommandState {
  return {
    ...requestedState,
    blocks: mutation.blocks,
    rootBlockIds: mutation.rootBlockIds,
    childIdsByParentId: mutation.childIdsByParentId,
    blockGraphVersion: previousState.blockGraphVersion + 1,
    updatedAt: operation.createdAt,
  };
}

export function createEditorOperationFailure(input: {
  readonly request: EditorOperationRequest;
  readonly previousState?: EditorCommandState;
  readonly message: string;
}): EditorContentOperationFailure | null {
  const blockId =
    input.request.contentOperations[0]?.blockId ??
    input.request.targetBlockId ??
    null;
  return blockId
    ? {
        index: 0,
        blockId,
        reason: "mutation-failed",
        message: input.message,
      }
    : null;
}
