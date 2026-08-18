import type {
  OrderedBlockGraph,
  VersionedBlock,
} from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { BlockGraphPatch } from "@repo/editor-core/operations";
import type { EditorOperationRequest } from "./mutation.ts";
import type { EditorCommandState } from "../state/command-state.ts";
import { cloneBlockForEditorPatch } from "./cloning.ts";
import {
  classifyEditorDocumentUpdate,
  type EditorDocumentUpdate,
} from "./document-update.ts";
import { blocksEquivalent } from "./manifest-query.ts";

export interface EditorBlockGraphPatchResult {
  readonly patch: BlockGraphPatch;
  readonly update: EditorDocumentUpdate;
}

export function createEditorBlockGraphPatch(
  previousState: EditorCommandState,
  nextState: EditorCommandState,
  request: EditorOperationRequest,
): EditorBlockGraphPatchResult | null {
  const candidateBlockIds = new Set<BlockId>();
  for (const batch of request.contentOperations)
    candidateBlockIds.add(batch.blockId);
  if (request.targetBlockId) candidateBlockIds.add(request.targetBlockId);
  if (
    request.nextState.blocks !== previousState.blocks ||
    request.nextState.rootBlockIds !== previousState.rootBlockIds ||
    request.nextState.childIdsByParentId !== previousState.childIdsByParentId
  ) {
    if (request.candidateBlockIds) {
      for (const blockId of request.candidateBlockIds)
        candidateBlockIds.add(blockId);
    } else {
      for (const blockId of Object.keys(previousState.blocks) as BlockId[]) {
        candidateBlockIds.add(blockId);
      }
      for (const blockId of Object.keys(nextState.blocks) as BlockId[]) {
        candidateBlockIds.add(blockId);
      }
    }
  }
  if (candidateBlockIds.size === 0) return null;

  const affectedBlockIds = new Set<BlockId>();
  const upsertedBlocks: VersionedBlock[] = [];
  const removedBlockIds: BlockId[] = [];
  for (const blockId of candidateBlockIds) {
    const previousBlock = previousState.blocks[blockId];
    const nextBlock = nextState.blocks[blockId];
    if (!nextBlock) {
      if (previousBlock) {
        removedBlockIds.push(blockId);
        affectedBlockIds.add(blockId);
      }
      continue;
    }
    if (
      !blocksEquivalent(previousBlock, nextBlock) ||
      placementChanged(previousState, nextState, blockId)
    ) {
      upsertedBlocks.push(cloneBlockForEditorPatch(nextBlock));
      affectedBlockIds.add(blockId);
    }
  }
  for (const batch of request.contentOperations) {
    if (nextState.blocks[batch.blockId]) affectedBlockIds.add(batch.blockId);
  }
  const update = classifyEditorDocumentUpdate({
    previousState,
    nextState,
    candidateBlockIds: [...candidateBlockIds],
    contentChangedBlockIds: request.contentOperations.map(
      (batch) => batch.blockId,
    ),
  });
  if (
    affectedBlockIds.size === 0 &&
    update.containerSequences.changedParentIds.length === 0
  ) {
    return null;
  }
  const compareNextPosition = createCanonicalPositionComparator(nextState);
  const comparePreviousPosition =
    createCanonicalPositionComparator(previousState);
  upsertedBlocks.sort((left, right) => compareNextPosition(left.id, right.id));
  removedBlockIds.sort(comparePreviousPosition);
  const orderedAffected = [
    ...[...affectedBlockIds]
      .filter((blockId) => {
        const block = nextState.blocks[blockId];
        return Boolean(block && !block.tombstone);
      })
      .sort(compareNextPosition),
    ...removedBlockIds,
  ];
  const resolvedPlacements = orderedAffected.flatMap((blockId) => {
    const block = nextState.blocks[blockId];
    if (!block || block.tombstone) return [];
    const siblingIds =
      block.parentId === null
        ? nextState.rootBlockIds
        : (nextState.childIdsByParentId[block.parentId] ?? []);
    const childIndex = siblingIds.indexOf(blockId);
    if (childIndex < 0) return [];
    return [
      {
        blockId,
        parentId: block.parentId,
        childIndex,
        previousSiblingId: siblingIds[childIndex - 1] ?? null,
        nextSiblingId: siblingIds[childIndex + 1] ?? null,
      },
    ];
  });
  return {
    update,
    patch: {
      affectedBlockIds: orderedAffected,
      upsertedBlocks,
      removedBlockIds,
      rootBlockIds: nextState.rootBlockIds,
      childIdsByParentId: nextState.childIdsByParentId,
      ...(resolvedPlacements.length === 0 ? {} : { resolvedPlacements }),
    },
  };
}

function createCanonicalPositionComparator(
  graph: OrderedBlockGraph<VersionedBlock>,
): (left: BlockId, right: BlockId) => number {
  const readPath = (blockId: BlockId): readonly BlockId[] | null => {
    const reversePath: BlockId[] = [];
    const visited = new Set<BlockId>();
    let currentId: BlockId | null = blockId;
    while (currentId !== null) {
      if (visited.has(currentId)) {
        return null;
      }
      visited.add(currentId);
      const block: VersionedBlock | undefined = graph.blocks[currentId];
      if (!block || block.tombstone) {
        return null;
      }
      reversePath.push(currentId);
      currentId = block.parentId;
    }
    return Object.freeze(reversePath.reverse());
  };
  const readSiblingIndex = (
    parentId: BlockId | null,
    blockId: BlockId,
  ): number => {
    const childIds =
      parentId === null
        ? graph.rootBlockIds
        : (graph.childIdsByParentId[parentId] ?? []);
    return childIds.indexOf(blockId);
  };
  return (left, right) => {
    if (left === right) return 0;
    const leftPath = readPath(left);
    const rightPath = readPath(right);
    if (!leftPath || !rightPath) return compareStructuralBlockIds(left, right);
    let sharedDepth = 0;
    while (
      sharedDepth < leftPath.length &&
      sharedDepth < rightPath.length &&
      leftPath[sharedDepth] === rightPath[sharedDepth]
    ) {
      sharedDepth += 1;
    }
    if (sharedDepth === leftPath.length) return -1;
    if (sharedDepth === rightPath.length) return 1;
    const parentId =
      sharedDepth === 0 ? null : (leftPath[sharedDepth - 1] ?? null);
    const leftIndex = readSiblingIndex(parentId, leftPath[sharedDepth]!);
    const rightIndex = readSiblingIndex(parentId, rightPath[sharedDepth]!);
    if (leftIndex < 0 || rightIndex < 0) {
      return compareStructuralBlockIds(left, right);
    }
    return leftIndex - rightIndex;
  };
}

function compareStructuralBlockIds(left: BlockId, right: BlockId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function placementChanged(
  previousState: EditorCommandState,
  nextState: EditorCommandState,
  blockId: BlockId,
): boolean {
  const previous = previousState.blocks[blockId];
  const next = nextState.blocks[blockId];
  if (!previous || !next || previous.parentId !== next.parentId) return true;
  const previousSiblings =
    previous.parentId === null
      ? previousState.rootBlockIds
      : (previousState.childIdsByParentId[previous.parentId] ?? []);
  const nextSiblings =
    next.parentId === null
      ? nextState.rootBlockIds
      : (nextState.childIdsByParentId[next.parentId] ?? []);
  return previousSiblings.indexOf(blockId) !== nextSiblings.indexOf(blockId);
}
