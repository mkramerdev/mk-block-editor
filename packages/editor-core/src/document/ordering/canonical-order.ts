import type {
  Block,
  OrderedBlockGraph,
} from "../model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";

export interface CanonicalOrderContext<BlockRecord extends Block = Block> {
  readonly order: readonly BlockRecord[];
  readonly blockIds: readonly BlockId[];
  readonly liveById: ReadonlyMap<BlockId, BlockRecord>;
  readonly ancestorChainById: ReadonlyMap<BlockId, readonly BlockId[]>;
}

export interface CanonicalSubtreeOrderBounds<BlockRecord extends Block = Block> {
  readonly first: BlockRecord;
  readonly last: BlockRecord;
  readonly nextAfterSubtree: BlockRecord | null;
}

export function deriveCanonicalOrderContext<BlockRecord extends Block>(
  graph: OrderedBlockGraph<BlockRecord>,
): CanonicalOrderContext<BlockRecord> {
  const liveById = new Map<BlockId, BlockRecord>();
  for (const block of Object.values(graph.blocks) as BlockRecord[]) {
    if (!block.tombstone) liveById.set(block.id, block);
  }

  const order: BlockRecord[] = [];
  const ancestorChainById = new Map<BlockId, readonly BlockId[]>();
  const contained = new Set<BlockId>();
  const visiting = new Set<BlockId>();
  assertContainmentAcyclic(graph);

  const visit = (
    blockId: BlockId,
    expectedParentId: BlockId | null,
    ancestors: readonly BlockId[],
  ): void => {
    if (visiting.has(blockId)) {
      throw new Error(`containment cycle includes block ${blockId}`);
    }
    if (contained.has(blockId)) {
      throw new Error(`block ${blockId} appears more than once in containment`);
    }
    const block = graph.blocks[blockId] as BlockRecord | undefined;
    if (!block) throw new Error(`containment references unknown block ${blockId}`);
    if (block.tombstone) {
      throw new Error(`tombstoned block ${blockId} appears in live containment`);
    }
    if ((block.parentId ?? null) !== expectedParentId) {
      throw new Error(
        `block ${blockId} parent ${String(block.parentId)} disagrees with containment parent ${String(expectedParentId)}`,
      );
    }

    visiting.add(blockId);
    contained.add(blockId);
    order.push(block);
    ancestorChainById.set(blockId, ancestors);
    for (const childId of graph.childIdsByParentId[blockId] ?? []) {
      visit(childId, blockId, [...ancestors, blockId]);
    }
    visiting.delete(blockId);
  };

  const rootIds = new Set<BlockId>();
  for (const rootId of graph.rootBlockIds) {
    if (rootIds.has(rootId)) {
      throw new Error(`root block ${rootId} appears more than once`);
    }
    rootIds.add(rootId);
    visit(rootId, null, []);
  }

  for (const [parentId, childIds] of Object.entries(
    graph.childIdsByParentId,
  ) as [BlockId, readonly BlockId[] | undefined][]) {
    const parent = graph.blocks[parentId] as BlockRecord | undefined;
    if (!parent) {
      throw new Error(`child sequence references unknown parent ${parentId}`);
    }
    if (parent.tombstone) {
      throw new Error(`tombstoned block ${parentId} owns a live child sequence`);
    }
    if (!childIds || childIds.length === 0) continue;
    const seen = new Set<BlockId>();
    for (const childId of childIds) {
      if (seen.has(childId)) {
        throw new Error(`parent ${parentId} contains duplicate child ${childId}`);
      }
      seen.add(childId);
    }
  }

  for (const block of liveById.values()) {
    if (!contained.has(block.id)) {
      throw new Error(`live block ${block.id} is unreachable from the roots`);
    }
  }

  return {
    order,
    blockIds: order.map((block) => block.id),
    liveById,
    ancestorChainById,
  };
}

function assertContainmentAcyclic<BlockRecord extends Block>(
  graph: OrderedBlockGraph<BlockRecord>,
): void {
  const visiting = new Set<BlockId>();
  const visited = new Set<BlockId>();
  const visit = (blockId: BlockId): void => {
    if (visiting.has(blockId)) {
      throw new Error(`containment cycle includes block ${blockId}`);
    }
    if (visited.has(blockId)) return;
    visiting.add(blockId);
    for (const childId of graph.childIdsByParentId[blockId] ?? []) {
      visit(childId);
    }
    visiting.delete(blockId);
    visited.add(blockId);
  };
  for (const blockId of Object.keys(graph.blocks) as BlockId[]) visit(blockId);
}

export function getCanonicalBlockOrder<BlockRecord extends Block>(
  graph: OrderedBlockGraph<BlockRecord>,
): BlockId[] {
  return [...deriveCanonicalOrderContext(graph).blockIds];
}

export function getLiveBlocksInCanonicalOrder<BlockRecord extends Block>(
  graph: OrderedBlockGraph<BlockRecord>,
): BlockRecord[] {
  return [...deriveCanonicalOrderContext(graph).order];
}

export function getDirectChildren<BlockRecord extends Block>(
  graph: OrderedBlockGraph<BlockRecord>,
  parentId: BlockId | null,
): BlockRecord[] {
  const childIds =
    parentId === null
      ? graph.rootBlockIds
      : (graph.childIdsByParentId[parentId] ?? []);
  return childIds.map((blockId) => {
    const block = graph.blocks[blockId] as BlockRecord | undefined;
    if (!block || block.tombstone) {
      throw new Error(`ordered containment references unavailable block ${blockId}`);
    }
    return block;
  });
}

export function getSubtreeBlockIds<BlockRecord extends Block>(
  graph: OrderedBlockGraph<BlockRecord>,
  blockId: BlockId,
): BlockId[] {
  return getSubtreeBlockIdsFromContext(
    deriveCanonicalOrderContext(graph),
    blockId,
  );
}

export function getSubtreeBlockIdsFromContext<BlockRecord extends Block>(
  context: CanonicalOrderContext<BlockRecord>,
  blockId: BlockId,
): BlockId[] {
  return getSubtreeBlocksFromContext(context, blockId).map((block) => block.id);
}

export function getSubtreeOrderBounds<BlockRecord extends Block>(
  graph: OrderedBlockGraph<BlockRecord>,
  blockId: BlockId,
): CanonicalSubtreeOrderBounds<BlockRecord> {
  return getSubtreeOrderBoundsFromContext(
    deriveCanonicalOrderContext(graph),
    blockId,
  );
}

export function getSubtreeOrderBoundsFromContext<BlockRecord extends Block>(
  context: CanonicalOrderContext<BlockRecord>,
  blockId: BlockId,
): CanonicalSubtreeOrderBounds<BlockRecord> {
  const subtreeBlocks = getSubtreeBlocksFromContext(context, blockId);
  const first = subtreeBlocks[0];
  const last = subtreeBlocks.at(-1);
  if (!first || !last) throw new Error(`subtree ${blockId} has no live blocks`);
  const lastIndex = context.blockIds.indexOf(last.id);
  return {
    first,
    last,
    nextAfterSubtree: context.order[lastIndex + 1] ?? null,
  };
}

export function getPreviousLiveBlock<BlockRecord extends Block>(
  graph: OrderedBlockGraph<BlockRecord>,
  blockId: BlockId,
): BlockRecord | null {
  const context = deriveCanonicalOrderContext(graph);
  const index = findLiveBlockIndex(context, blockId);
  return index > 0 ? (context.order[index - 1] ?? null) : null;
}

export function getNextLiveBlock<BlockRecord extends Block>(
  graph: OrderedBlockGraph<BlockRecord>,
  blockId: BlockId,
): BlockRecord | null {
  const context = deriveCanonicalOrderContext(graph);
  const index = findLiveBlockIndex(context, blockId);
  return context.order[index + 1] ?? null;
}

export function isDescendantOf<BlockRecord extends Block>(
  graph: OrderedBlockGraph<BlockRecord>,
  blockId: BlockId,
  ancestorId: BlockId,
): boolean {
  return (
    deriveCanonicalOrderContext(graph).ancestorChainById.get(blockId) ?? []
  ).includes(ancestorId);
}

export function getParentChain<BlockRecord extends Block>(
  graph: OrderedBlockGraph<BlockRecord>,
  blockId: BlockId,
): BlockId[] {
  return [
    ...(deriveCanonicalOrderContext(graph).ancestorChainById.get(blockId) ?? []),
  ];
}

export function deriveBlockNestingLevel<BlockRecord extends Block>(
  graph: OrderedBlockGraph<BlockRecord>,
  blockId: BlockId,
): number {
  return getParentChain(graph, blockId).length;
}

function findLiveBlockIndex<BlockRecord extends Block>(
  context: CanonicalOrderContext<BlockRecord>,
  blockId: BlockId,
): number {
  const index = context.blockIds.indexOf(blockId);
  if (index < 0) throw new Error(`block ${blockId} is not live`);
  return index;
}

function getSubtreeBlocksFromContext<BlockRecord extends Block>(
  context: CanonicalOrderContext<BlockRecord>,
  blockId: BlockId,
): BlockRecord[] {
  const startIndex = findLiveBlockIndex(context, blockId);
  const subtreeBlocks: BlockRecord[] = [];
  for (let index = startIndex; index < context.order.length; index += 1) {
    const candidate = context.order[index];
    if (!candidate) break;
    if (
      index !== startIndex &&
      !(context.ancestorChainById.get(candidate.id) ?? []).includes(blockId)
    ) {
      break;
    }
    subtreeBlocks.push(candidate);
  }
  return subtreeBlocks;
}
