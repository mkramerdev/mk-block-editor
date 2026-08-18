import {
  concatenateRichTextDocuments,
  extractPlainTextFromRichTextDocument,
  richTextDocumentContentSize,
  sliceRichTextDocument,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import {
  blockDefinitionAcceptsSequence,
  type BlockDefinition,
} from "@repo/editor-core/definitions";
import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  type BlockPlacement,
  type CanonicalBlockFragment,
  type StructuralEditRange,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import type { ResolvedStructuralEditComposition } from "./structural-composition.ts";

export interface CanonicalEditCompositionGraph {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  getBlock(blockId: BlockId): VersionedBlock | null;
  getRootBlockIds(): readonly BlockId[];
  getChildBlockIds(parentId: BlockId): readonly BlockId[];
  readBlockContent(
    blockId: BlockId,
    blockType: BlockType,
  ): RichTextDocumentNodeJson | null;
}

export type CanonicalEditTarget =
  | { readonly kind: "selection"; readonly range: StructuralEditRange }
  | {
      readonly kind: "caret";
      readonly blockId: BlockId;
      readonly offset: number | null;
      readonly graphRevision: number;
      readonly expectedContentVersion: string | null;
    }
  | {
      readonly kind: "placement";
      readonly placement: BlockPlacement;
    };

/** Resolves origin-independent insertion structure. */
export function resolveCanonicalEditComposition(input: {
  readonly graph: CanonicalEditCompositionGraph;
  readonly target: CanonicalEditTarget;
  readonly fragment: CanonicalBlockFragment;
}): ResolvedStructuralEditComposition | null {
  const rootTypes = canonicalFragmentRootTypes(input.fragment);
  if (input.target.kind === "placement") {
    const finalSelection = fragmentTextEndpoint(input.fragment);
    return {
      insertions: [
        {
          placement: input.target.placement,
          fragment: input.fragment,
        },
      ],
      ...(finalSelection ? { finalSelection } : {}),
    };
  }
  if (input.target.kind === "caret") {
    return resolveCaretComposition(
      input.graph,
      input.target,
      input.fragment,
      rootTypes,
    );
  }
  return resolveSelectionComposition(
    input.graph,
    input.target.range,
    input.fragment,
    rootTypes,
  );
}

function canonicalFragmentRootTypes(
  fragment: CanonicalBlockFragment,
): readonly BlockType[] {
  const blockById = new Map(fragment.blocks.map((block) => [block.id, block]));
  return Object.freeze(
    fragment.rootBlockIds.flatMap((rootId) => {
      const record = blockById.get(rootId);
      return record ? [record.type] : [];
    }),
  );
}

function resolveCaretComposition(
  graph: CanonicalEditCompositionGraph,
  target: Extract<CanonicalEditTarget, { kind: "caret" }>,
  inputFragment: CanonicalBlockFragment,
  rootTypes: readonly BlockType[],
): ResolvedStructuralEditComposition | null {
  const block = graph.getBlock(target.blockId);
  if (!block || block.tombstone) return null;
  const definition = graph.blockDefinitions[block.type];
  let fragment = inputFragment;
  if (
    definition?.kind === "text" &&
    target.offset !== null &&
    !directPlacementAccepts(graph, block, rootTypes, true)
  ) {
    const retargeted = retargetOpenRootTextRecords(graph, fragment, block.type);
    if (!retargeted) return null;
    fragment = retargeted;
  }
  if (definition?.kind !== "text" || target.offset === null) {
    const placement = placementForRootTypes(graph, block, rootTypes, true);
    if (!placement) return null;
    return {
      insertions: [
        {
          placement,
          fragment,
        },
      ],
    };
  }
  const content = graph.readBlockContent(block.id, block.type);
  if (!content || block.contentVersion !== target.expectedContentVersion)
    return null;
  const size = richTextDocumentContentSize(content);
  if (
    !Number.isInteger(target.offset) ||
    target.offset < 0 ||
    target.offset > size
  )
    return null;
  const pastedEndpoint = fragmentTextEndpoint(fragment);
  if (size === 0 && !boundaryTargetsRoot(fragment, fragment.start)) {
    const replacementPlacement = replacementPlacementForRootTypes(
      graph,
      block,
      canonicalFragmentRootTypes(fragment),
    );
    if (replacementPlacement) {
      return {
        deletion: blockRange(block, target.graphRevision),
        insertions: [{ placement: replacementPlacement, fragment }],
        ...(pastedEndpoint ? { finalSelection: pastedEndpoint } : {}),
      };
    }
  }
  const suffix = sliceRichTextDocument(
    block.type,
    content,
    target.offset,
    size,
  );
  const fragmentWithSuffix = attachTrailingContent(
    graph,
    fragment,
    block.type,
    suffix,
  );
  if (!fragmentWithSuffix) return null;
  fragment = fragmentWithSuffix;
  const placement = placementForRootTypes(
    graph,
    block,
    canonicalFragmentRootTypes(fragment),
    true,
  );
  if (!placement) return null;
  const deletion =
    target.offset < size
      ? textTailRange(block, target.offset, size, target.graphRevision)
      : undefined;
  const joins = boundaryTargetsRoot(fragment, fragment.start)
    ? [
        {
          leftBlockId: block.id,
          rightBlockId: fragment.start.blockId,
        },
      ]
    : undefined;
  const finalSelection = mapEndpointThroughStartJoin(
    pastedEndpoint,
    fragment,
    block.id,
    target.offset,
  );
  return {
    ...(deletion ? { deletion } : {}),
    insertions: [
      {
        placement,
        fragment,
      },
    ],
    ...(joins ? { joins } : {}),
    ...(finalSelection ? { finalSelection } : {}),
  };
}

function replacementPlacementForRootTypes(
  graph: CanonicalEditCompositionGraph,
  origin: VersionedBlock,
  insertedTypes: readonly BlockType[],
): BlockPlacement | null {
  const siblings = directChildren(graph, origin.parentId);
  const originIndex = siblings.indexOf(origin.id);
  if (originIndex < 0) return null;
  if (origin.parentId === null) {
    return insertedTypes.every(
      (type) => graph.blockDefinitions[type] !== undefined,
    )
      ? { parentId: null, childIndex: originIndex }
      : null;
  }
  const parent = graph.getBlock(origin.parentId);
  const definition = parent ? graph.blockDefinitions[parent.type] : undefined;
  if (!parent || parent.tombstone || !definition) return null;
  const candidateTypes = siblings.map(
    (blockId) => graph.getBlock(blockId)?.type ?? "",
  );
  if (candidateTypes.some((type) => !graph.blockDefinitions[type])) return null;
  candidateTypes.splice(originIndex, 1, ...insertedTypes);
  return blockDefinitionAcceptsSequence(
    graph.blockDefinitions,
    definition,
    candidateTypes,
  )
    ? { parentId: origin.parentId, childIndex: originIndex }
    : null;
}

function resolveSelectionComposition(
  graph: CanonicalEditCompositionGraph,
  inputRange: StructuralEditRange,
  inputFragment: CanonicalBlockFragment,
  rootTypes: readonly BlockType[],
): ResolvedStructuralEditComposition | null {
  const first = inputRange.blocks[0];
  const last = inputRange.blocks.at(-1);
  if (!first || !last) return null;
  const firstBlock = graph.getBlock(first.blockId);
  const lastBlock = graph.getBlock(last.blockId);
  if (!firstBlock || !lastBlock || firstBlock.tombstone || lastBlock.tombstone)
    return null;

  let range = inputRange;
  let fragment = inputFragment;
  if (
    graph.blockDefinitions[firstBlock.type]?.kind === "text" &&
    !directPlacementAccepts(
      graph,
      firstBlock,
      rootTypes,
      first.kind !== "block",
    )
  ) {
    const retargeted = retargetOpenRootTextRecords(
      graph,
      fragment,
      firstBlock.type,
    );
    if (!retargeted) return null;
    fragment = retargeted;
  }
  const pastedEndpoint = fragmentTextEndpoint(fragment);
  if (
    first.blockId === last.blockId &&
    first.kind === "text" &&
    last.kind === "text"
  ) {
    const content = graph.readBlockContent(last.blockId, last.blockType);
    if (!content) return null;
    const size = richTextDocumentContentSize(content);
    if (
      size === 0 &&
      first.from === 0 &&
      last.to === 0 &&
      !boundaryTargetsRoot(fragment, fragment.start)
    ) {
      const replacementPlacement = replacementPlacementForRootTypes(
        graph,
        firstBlock,
        canonicalFragmentRootTypes(fragment),
      );
      if (replacementPlacement) {
        return {
          deletion: blockRange(firstBlock, inputRange.graphRevision),
          insertions: [{ placement: replacementPlacement, fragment }],
          ...(pastedEndpoint ? { finalSelection: pastedEndpoint } : {}),
        };
      }
    }
    const suffix = sliceRichTextDocument(
      last.blockType,
      content,
      last.to,
      size,
    );
    const fragmentWithSuffix = attachTrailingContent(
      graph,
      fragment,
      last.blockType,
      suffix,
    );
    if (!fragmentWithSuffix) return null;
    fragment = fragmentWithSuffix;
    range = {
      ...range,
      blocks: Object.freeze([{ ...last, to: size }]),
      end: { kind: "text", blockId: last.blockId, offset: size },
    };
  }

  const firstSurvives = first.kind !== "block";
  const placement = placementForRootTypes(
    graph,
    firstBlock,
    canonicalFragmentRootTypes(fragment),
    firstSurvives,
  );
  if (!placement) return null;
  const joins: Array<{ leftBlockId: BlockId; rightBlockId: BlockId }> = [];
  if (firstSurvives && boundaryTargetsRoot(fragment, fragment.start)) {
    joins.push({
      leftBlockId: first.blockId,
      rightBlockId: fragment.start.blockId,
    });
  }
  const lastSurvives = last.kind !== "block";
  if (
    first.blockId !== last.blockId &&
    lastSurvives &&
    boundaryTargetsRoot(fragment, fragment.end)
  ) {
    joins.push({
      leftBlockId:
        joins.length > 0 && fragment.start.blockId === fragment.end.blockId
          ? first.blockId
          : fragment.end.blockId,
      rightBlockId: last.blockId,
    });
  }
  const finalSelection = firstSurvives
    ? mapEndpointThroughStartJoin(
        pastedEndpoint,
        fragment,
        first.blockId,
        first.kind === "text" ? first.from : 0,
      )
    : pastedEndpoint;
  return {
    deletion: range,
    insertions: [{ placement, fragment }],
    ...(joins.length > 0 ? { joins: Object.freeze(joins) } : {}),
    ...(finalSelection ? { finalSelection } : {}),
  };
}

function fragmentTextEndpoint(
  fragment: CanonicalBlockFragment,
): Extract<
  NonNullable<ResolvedStructuralEditComposition["finalSelection"]>,
  { readonly kind: "text" }
> | null {
  if (fragment.end.kind !== "text") return null;
  const record = fragment.blocks.find(
    (candidate) => candidate.id === fragment.end.blockId,
  );
  return record?.content
    ? {
        kind: "text",
        blockId: record.id,
        offset: richTextDocumentContentSize(record.content),
      }
    : null;
}

function mapEndpointThroughStartJoin(
  endpoint: ReturnType<typeof fragmentTextEndpoint>,
  fragment: CanonicalBlockFragment,
  survivorBlockId: BlockId,
  prefixLength: number,
): ReturnType<typeof fragmentTextEndpoint> {
  if (
    !endpoint ||
    !boundaryTargetsRoot(fragment, fragment.start) ||
    endpoint.blockId !== fragment.start.blockId
  ) {
    return endpoint;
  }
  return {
    kind: "text",
    blockId: survivorBlockId,
    offset: prefixLength + endpoint.offset,
  };
}

function retargetOpenRootTextRecords(
  graph: CanonicalEditCompositionGraph,
  fragment: CanonicalBlockFragment,
  targetType: BlockType,
): CanonicalBlockFragment | null {
  if (fragment.start.kind !== "text") return fragment;
  const targetDefinition = graph.blockDefinitions[targetType];
  if (targetDefinition?.kind !== "text") return null;
  const roots = new Set(fragment.rootBlockIds);
  let changed = false;
  const blocks = fragment.blocks.map((record) => {
    if (
      !roots.has(record.id) ||
      graph.blockDefinitions[record.type]?.kind !== "text" ||
      record.type === targetType
    )
      return record;
    changed = true;
    return { ...record, type: targetType };
  });
  if (!changed) return fragment;
  try {
    return createCanonicalBlockFragment({
      ...fragment,
      blocks,
      blockDefinitions: graph.blockDefinitions,
    });
  } catch {
    return null;
  }
}

function placementForRootTypes(
  graph: CanonicalEditCompositionGraph,
  origin: VersionedBlock,
  insertedTypes: readonly BlockType[],
  afterOrigin: boolean,
): BlockPlacement | null {
  let cursor = origin;
  let after = afterOrigin;
  while (true) {
    const siblings = directChildren(graph, cursor.parentId);
    const cursorIndex = siblings.indexOf(cursor.id);
    if (cursorIndex < 0) return null;
    const childIndex = cursorIndex + (after ? 1 : 0);
    if (
      acceptsRootSequence(graph, cursor.parentId, childIndex, insertedTypes)
    ) {
      return { parentId: cursor.parentId, childIndex };
    }
    if (cursor.parentId === null) return null;
    const parent = graph.getBlock(cursor.parentId);
    if (!parent || parent.tombstone) return null;
    cursor = parent;
    after = true;
  }
}

function directPlacementAccepts(
  graph: CanonicalEditCompositionGraph,
  origin: VersionedBlock,
  insertedTypes: readonly BlockType[],
  afterOrigin: boolean,
): boolean {
  const siblings = directChildren(graph, origin.parentId);
  const originIndex = siblings.indexOf(origin.id);
  if (originIndex < 0) return false;
  return acceptsRootSequence(
    graph,
    origin.parentId,
    originIndex + (afterOrigin ? 1 : 0),
    insertedTypes,
  );
}

function acceptsRootSequence(
  graph: CanonicalEditCompositionGraph,
  parentId: BlockId | null,
  childIndex: number,
  insertedTypes: readonly BlockType[],
): boolean {
  if (parentId === null)
    return insertedTypes.every(
      (type) => graph.blockDefinitions[type] !== undefined,
    );
  const parent = graph.getBlock(parentId);
  if (!parent || parent.tombstone) return false;
  const definition = graph.blockDefinitions[parent.type];
  if (!definition) return false;
  const currentTypes = directChildren(graph, parentId).map(
    (blockId) => graph.getBlock(blockId)?.type ?? "",
  );
  if (
    childIndex < 0 ||
    childIndex > currentTypes.length ||
    currentTypes.some((type) => !graph.blockDefinitions[type])
  )
    return false;
  const candidate = [...currentTypes];
  candidate.splice(childIndex, 0, ...insertedTypes);
  return blockDefinitionAcceptsSequence(
    graph.blockDefinitions,
    definition,
    candidate,
  );
}

function attachTrailingContent(
  graph: CanonicalEditCompositionGraph,
  fragment: CanonicalBlockFragment,
  suffixType: BlockType,
  suffix: RichTextDocumentNodeJson,
): CanonicalBlockFragment | null {
  if (richTextDocumentContentSize(suffix) === 0) return fragment;
  if (boundaryTargetsRoot(fragment, fragment.end)) {
    const blocks = fragment.blocks.map((record) => {
      if (record.id !== fragment.end.blockId || !record.content) return record;
      const content = concatenateRichTextDocuments(
        record.type,
        record.content,
        suffix,
      );
      return {
        ...record,
        content,
        plainText: extractPlainTextFromRichTextDocument(content),
      };
    });
    try {
      return createCanonicalBlockFragment({
        ...fragment,
        blocks,
        blockDefinitions: graph.blockDefinitions,
      });
    } catch {
      return null;
    }
  }
  const suffixRecord = createCanonicalBlockRecord({
    type: suffixType,
    parentId: null,
    content: suffix,
    plainText: extractPlainTextFromRichTextDocument(suffix),
  });
  try {
    return createCanonicalBlockFragment({
      blocks: [...fragment.blocks, suffixRecord],
      rootBlockIds: [...fragment.rootBlockIds, suffixRecord.id],
      start: fragment.start,
      end: { kind: "text", blockId: suffixRecord.id },
      blockDefinitions: graph.blockDefinitions,
    });
  } catch {
    return null;
  }
}

function boundaryTargetsRoot(
  fragment: CanonicalBlockFragment,
  boundary: CanonicalBlockFragment["start"],
): boolean {
  return (
    boundary.kind === "text" && fragment.rootBlockIds.includes(boundary.blockId)
  );
}

function textTailRange(
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

function directChildren(
  graph: CanonicalEditCompositionGraph,
  parentId: BlockId | null,
): readonly BlockId[] {
  return parentId === null
    ? graph.getRootBlockIds()
    : graph.getChildBlockIds(parentId);
}
