import { richTextDocumentContentSize } from "@repo/editor-core/content/rich-text";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import {
  blockDefinitionAcceptsParent,
  blockDefinitionAcceptsSequence,
} from "@repo/editor-core/definitions";
import type {
  BlockPlacement,
  CanonicalBlockFragment,
  StructuralEditRange,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import type { CanonicalEditCompositionGraph } from "./canonical-edit-composition.ts";
import type { ResolvedStructuralEditComposition } from "./structural-composition.ts";

/**
 * Plans block-fragment acceptance for an ordinary-text typing trigger.
 *
 * Unlike general selection composition, trigger acceptance never joins text,
 * moves trailing content, or retargets fragment roots. The source text keeps
 * its identity unless removing the trigger empties it and the exact fragment
 * can replace it at the same direct sibling boundary.
 */
export function resolveTypingTriggerFragmentComposition(input: {
  readonly graph: CanonicalEditCompositionGraph;
  readonly sourceBlock: VersionedBlock;
  readonly range: { readonly from: number; readonly to: number };
  readonly graphRevision: number;
  readonly fragment: CanonicalBlockFragment;
}): ResolvedStructuralEditComposition | null {
  const { graph, sourceBlock, fragment } = input;
  const liveSource = graph.getBlock(sourceBlock.id);
  if (
    !liveSource ||
    liveSource.tombstone ||
    liveSource.type !== sourceBlock.type ||
    liveSource.contentVersion !== sourceBlock.contentVersion ||
    graph.blockDefinitions[liveSource.type]?.kind !== "text"
  ) {
    return null;
  }
  const content = graph.readBlockContent(liveSource.id, liveSource.type);
  const size = content ? richTextDocumentContentSize(content) : -1;
  if (
    !Number.isInteger(input.range.from) ||
    !Number.isInteger(input.range.to) ||
    input.range.from < 0 ||
    input.range.to < input.range.from ||
    input.range.to > size
  ) {
    return null;
  }
  const rootTypes = fragmentRootTypes(graph, fragment);
  if (!rootTypes || rootTypes.length === 0) return null;

  const remainingSize = size - (input.range.to - input.range.from);
  if (remainingSize === 0) {
    const replacement = replacementPlacement(graph, liveSource, rootTypes);
    if (replacement) {
      return {
        deletion: blockRange(liveSource, input.graphRevision),
        insertions: [{ placement: replacement, fragment }],
      };
    }
  }

  const placement = adjacentAncestorPlacement(graph, liveSource, rootTypes);
  if (!placement) return null;
  return {
    deletion: textRange(
      liveSource,
      input.range.from,
      input.range.to,
      input.graphRevision,
    ),
    insertions: [{ placement, fragment }],
  };
}

function fragmentRootTypes(
  graph: CanonicalEditCompositionGraph,
  fragment: CanonicalBlockFragment,
): readonly BlockType[] | null {
  const byId = new Map(fragment.blocks.map((record) => [record.id, record]));
  const result: BlockType[] = [];
  for (const rootId of fragment.rootBlockIds) {
    const record = byId.get(rootId);
    if (!record || !graph.blockDefinitions[record.type]) return null;
    result.push(record.type);
  }
  return result;
}

function replacementPlacement(
  graph: CanonicalEditCompositionGraph,
  source: VersionedBlock,
  rootTypes: readonly BlockType[],
): BlockPlacement | null {
  const siblings = childrenOf(graph, source.parentId);
  const index = siblings.indexOf(source.id);
  if (index < 0) return null;
  const currentTypes = siblingTypes(graph, siblings);
  if (!currentTypes) return null;
  const candidate = [...currentTypes];
  candidate.splice(index, 1, ...rootTypes);
  return boundaryAccepts(graph, source.parentId, candidate)
    ? { parentId: source.parentId, childIndex: index }
    : null;
}

function adjacentAncestorPlacement(
  graph: CanonicalEditCompositionGraph,
  source: VersionedBlock,
  rootTypes: readonly BlockType[],
): BlockPlacement | null {
  let cursor = source;
  while (true) {
    const siblings = childrenOf(graph, cursor.parentId);
    const index = siblings.indexOf(cursor.id);
    if (index < 0) return null;
    const currentTypes = siblingTypes(graph, siblings);
    if (!currentTypes) return null;
    const candidate = [...currentTypes];
    candidate.splice(index + 1, 0, ...rootTypes);
    if (boundaryAccepts(graph, cursor.parentId, candidate)) {
      return { parentId: cursor.parentId, childIndex: index + 1 };
    }
    if (cursor.parentId === null) return null;
    const parent = graph.getBlock(cursor.parentId);
    if (!parent || parent.tombstone) return null;
    cursor = parent;
  }
}

function boundaryAccepts(
  graph: CanonicalEditCompositionGraph,
  parentId: BlockId | null,
  candidateTypes: readonly BlockType[],
): boolean {
  if (parentId === null) {
    return candidateTypes.every((type) => {
      const definition = graph.blockDefinitions[type];
      return Boolean(
        definition && blockDefinitionAcceptsParent(definition, null),
      );
    });
  }
  const parent = graph.getBlock(parentId);
  const definition = parent ? graph.blockDefinitions[parent.type] : undefined;
  return Boolean(
    parent &&
    !parent.tombstone &&
    definition &&
    blockDefinitionAcceptsSequence(
      graph.blockDefinitions,
      definition,
      candidateTypes,
    ),
  );
}

function siblingTypes(
  graph: CanonicalEditCompositionGraph,
  siblings: readonly BlockId[],
): readonly BlockType[] | null {
  const result: BlockType[] = [];
  for (const blockId of siblings) {
    const block = graph.getBlock(blockId);
    if (!block || block.tombstone || !graph.blockDefinitions[block.type]) {
      return null;
    }
    result.push(block.type);
  }
  return result;
}

function childrenOf(
  graph: CanonicalEditCompositionGraph,
  parentId: BlockId | null,
): readonly BlockId[] {
  return parentId === null
    ? graph.getRootBlockIds()
    : graph.getChildBlockIds(parentId);
}

function textRange(
  block: VersionedBlock,
  from: number,
  to: number,
  graphRevision: number,
): StructuralEditRange {
  return {
    graphRevision,
    selectionRevision: 0,
    blocks: [
      {
        kind: "text",
        blockId: block.id,
        blockType: block.type,
        parentId: block.parentId,
        from,
        to,
        expectedContentVersion: block.contentVersion,
      },
    ],
    start: { kind: "text", blockId: block.id, offset: from },
    end: { kind: "text", blockId: block.id, offset: to },
  };
}

function blockRange(
  block: VersionedBlock,
  graphRevision: number,
): StructuralEditRange {
  return {
    graphRevision,
    selectionRevision: 0,
    blocks: [
      {
        kind: "block",
        blockId: block.id,
        blockType: block.type,
        parentId: block.parentId,
      },
    ],
    start: { kind: "block", blockId: block.id },
    end: { kind: "block", blockId: block.id },
  };
}
