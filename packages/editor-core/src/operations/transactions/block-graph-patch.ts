import type {
  Block,
  OrderedBlockGraph,
  VersionedBlock,
} from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { BlockGraphPatch } from "../language/block-graph.ts";
import type { EditorBlockContentOperationBatch } from "../language/logical-operations.ts";
import { normalizeBlockMetadata } from "../../metadata/validation.ts";
import { getCanonicalBlockOrder } from "../../document/ordering/canonical-order.ts";
import { cloneJsonValue } from "../../kernel/json/json-value.ts";

const versionedBlockFieldNames = new Set([
  "id",
  "type",
  "parentId",
  "metadataVersion",
  "contentVersion",
  "tombstone",
  "metadata",
]);

export interface BlockGraphMutationResult extends OrderedBlockGraph<VersionedBlock> {
  readonly patch: BlockGraphPatch;
  readonly contentOperations: readonly EditorBlockContentOperationBatch[];
}

export function applyBlockGraphPatch(
  graph: OrderedBlockGraph<VersionedBlock>,
  patch: BlockGraphPatch,
  options: {
    contentOperations?: readonly EditorBlockContentOperationBatch[];
    removedBlockTombstone?: Block["tombstone"];
  } = {},
): BlockGraphMutationResult {
  const blocks = { ...graph.blocks };
  for (const blockId of patch.removedBlockIds ?? []) {
    const block = blocks[blockId];
    if (!block) continue;
    if (!options.removedBlockTombstone) {
      throw new Error(
        "block graph patch removedBlockIds requires tombstone metadata",
      );
    }
    blocks[blockId] = {
      ...block,
      tombstone: options.removedBlockTombstone,
    };
  }
  for (const block of patch.upsertedBlocks) {
    blocks[block.id] = cloneBlock(block);
  }
  const nextGraph = {
    blocks,
    rootBlockIds: [...patch.rootBlockIds],
    childIdsByParentId: cloneChildSequences(patch.childIdsByParentId),
  };
  getCanonicalBlockOrder(nextGraph);
  return {
    ...nextGraph,
    patch: cloneBlockGraphPatch(patch),
    contentOperations: cloneJsonValue(options.contentOperations ?? []),
  };
}

export function createBlockGraphPatch(
  previousGraph: OrderedBlockGraph<VersionedBlock>,
  nextGraph: OrderedBlockGraph<VersionedBlock>,
): BlockGraphPatch {
  const structurallyMovedBlockIds = movedBlockIds(previousGraph, nextGraph);
  const affectedBlockIds = new Set<BlockId>();
  const upsertedBlocks: VersionedBlock[] = [];
  const removedBlockIds: BlockId[] = [];
  for (const blockId of Object.keys(previousGraph.blocks) as BlockId[]) {
    if (!nextGraph.blocks[blockId]) {
      removedBlockIds.push(blockId);
      affectedBlockIds.add(blockId);
    }
  }
  for (const blockId of Object.keys(nextGraph.blocks) as BlockId[]) {
    const nextBlock = nextGraph.blocks[blockId];
    if (!nextBlock) continue;
    if (
      previousGraph.blocks[blockId] !== nextBlock ||
      structurallyMovedBlockIds.has(blockId)
    ) {
      upsertedBlocks.push(cloneBlock(nextBlock));
      affectedBlockIds.add(blockId);
    }
  }
  const nextOrder = getCanonicalBlockOrder(nextGraph);
  const previousOrder = getCanonicalBlockOrder(previousGraph);
  const nextIndex = indexOrder(nextOrder);
  const previousIndex = indexOrder(previousOrder);
  upsertedBlocks.sort(
    (left, right) =>
      (nextIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (nextIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
  removedBlockIds.sort(
    (left, right) =>
      (previousIndex.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (previousIndex.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
  const orderedAffected = orderedAffectedBlockIds(
    affectedBlockIds,
    nextOrder,
    removedBlockIds,
  );
  return {
    affectedBlockIds: orderedAffected,
    upsertedBlocks,
    removedBlockIds,
    rootBlockIds: [...nextGraph.rootBlockIds],
    childIdsByParentId: cloneChildSequences(nextGraph.childIdsByParentId),
    resolvedPlacements: orderedAffected.flatMap((blockId) =>
      resolvedPlacement(nextGraph, blockId),
    ),
  };
}

export function cloneBlock(block: VersionedBlock): VersionedBlock {
  assertVersionedBlockFieldSet(block);
  const { metadata: rawMetadata, tombstone: rawTombstone, ...rest } = block;
  const metadata = normalizeBlockMetadata(rawMetadata);
  return {
    ...rest,
    tombstone:
      rawTombstone === null
        ? null
        : rawTombstone
          ? cloneJsonValue(rawTombstone)
          : rawTombstone,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function assertVersionedBlockFieldSet(block: VersionedBlock): void {
  for (const fieldName of Object.keys(
    block as unknown as Record<string, unknown>,
  )) {
    if (versionedBlockFieldNames.has(fieldName)) continue;
    throw new Error(
      `block graph patch block ${block.id} contains unsupported versioned field ${fieldName}`,
    );
  }
}

function indexOrder(order: readonly BlockId[]): Map<BlockId, number> {
  return new Map(order.map((blockId, index) => [blockId, index]));
}

function orderedAffectedBlockIds(
  affectedBlockIds: ReadonlySet<BlockId>,
  nextOrder: readonly BlockId[],
  removedBlockIds: readonly BlockId[],
): BlockId[] {
  return [
    ...nextOrder.filter((blockId) => affectedBlockIds.has(blockId)),
    ...removedBlockIds.filter(
      (blockId) =>
        affectedBlockIds.has(blockId) && !nextOrder.includes(blockId),
    ),
  ];
}

function cloneBlockGraphPatch(patch: BlockGraphPatch): BlockGraphPatch {
  return {
    affectedBlockIds: [...patch.affectedBlockIds],
    upsertedBlocks: patch.upsertedBlocks.map(cloneBlock),
    removedBlockIds:
      patch.removedBlockIds === undefined
        ? undefined
        : [...patch.removedBlockIds],
    rootBlockIds: [...patch.rootBlockIds],
    childIdsByParentId: cloneChildSequences(patch.childIdsByParentId),
    resolvedPlacements: patch.resolvedPlacements?.map((placement) => ({
      ...placement,
    })),
  };
}

function resolvedPlacement(
  graph: OrderedBlockGraph<VersionedBlock>,
  blockId: BlockId,
) {
  const block = graph.blocks[blockId];
  if (!block || block.tombstone) return [];
  const ids = siblingIds(graph, block.parentId);
  const childIndex = ids.indexOf(blockId);
  return childIndex < 0
    ? []
    : [
        {
          blockId,
          parentId: block.parentId,
          childIndex,
          previousSiblingId: ids[childIndex - 1] ?? null,
          nextSiblingId: ids[childIndex + 1] ?? null,
        },
      ];
}

function movedBlockIds(
  previousGraph: OrderedBlockGraph<VersionedBlock>,
  nextGraph: OrderedBlockGraph<VersionedBlock>,
): ReadonlySet<BlockId> {
  const moved = new Set<BlockId>();
  const parentIds = new Set<BlockId | null>([null]);
  for (const parentId of Object.keys(
    previousGraph.childIdsByParentId,
  ) as BlockId[]) {
    parentIds.add(parentId);
  }
  for (const parentId of Object.keys(
    nextGraph.childIdsByParentId,
  ) as BlockId[]) {
    parentIds.add(parentId);
  }
  for (const parentId of parentIds) {
    const previousIds = siblingIds(previousGraph, parentId).filter(
      (blockId) => nextGraph.blocks[blockId]?.parentId === parentId,
    );
    const nextIds = siblingIds(nextGraph, parentId).filter(
      (blockId) => previousGraph.blocks[blockId]?.parentId === parentId,
    );
    const stable = new Set(longestCommonSubsequence(previousIds, nextIds));
    for (const blockId of nextIds) {
      if (!stable.has(blockId)) moved.add(blockId);
    }
  }
  return moved;
}

function longestCommonSubsequence(
  left: readonly BlockId[],
  right: readonly BlockId[],
): readonly BlockId[] {
  const lengths = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      lengths[leftIndex]![rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? 1 + lengths[leftIndex + 1]![rightIndex + 1]!
          : Math.max(
              lengths[leftIndex + 1]![rightIndex]!,
              lengths[leftIndex]![rightIndex + 1]!,
            );
    }
  }
  const result: BlockId[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      result.push(left[leftIndex]!);
      leftIndex += 1;
      rightIndex += 1;
    } else if (
      lengths[leftIndex + 1]![rightIndex]! >=
      lengths[leftIndex]![rightIndex + 1]!
    ) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return result;
}

function siblingIds(
  graph: OrderedBlockGraph<VersionedBlock>,
  parentId: BlockId | null,
): readonly BlockId[] {
  return parentId === null
    ? graph.rootBlockIds
    : (graph.childIdsByParentId[parentId] ?? []);
}

function cloneChildSequences(
  value: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>,
): Partial<Record<BlockId, BlockId[]>> {
  return Object.fromEntries(
    Object.entries(value).map(([parentId, childIds]) => [
      parentId,
      [...(childIds ?? [])],
    ]),
  ) as Partial<Record<BlockId, BlockId[]>>;
}
