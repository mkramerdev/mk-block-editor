import type {
  Block,
  BlockType,
  OrderedBlockGraph,
  VersionedBlock,
} from "../document/model/block.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import { getSubtreeBlockIds } from "../document/ordering/canonical-order.ts";
import type { BlockDefinition } from "../definitions/block-definition.ts";
import { isEditableFocusTarget } from "./focus/focus-targets.ts";

export function findTopLevelAncestorId(
  blocks: Record<BlockId, Block>,
  blockId: BlockId,
): BlockId {
  const first = blocks[blockId];
  if (!first) return blockId;
  let current: Block = first;
  const visited = new Set<BlockId>([first.id]);
  while (current.parentId) {
    if (visited.has(current.parentId)) {
      throw new Error(
        `cycle detected while resolving top-level ancestor for ${blockId}`,
      );
    }
    visited.add(current.parentId);
    const parent = blocks[current.parentId];
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

export function findFirstFocusableInSubtree(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  graph: OrderedBlockGraph<VersionedBlock>,
  blockId: BlockId,
): BlockId | null {
  for (const id of getSubtreeBlockIds(graph, blockId)) {
    const block = graph.blocks[id];
    if (block && isEditableFocusTarget(block.type, blockDefinitions)) return id;
  }
  return null;
}

export function findLastFocusableInSubtree(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  graph: OrderedBlockGraph<Block>,
  blockId: BlockId,
): BlockId | null {
  let lastFocusableBlockId: BlockId | null = null;
  for (const id of getSubtreeBlockIds(graph, blockId)) {
    const block = graph.blocks[id];
    if (block && isEditableFocusTarget(block.type, blockDefinitions)) {
      lastFocusableBlockId = id;
    }
  }
  return lastFocusableBlockId;
}

export function getAncestorIds(
  blocks: Record<BlockId, Block>,
  blockId: BlockId,
): ReadonlySet<BlockId> {
  const ids = new Set<BlockId>();
  let current = blocks[blockId];
  while (current?.parentId) {
    if (ids.has(current.parentId)) {
      throw new Error(`cycle detected while resolving ancestry for ${blockId}`);
    }
    ids.add(current.parentId);
    current = blocks[current.parentId];
  }
  return ids;
}

export function resolveEditableFocusTarget(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  graph: OrderedBlockGraph<Block>,
  blockId: BlockId,
): BlockId | null {
  const block = graph.blocks[blockId];
  if (!block || block.tombstone) {
    return null;
  }
  const definition = blockDefinitions[block.type];
  if (!definition) return null;
  if (definition.kind === "text" || definition.kind === "atomic") {
    return block.id;
  }
  let skippedRoot = false;
  for (const childId of getSubtreeBlockIds(
    graph,
    block.id,
  )) {
    if (!skippedRoot) {
      skippedRoot = true;
      continue;
    }
    const child = graph.blocks[childId];
    if (
      child &&
      !child.tombstone &&
      isEditableFocusTarget(child.type, blockDefinitions)
    ) {
      return child.id;
    }
  }
  return null;
}
