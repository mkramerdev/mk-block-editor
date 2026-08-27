import {
  moveBlocks,
  removeBlocks,
  replaceContent,
  setSelection,
  type StructuralEditRange,
  type StructuralTransactionOperation,
  type StructuralTransactionPlan,
} from "@repo/editor-core/editing";
import {
  concatenateRichTextDocuments,
  extractPlainTextFromRichTextDocument,
  richTextDocumentContentSize,
  sliceRichTextDocument,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { FirstDraftViewStateStore } from "../blocks/view-state.tsx";

interface FirstDraftRangeGraph {
  getBlock(blockId: BlockId): VersionedBlock | null;
  getParentId(blockId: BlockId): BlockId | null;
  getChildBlockIds(parentId: BlockId): readonly BlockId[];
  getRootBlockIds(): readonly BlockId[];
}

interface BoundaryCleanup {
  readonly operations: readonly StructuralTransactionOperation[];
  readonly expectations: readonly VersionedBlock[];
  readonly consumedByCleanup: ReadonlySet<BlockId>;
  readonly preservedRemovalRoots: ReadonlySet<BlockId>;
  readonly preserveDonor?: boolean;
}

function planBoundaryCleanup(
  graph: FirstDraftRangeGraph,
  destination: VersionedBlock,
  donor: VersionedBlock,
  selectedRemovalRoots: readonly BlockId[],
  viewState: FirstDraftViewStateStore | undefined,
): BoundaryCleanup | null {
  const selected = new Set(selectedRemovalRoots);
  const tabsCleanup = preserveTabsBoundary(
    graph,
    destination,
    donor,
    viewState,
  );
  if (tabsCleanup) return tabsCleanup;

  const donorParent = donor.parentId ? graph.getBlock(donor.parentId) : null;
  if (!donorParent) return null;

  if (isListItem(donorParent.type)) {
    const container = donorParent.parentId
      ? graph.getBlock(donorParent.parentId)
      : null;
    if (!container || !isMatchingList(container.type, donorParent.type)) {
      return null;
    }
    const items = graph.getChildBlockIds(container.id);
    const descendants = graph
      .getChildBlockIds(donorParent.id)
      .slice(1)
      .filter((blockId) => !selected.has(blockId));
    const operations: StructuralTransactionOperation[] = [];
    const itemIndex = items.indexOf(donorParent.id);
    const adjacentItemId = items[itemIndex + 1] ?? items[itemIndex - 1] ?? null;
    if (descendants.length > 0 && adjacentItemId) {
      operations.push(
        moveBlocks({
          blockIds: descendants,
          sourcePlacement: { parentId: donorParent.id, childIndex: 1 },
          destinationPlacement: {
            parentId: adjacentItemId,
            childIndex:
              itemIndex + 1 < items.length
                ? 1
                : graph.getChildBlockIds(adjacentItemId).length,
          },
        }),
      );
    }
    operations.push(
      removeBlocks({
        blockIds: [donorParent.id],
        includeDescendants: true,
        expectedParents: { [donorParent.id]: container.id },
      }),
    );
    if (items.length === 1) {
      operations.push(
        removeBlocks({
          blockIds: [container.id],
          includeDescendants: false,
          expectedParents: { [container.id]: container.parentId },
        }),
      );
    }
    return cleanup(operations, [donorParent, container], graph, donorParent.id);
  }

  if (isToggle(donorParent.type)) {
    const children = graph.getChildBlockIds(donorParent.id);
    if (children[0] !== donor.id || !children[1]) return null;
    const body = graph.getBlock(children[1]);
    if (!body || !isToggleBody(body.type)) return null;
    const placement = placementOf(graph, donorParent);
    if (!placement) return null;
    const promoted = graph
      .getChildBlockIds(body.id)
      .filter((blockId) => !selected.has(blockId));
    const operations: StructuralTransactionOperation[] = [];
    if (promoted.length > 0) {
      operations.push(
        moveBlocks({
          blockIds: promoted,
          sourcePlacement: { parentId: body.id, childIndex: 0 },
          destinationPlacement: placement,
        }),
      );
    }
    operations.push(
      removeBlocks({
        blockIds: [donorParent.id],
        includeDescendants: true,
        expectedParents: { [donorParent.id]: donorParent.parentId },
      }),
    );
    return cleanup(operations, [donorParent, body], graph, donorParent.id);
  }

  const semanticWrapper = nearestAncestor(graph, donor, [
    "quote",
    "code",
    "callout",
  ]);
  if (semanticWrapper) {
    return unwrapWholeBoundaryWrapper(
      graph,
      donor,
      semanticWrapper,
      selected,
    );
  }

  const column = nearestAncestor(graph, donor, ["column"]);
  const columns = column?.parentId ? graph.getBlock(column.parentId) : null;
  if (column && columns?.type === "columns") {
    return unwrapColumnBoundary(graph, donor, column, columns, selected);
  }

  return null;
}

function preserveTabsBoundary(
  graph: FirstDraftRangeGraph,
  destination: VersionedBlock,
  donor: VersionedBlock,
  viewState: FirstDraftViewStateStore | undefined,
): BoundaryCleanup | null {
  const destinationStructure = tabPaneStructure(graph, destination);
  const donorStructure = tabPaneStructure(graph, donor);
  if (
    (!destinationStructure && !donorStructure) ||
    (destinationStructure?.tabs.id === donorStructure?.tabs.id)
  ) {
    return null;
  }
  const structures = [destinationStructure, donorStructure].filter(
    (structure): structure is NonNullable<typeof structure> =>
      structure !== null,
  );
  for (const { pane, tabs } of structures) {
    const paneIds = graph.getChildBlockIds(tabs.id);
    const selectedPane = viewState?.getSnapshot().selectedTabs[tabs.id] as
      | BlockId
      | undefined;
    const effectivePane =
      selectedPane && paneIds.includes(selectedPane)
        ? selectedPane
        : paneIds[0];
    if (effectivePane !== pane.id) return null;
  }
  const removeDonor = donorStructure
    ? donor.parentId === donorStructure.pane.id
    : donor.parentId === null;

  const preservedRemovalRoots = new Set<BlockId>();
  const expectations: VersionedBlock[] = [];
  for (const { pane, tabs } of structures) {
    expectations.push(pane, tabs);
    preservedRemovalRoots.add(tabs.id);
    for (const paneId of graph.getChildBlockIds(tabs.id)) {
      preservedRemovalRoots.add(paneId);
      if (paneId !== pane.id) {
        for (const descendantId of descendantsOf(graph, paneId)) {
          preservedRemovalRoots.add(descendantId);
        }
      }
    }
  }
  const operations = removeDonor
    ? [
        removeBlocks({
          blockIds: [donor.id],
          includeDescendants: false,
          expectedParents: { [donor.id]: donor.parentId },
        }),
      ]
    : [];
  return {
    operations,
    expectations,
    consumedByCleanup: descendantsOf(graph, donor.id),
    preservedRemovalRoots,
    preserveDonor: !removeDonor,
  };
}

function unwrapWholeBoundaryWrapper(
  graph: FirstDraftRangeGraph,
  donor: VersionedBlock,
  wrapper: VersionedBlock,
  selected: ReadonlySet<BlockId>,
  contentParent: VersionedBlock = wrapper,
): BoundaryCleanup | null {
  const placement = placementOf(graph, wrapper);
  if (!placement) return null;
  const promoted = graph
    .getChildBlockIds(contentParent.id)
    .filter((blockId) => blockId !== donor.id && !selected.has(blockId));
  const operations: StructuralTransactionOperation[] = [];
  if (promoted.length > 0) {
    const firstIndex = graph
      .getChildBlockIds(contentParent.id)
      .indexOf(promoted[0]!);
    operations.push(
      moveBlocks({
        blockIds: promoted,
        sourcePlacement: { parentId: contentParent.id, childIndex: firstIndex },
        destinationPlacement: placement,
      }),
    );
  }
  operations.push(
    removeBlocks({
      blockIds: [wrapper.id],
      includeDescendants: true,
      expectedParents: { [wrapper.id]: wrapper.parentId },
    }),
  );
  return cleanup(
    operations,
    contentParent.id === wrapper.id ? [wrapper] : [wrapper, contentParent],
    graph,
    wrapper.id,
  );
}

function unwrapColumnBoundary(
  graph: FirstDraftRangeGraph,
  donor: VersionedBlock,
  column: VersionedBlock,
  columns: VersionedBlock,
  selected: ReadonlySet<BlockId>,
): BoundaryCleanup | null {
  const placement = placementOf(graph, columns);
  if (!placement) return null;
  const operations: StructuralTransactionOperation[] = [];
  const boundaryContents = graph
    .getChildBlockIds(column.id)
    .filter((blockId) => blockId !== donor.id && !selected.has(blockId));
  if (boundaryContents.length > 0) {
    operations.push(
      moveBlocks({
        blockIds: boundaryContents,
        sourcePlacement: {
          parentId: column.id,
          childIndex: graph
            .getChildBlockIds(column.id)
            .indexOf(boundaryContents[0]!),
        },
        destinationPlacement: placement,
      }),
    );
  }
  operations.push(
    removeBlocks({
      blockIds: [column.id],
      includeDescendants: true,
      expectedParents: { [column.id]: columns.id },
    }),
  );
  const survivors = graph
    .getChildBlockIds(columns.id)
    .filter((blockId) => blockId !== column.id && !selected.has(blockId));
  const expectations: VersionedBlock[] = [column, columns];
  if (survivors.length === 1) {
    const survivor = graph.getBlock(survivors[0]!);
    if (!survivor || survivor.type !== "column") return null;
    expectations.push(survivor);
    const survivorContents = graph.getChildBlockIds(survivor.id);
    if (survivorContents.length > 0) {
      operations.push(
        moveBlocks({
          blockIds: survivorContents,
          sourcePlacement: { parentId: survivor.id, childIndex: 0 },
          destinationPlacement: {
            parentId: placement.parentId,
            childIndex: placement.childIndex + boundaryContents.length,
          },
        }),
      );
    }
    operations.push(
      removeBlocks({
        blockIds: [survivor.id],
        includeDescendants: false,
        expectedParents: { [survivor.id]: columns.id },
      }),
      removeBlocks({
        blockIds: [columns.id],
        includeDescendants: false,
        expectedParents: { [columns.id]: columns.parentId },
      }),
    );
  }
  return cleanup(operations, expectations, graph, columns.id);
}

function cleanup(
  operations: readonly StructuralTransactionOperation[],
  expectations: readonly VersionedBlock[],
  graph: FirstDraftRangeGraph,
  cleanupRootId: BlockId,
): BoundaryCleanup {
  return {
    operations,
    expectations,
    consumedByCleanup: descendantsOf(graph, cleanupRootId),
    preservedRemovalRoots: new Set(),
  };
}

function descendantsOf(
  graph: FirstDraftRangeGraph,
  rootId: BlockId,
): ReadonlySet<BlockId> {
  const descendants = new Set<BlockId>();
  const visit = (blockId: BlockId) => {
    if (descendants.has(blockId)) return;
    descendants.add(blockId);
    graph.getChildBlockIds(blockId).forEach(visit);
  };
  visit(rootId);
  return descendants;
}

function tabPaneStructure(
  graph: FirstDraftRangeGraph,
  block: VersionedBlock,
): { readonly pane: VersionedBlock; readonly tabs: VersionedBlock } | null {
  const pane = nearestAncestor(graph, block, ["tabPane"]);
  const tabs = pane?.parentId ? graph.getBlock(pane.parentId) : null;
  return pane && tabs?.type === "tabs" ? { pane, tabs } : null;
}

function nearestAncestor(
  graph: FirstDraftRangeGraph,
  block: VersionedBlock,
  types: readonly string[],
): VersionedBlock | null {
  const visited = new Set<BlockId>();
  let parentId = block.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = graph.getBlock(parentId);
    if (!parent) return null;
    if (types.includes(parent.type)) return parent;
    parentId = parent.parentId;
  }
  return null;
}

function placementOf(
  graph: FirstDraftRangeGraph,
  block: VersionedBlock,
): { readonly parentId: BlockId | null; readonly childIndex: number } | null {
  const siblings = block.parentId
    ? graph.getChildBlockIds(block.parentId)
    : graph.getRootBlockIds();
  const childIndex = siblings.indexOf(block.id);
  return childIndex < 0 ? null : { parentId: block.parentId, childIndex };
}

function isToggle(type: string): boolean {
  return type === "toggleHeading" || type === "toggleListItem";
}

function isToggleBody(type: string): boolean {
  return type === "toggleHeadingBody" || type === "toggleListItemBody";
}

/** Plans only First Draft compound cleanup; neutral ranges use editor fallback. */
export function planFirstDraftStructuralRangeDeletion(input: {
  readonly intent: "cut" | "delete";
  readonly range: StructuralEditRange;
  readonly graph: FirstDraftRangeGraph;
  readonly readBlockContent: (
    blockId: BlockId,
    blockType: BlockType,
  ) => RichTextDocumentNodeJson | null;
}, viewState?: FirstDraftViewStateStore): StructuralTransactionPlan | null {
  const first = input.range.blocks[0];
  const last = input.range.blocks.at(-1);
  if (
    first?.kind !== "text" ||
    last?.kind !== "text" ||
    first.blockId === last.blockId ||
    first.parentId === last.parentId
  ) {
    return null;
  }
  const destination = input.graph.getBlock(first.blockId);
  const donor = input.graph.getBlock(last.blockId);
  const donorContent = donor
    ? input.readBlockContent(donor.id, donor.type)
    : null;
  if (!destination || !donor || !donorContent) return null;
  const donorSize = richTextDocumentContentSize(donorContent);
  const remaining = sliceRichTextDocument(
    donor.type,
    donorContent,
    last.to,
    donorSize,
  );
  const destinationContent = input.readBlockContent(
    destination.id,
    destination.type,
  );
  if (!destinationContent) return null;
  const destinationPrefix = sliceRichTextDocument(
    destination.type,
    destinationContent,
    0,
    first.from,
  );
  const joined = concatenateRichTextDocuments(
    destination.type,
    destinationPrefix,
    remaining,
  );
  const selectedRemovalRoots = input.range.blocks.flatMap((entry) =>
    entry.kind === "block" ? [entry.blockId] : [],
  );
  const cleanup = planBoundaryCleanup(
    input.graph,
    destination,
    donor,
    selectedRemovalRoots,
    viewState,
  );
  if (!cleanup) return null;
  const removalRoots = selectedRemovalRoots.filter(
    (blockId) =>
      !cleanup.consumedByCleanup.has(blockId) &&
      !cleanup.preservedRemovalRoots.has(blockId),
  );
  const operations = [
    replaceContent({
      blockId: destination.id,
      expectedContentVersion: destination.contentVersion,
      value: {
        kind: "value",
        content: cleanup.preserveDonor ? destinationPrefix : joined,
        plainText: extractPlainTextFromRichTextDocument(
          cleanup.preserveDonor ? destinationPrefix : joined,
        ),
      },
    }),
  ];
  if (cleanup.preserveDonor) {
    operations.push(
      replaceContent({
        blockId: donor.id,
        expectedContentVersion: donor.contentVersion,
        value: {
          kind: "value",
          content: remaining,
          plainText: extractPlainTextFromRichTextDocument(remaining),
        },
      }),
    );
  }
  if (removalRoots.length > 0) {
    operations.push(
      removeBlocks({
        blockIds: removalRoots,
        includeDescendants: true,
        expectedParents: Object.fromEntries(
          removalRoots.map((blockId) => [
            blockId,
            input.graph.getBlock(blockId)?.parentId ?? null,
          ]),
        ),
      }),
    );
  }
  operations.push(...cleanup.operations);
  operations.push(
    setSelection({
      kind: "text-offset",
      blockId: destination.id,
      offset: first.from,
    }),
  );
  return {
    origin: `first-draft-range-${input.intent}`,
    operations,
    preconditions: {
      blocks: [destination, donor, ...cleanup.expectations].map((block) => ({
        blockId: block.id,
        type: block.type,
        parentId: block.parentId,
      })),
    },
  };
}

function isListItem(type: string): boolean {
  return type === "bulletListItem" ||
    type === "orderedListItem" ||
    type === "checklistItem";
}

function isMatchingList(container: string, item: string): boolean {
  return (container === "bulletList" && item === "bulletListItem") ||
    (container === "orderedList" && item === "orderedListItem") ||
    (container === "checklist" && item === "checklistItem");
}
