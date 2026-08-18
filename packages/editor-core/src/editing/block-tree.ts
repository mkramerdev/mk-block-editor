import type {
  Block,
  BlockType,
  OrderedBlockGraph,
} from "../document/model/block.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import { getSubtreeBlockIds } from "../document/ordering/canonical-order.ts";
import type { BlockDefinition } from "../definitions/block-definition.ts";
import { isEditableFocusTarget } from "./focus/focus-targets.ts";

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
