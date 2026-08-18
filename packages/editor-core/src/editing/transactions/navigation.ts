import { type BlockDefinition } from "../../definitions/block-definition.ts";
import {
  blockDefinitionAcceptsInsertion,
  blockDefinitionAcceptsParent,
} from "../../definitions/structural-queries.ts";
import type {
  BlockType,
  OrderedBlockGraph,
  VersionedBlock,
} from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { placementAtIndex } from "./boundary.ts";
import type { BlockPlacement } from "./types.ts";

export interface AdjacentInsertionNavigationInput
  extends OrderedBlockGraph<VersionedBlock> {
  readonly originBlockId: BlockId;
  readonly proposedType: BlockType;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
}

export type AdjacentInsertionNavigationResult =
  | {
      readonly ok: true;
      readonly placement: BlockPlacement;
      readonly remainsInsideDirectParent: boolean;
      readonly crossedAncestorIds: readonly BlockId[];
    }
  | {
      readonly ok: false;
      readonly reason: "missing-source" | "no-valid-placement";
    }
  | {
      readonly ok: false;
      readonly reason: "content-boundary";
      readonly boundaryBlockingWrapperId: BlockId;
      readonly crossedAncestorIds: readonly BlockId[];
    };

export function findAdjacentValidInsertionPlacement(
  input: AdjacentInsertionNavigationInput,
): AdjacentInsertionNavigationResult {
  const source = input.blocks[input.originBlockId];
  if (!source || source.tombstone) {
    return { ok: false, reason: "missing-source" };
  }
  const directParentId = source.parentId ?? null;
  const crossed: BlockId[] = [];
  let cursor = source;

  while (true) {
    const cursorDefinition = input.blockDefinitions[cursor.type];
    if (
      cursorDefinition?.kind === "wrapper" &&
      cursorDefinition.contentBoundary
    ) {
      return Object.freeze({
        ok: false,
        reason: "content-boundary",
        boundaryBlockingWrapperId: cursor.id,
        crossedAncestorIds: Object.freeze(
          crossed.filter((ancestorId) => ancestorId !== cursor.id),
        ),
      });
    }
    const parentId = cursor.parentId ?? null;
    const siblings = liveChildren(input, parentId);
    const cursorIndex = siblings.findIndex((block) => block.id === cursor.id);
    if (cursorIndex < 0) return { ok: false, reason: "missing-source" };
    const placement = placementAtIndex(input, parentId, cursorIndex + 1);
    if (
      placement &&
      acceptsInsertion(input, parentId, cursorIndex + 1, input.proposedType)
    ) {
      return Object.freeze({
        ok: true,
        placement,
        remainsInsideDirectParent: parentId === directParentId,
        crossedAncestorIds: Object.freeze([...crossed]),
      });
    }

    const following = siblings[cursorIndex + 1] ?? null;
    if (
      following &&
      !areParallelRepeatableContainers(input, cursor, following)
    ) {
      const descended = earliestCanonicalPlacement(input, following);
      if (descended) {
        return Object.freeze({
          ok: true,
          placement: descended,
          remainsInsideDirectParent: true,
          crossedAncestorIds: Object.freeze([...crossed]),
        });
      }
    }
    if (parentId === null) break;
    const parent = input.blocks[parentId];
    if (!parent || parent.tombstone) break;
    crossed.push(parent.id);
    cursor = parent;
  }
  return { ok: false, reason: "no-valid-placement" };
}

function areParallelRepeatableContainers(
  input: Pick<AdjacentInsertionNavigationInput, "blocks" | "blockDefinitions">,
  cursor: VersionedBlock,
  following: VersionedBlock,
): boolean {
  if (cursor.type !== following.type || cursor.parentId === null) return false;
  const parent = input.blocks[cursor.parentId];
  const parentDefinition = parent
    ? input.blockDefinitions[parent.type]
    : undefined;
  return (
    parentDefinition?.kind === "wrapper" &&
    parentDefinition.content?.additional === cursor.type
  );
}

function earliestCanonicalPlacement(
  input: AdjacentInsertionNavigationInput,
  container: VersionedBlock,
): BlockPlacement | null {
  let current = container;
  while (input.blockDefinitions[current.type]?.kind === "wrapper") {
    const placement = placementAtIndex(input, current.id, 0);
    if (
      placement &&
      acceptsInsertion(input, current.id, 0, input.proposedType)
    ) {
      return placement;
    }
    const first = liveChildren(input, current.id)[0] ?? null;
    if (!first) return null;
    current = first;
  }
  return null;
}

function acceptsInsertion(
  input: Pick<
    AdjacentInsertionNavigationInput,
    "blocks" | "rootBlockIds" | "childIdsByParentId" | "blockDefinitions"
  >,
  parentId: BlockId | null,
  index: number,
  proposedType: BlockType,
): boolean {
  if (parentId === null) {
    const proposed = input.blockDefinitions[proposedType];
    return Boolean(proposed && blockDefinitionAcceptsParent(proposed, null));
  }
  const parent = input.blocks[parentId];
  const definition = parent ? input.blockDefinitions[parent.type] : null;
  if (!definition) return false;
  return blockDefinitionAcceptsInsertion(
    input.blockDefinitions,
    definition,
    liveChildren(input, parentId).map((block) => block.type),
    index,
    proposedType,
  );
}

export function structuralPlacementAcceptsBlockType(input: {
  readonly placement: BlockPlacement;
  readonly proposedType: BlockType;
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
}): boolean {
  const siblings = liveChildren(input, input.placement.parentId);
  if (
    input.placement.childIndex < 0 ||
    input.placement.childIndex > siblings.length
  ) {
    return false;
  }
  return acceptsInsertion(
    input,
    input.placement.parentId,
    input.placement.childIndex,
    input.proposedType,
  );
}

function liveChildren(
  graph: OrderedBlockGraph<VersionedBlock>,
  parentId: BlockId | null,
): readonly VersionedBlock[] {
  const ids =
    parentId === null
      ? graph.rootBlockIds
      : (graph.childIdsByParentId[parentId] ?? []);
  return ids
    .map((id) => graph.blocks[id])
    .filter((block): block is VersionedBlock =>
      Boolean(block && !block.tombstone),
    );
}
