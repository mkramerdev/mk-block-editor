import type {
  OrderedBlockGraph,
  VersionedBlock,
} from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { BlockPlacement, ResolvedBlockPlacement } from "./types.ts";

export function childIdsAt(
  graph: OrderedBlockGraph<VersionedBlock>,
  parentId: BlockId | null,
): readonly BlockId[] {
  if (parentId !== null) {
    const parent = graph.blocks[parentId];
    if (!parent || parent.tombstone) return [];
  }
  return parentId === null
    ? graph.rootBlockIds
    : (graph.childIdsByParentId[parentId] ?? []);
}

export function validateBlockPlacement(
  graph: OrderedBlockGraph<VersionedBlock>,
  placement: BlockPlacement,
): boolean {
  if (placement.parentId !== null) {
    const parent = graph.blocks[placement.parentId];
    if (!parent || parent.tombstone) return false;
  }
  const ids = childIdsAt(graph, placement.parentId);
  return (
    Number.isInteger(placement.childIndex) &&
    placement.childIndex >= 0 &&
    placement.childIndex <= ids.length
  );
}

export function resolveBlockPlacement(
  graph: OrderedBlockGraph<VersionedBlock>,
  placement: BlockPlacement,
): ResolvedBlockPlacement | null {
  if (!validateBlockPlacement(graph, placement)) return null;
  const ids = childIdsAt(graph, placement.parentId);
  return Object.freeze({
    parentId: placement.parentId,
    childIndex: placement.childIndex,
    previousSiblingId: ids[placement.childIndex - 1] ?? null,
    nextSiblingId: ids[placement.childIndex] ?? null,
  });
}

export function placementAtIndex(
  graph: OrderedBlockGraph<VersionedBlock>,
  parentId: BlockId | null,
  childIndex: number,
): BlockPlacement | null {
  const placement = { parentId, childIndex };
  return validateBlockPlacement(graph, placement)
    ? Object.freeze(placement)
    : null;
}
