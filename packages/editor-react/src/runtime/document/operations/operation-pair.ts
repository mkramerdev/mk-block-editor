import { cloneJsonValue, type BlockId } from "@repo/editor-core/kernel";
import type {
  EditorBlockContentOperationBatch,
  EditorLogicalBlockGraphOperation,
  TransformBlocksPayload,
} from "@repo/editor-core/operations";
import type { EditorOperation } from "../history.ts";
import type { EditorCommandState } from "../state/command-state.ts";
import type { EditorDocumentUpdate } from "./document-update.ts";
import type { EditorBlockGraphOperation } from "./block-graph-operation.ts";
import { createBlocksForDurableOperation } from "./operation-execution.ts";
import { createEditorBlockGraphPatch } from "./manifest-diff.ts";
import type { EditorOperationRequest } from "./mutation.ts";

export interface CreateBlockGraphOperationPairInput {
  readonly previousState: EditorCommandState;
  readonly requestedNextState: EditorCommandState;
  readonly contentOperations: readonly EditorBlockContentOperationBatch[];
  readonly candidateBlockIds?: readonly BlockId[];
  readonly targetBlockId?: BlockId | null;
  readonly targetId: string;
}

export interface PreparedEditorBlockGraphOperation {
  readonly operation: EditorBlockGraphOperation<TransformBlocksPayload>;
  readonly blocks: EditorCommandState["blocks"];
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: EditorCommandState["childIdsByParentId"];
  readonly update: EditorDocumentUpdate;
}

export interface PreparedEditorBlockGraphOperationPair {
  readonly forward: EditorLogicalBlockGraphOperation;
  readonly inverse: EditorLogicalBlockGraphOperation;
  readonly preparedOperation: PreparedEditorBlockGraphOperation;
}

export interface PreparedEditorBlockGraphForwardOperation {
  readonly forward: EditorLogicalBlockGraphOperation;
  readonly preparedOperation: PreparedEditorBlockGraphOperation;
}

export function createPreparedBlockGraphOperation(
  input: CreateBlockGraphOperationPairInput,
): PreparedEditorBlockGraphForwardOperation | null {
  const forwardRequest = operationRequest(input.requestedNextState, input);
  const forwardBlocks = createBlocksForDurableOperation(
    input.previousState,
    forwardRequest,
  );
  const forwardState = { ...input.requestedNextState, blocks: forwardBlocks };
  const forwardPatch = createEditorBlockGraphPatch(
    input.previousState,
    forwardState,
    forwardRequest,
  );
  if (!forwardPatch) return null;
  const forward = logicalBlockGraphOperation(
    input.targetId,
    forwardPatch.patch,
    input.contentOperations,
  );
  return {
    forward,
    preparedOperation: {
      operation: {
        body: { kind: forward.graphKind, payload: forward.payload },
        createdAt: Date.now(),
      },
      blocks: forwardBlocks,
      rootBlockIds: input.requestedNextState.rootBlockIds,
      childIdsByParentId: input.requestedNextState.childIdsByParentId,
      update: forwardPatch.update,
    },
  };
}

export function createBlockGraphOperationPair(
  input: CreateBlockGraphOperationPairInput,
): PreparedEditorBlockGraphOperationPair | null {
  const prepared = createPreparedBlockGraphOperation(input);
  if (!prepared) return null;
  const { forward } = prepared;
  const inversePatch = createDirectInversePatch(
    input.previousState,
    forward.payload,
  );
  const inverse = logicalBlockGraphOperation(
    `inverse:${input.targetId}`,
    inversePatch,
    [],
  );
  return {
    forward,
    inverse,
    preparedOperation: prepared.preparedOperation,
  };
}

export function composeEditorOperations(
  operations: readonly EditorOperation[],
): EditorOperation {
  const flattened = operations.flatMap((operation) =>
    operation.kind === "composite" ? operation.operations : [operation],
  );
  return flattened.length === 1
    ? flattened[0]!
    : { kind: "composite", operations: flattened };
}

function operationRequest(
  nextState: EditorCommandState,
  input: CreateBlockGraphOperationPairInput,
): EditorOperationRequest {
  return {
    reason: "runtime-mutation",
    nextState,
    contentOperations: input.contentOperations,
    ...(input.candidateBlockIds === undefined
      ? {}
      : { candidateBlockIds: input.candidateBlockIds }),
    ...(input.targetBlockId === undefined
      ? {}
      : { targetBlockId: input.targetBlockId }),
    operationTargetId: input.targetId,
    provenance: null,
  };
}

function logicalBlockGraphOperation(
  targetId: string,
  patch: Omit<TransformBlocksPayload, "targetId" | "contentOperations">,
  contentOperations: readonly EditorBlockContentOperationBatch[],
): EditorLogicalBlockGraphOperation {
  return {
    kind: "blockGraph",
    graphKind: "transformBlocks",
    payload: {
      ...patch,
      targetId,
      contentOperations: cloneJsonValue(contentOperations),
    },
  };
}

function createDirectInversePatch(
  previousState: EditorCommandState,
  forward: TransformBlocksPayload,
): Omit<TransformBlocksPayload, "targetId" | "contentOperations"> {
  const affectedBlockIds = uniqueBlockIds([
    ...forward.affectedBlockIds,
    ...forward.upsertedBlocks.map((block) => block.id),
    ...(forward.removedBlockIds ?? []),
  ]);
  const upsertedBlocks = affectedBlockIds.flatMap((blockId) => {
    const block = previousState.blocks[blockId];
    return block ? [cloneJsonValue(block)] : [];
  });
  const removedBlockIds = affectedBlockIds.filter(
    (blockId) => previousState.blocks[blockId] === undefined,
  );
  const resolvedPlacements = affectedBlockIds.flatMap((blockId) => {
    const block = previousState.blocks[blockId];
    if (!block || block.tombstone) return [];
    const siblings =
      block.parentId === null
        ? previousState.rootBlockIds
        : (previousState.childIdsByParentId[block.parentId] ?? []);
    const childIndex = siblings.indexOf(blockId);
    return childIndex < 0
      ? []
      : [
          {
            blockId,
            parentId: block.parentId,
            childIndex,
            previousSiblingId: siblings[childIndex - 1] ?? null,
            nextSiblingId: siblings[childIndex + 1] ?? null,
          },
        ];
  });
  return {
    affectedBlockIds,
    upsertedBlocks,
    removedBlockIds,
    rootBlockIds: previousState.rootBlockIds,
    childIdsByParentId: previousState.childIdsByParentId,
    ...(resolvedPlacements.length === 0 ? {} : { resolvedPlacements }),
  };
}

function uniqueBlockIds(values: readonly BlockId[]): readonly BlockId[] {
  return [...new Set(values)];
}
