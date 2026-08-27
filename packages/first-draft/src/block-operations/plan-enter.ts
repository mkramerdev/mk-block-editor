import {
  createCanonicalBlockRecord,
  findAdjacentValidInsertionPlacement,
  insertBlocks,
  moveBlocks,
  removeBlocks,
  replaceContent,
  setSelection,
  splitText,
  type BlockPlacement,
  type StructuralTransactionOperation,
} from "@repo/editor-core/editing";
import {
  extractPlainTextFromRichTextDocument,
  removeTextRangeFromRichTextDocument,
  richTextDocumentContentSize,
} from "@repo/editor-core/content/rich-text";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type {
  EditorBlockCommandExecutionContext,
  EditorStructuralTextBoundaryRequest,
} from "@repo/editor-web/document-runtime";
import type { FirstDraftViewStateStore } from "../blocks/view-state.tsx";
import {
  afterBlock,
  captureFirstDraftGraph,
  createProductTree,
  expectation,
  insertedRootId,
  isListItem,
  isMatchingList,
  isToggleBody,
  uniqueExpectations,
  validSelection,
  type PlannedFirstDraftBoundary,
} from "./structural-command-model.ts";

export function planFirstDraftEnter(
  context: EditorBlockCommandExecutionContext,
  request: EditorStructuralTextBoundaryRequest,
  viewState: FirstDraftViewStateStore,
): PlannedFirstDraftBoundary | null {
  const focused = request.focusedBlock;
  const content = request.readBlockContent(focused.id, focused.type);
  if (!content || !validSelection(request, richTextDocumentContentSize(content))) {
    return null;
  }
  const parent = focused.parentId
    ? request.graph.getBlock(focused.parentId)
    : null;

  if (
    parent &&
    (parent.type === "toggleHeading" || parent.type === "toggleListItem") &&
    request.graph.getChildBlockIds(parent.id)[0] === focused.id
  ) {
    if (!viewState.isBlockCollapsed(parent.id)) {
      return planExpandedToggleSummaryEnter(context, request, parent);
    }
    return parent.type === "toggleListItem"
      ? planCollapsedToggleListItemEnter(context, request, parent)
      : planCollapsedToggleHeadingEnter(context, request, parent);
  }

  if (
    parent &&
    isListItem(parent.type) &&
    request.graph.getChildBlockIds(parent.id)[0] === focused.id
  ) {
    return planListEnter(context, request, parent, content);
  }

  if (parent?.type === "callout") {
    const calloutExit = planEmptyCalloutExit(
      context,
      request,
      focused,
      parent,
      content,
    );
    if (calloutExit) return calloutExit;
  }

  if (
    parent &&
    (parent.type === "quote" || parent.type === "code") &&
    request.graph.getChildBlockIds(parent.id).length === 1 &&
    richTextDocumentContentSize(content) === 0
  ) {
    return planEmptyFixedWrapperExit(request, focused, parent);
  }

  const resultType = focused.type === "heading" ? "paragraph" : focused.type;
  const graph = captureFirstDraftGraph(request);
  const destination = findAdjacentValidInsertionPlacement({
    originBlockId: focused.id,
    proposedType: resultType,
    ...graph,
    blockDefinitions: context.definition.blocks,
  });
  return destination.ok
    ? planTextSplit(context, request, resultType, destination.placement)
    : null;
}

function planEmptyCalloutExit(
  context: EditorBlockCommandExecutionContext,
  request: EditorStructuralTextBoundaryRequest,
  focused: VersionedBlock,
  callout: VersionedBlock,
  content: NonNullable<ReturnType<EditorStructuralTextBoundaryRequest["readBlockContent"]>>,
): PlannedFirstDraftBoundary | null {
  const children = request.graph.getChildBlockIds(callout.id);
  if (
    callout.tombstone ||
    callout.type !== "callout" ||
    focused.tombstone ||
    focused.parentId !== callout.id ||
    context.definition.blocks[focused.type]?.kind !== "text" ||
    richTextDocumentContentSize(content) !== 0 ||
    children.at(-1) !== focused.id ||
    !validSelection(request, 0)
  ) {
    return null;
  }

  const placement = afterBlock(request, callout);
  const created = createProductTree("paragraph", callout.parentId);
  if (!placement || !created) return null;
  const calloutParent = callout.parentId
    ? request.graph.getBlock(callout.parentId)
    : null;
  if (callout.parentId !== null && (!calloutParent || calloutParent.tombstone)) {
    return null;
  }

  const operations: StructuralTransactionOperation[] = [
    insertBlocks({ placement, blocks: created.blocks }),
    removeBlocks({
      blockIds: [focused.id],
      includeDescendants: false,
      expectedParents: { [focused.id]: callout.id },
    }),
  ];
  if (children.length === 1) {
    operations.push(
      removeBlocks({
        blockIds: [callout.id],
        includeDescendants: false,
        expectedParents: { [callout.id]: callout.parentId },
      }),
    );
  }
  operations.push(
    setSelection({
      kind: "text-offset",
      blockId: created.selectionBlockId,
      offset: 0,
    }),
  );

  return {
    plan: {
      origin: "first-draft-empty-callout-exit",
      operations,
      preconditions: {
        blocks: uniqueExpectations([
          focused,
          callout,
          ...(calloutParent ? [calloutParent] : []),
        ]),
      },
    },
    focus: { blockId: created.selectionBlockId, offset: 0 },
  };
}

function planCollapsedToggleListItemEnter(
  context: EditorBlockCommandExecutionContext,
  request: EditorStructuralTextBoundaryRequest,
  wrapper: VersionedBlock,
): PlannedFirstDraftBoundary | null {
  if (
    wrapper.type !== "toggleListItem" ||
    request.focusedBlock.type !== "paragraph"
  ) {
    return null;
  }
  const placement = afterBlock(request, wrapper);
  if (!placement) return null;
  const planned = planTextSplit(context, request, wrapper.type, placement);
  return planned
    ? { ...planned, createdCollapsedBlockId: insertedRootId(planned.plan) }
    : null;
}

function planCollapsedToggleHeadingEnter(
  context: EditorBlockCommandExecutionContext,
  request: EditorStructuralTextBoundaryRequest,
  wrapper: VersionedBlock,
): PlannedFirstDraftBoundary | null {
  const children = request.graph.getChildBlockIds(wrapper.id);
  const primary = children[0] ? request.graph.getBlock(children[0]!) : null;
  const body = children[1] ? request.graph.getBlock(children[1]!) : null;
  if (
    wrapper.type !== "toggleHeading" ||
    children.length !== 2 ||
    primary?.id !== request.focusedBlock.id ||
    primary.type !== "heading" ||
    primary.parentId !== wrapper.id ||
    !body ||
    body.tombstone ||
    body.type !== "toggleHeadingBody" ||
    body.parentId !== wrapper.id
  ) {
    return null;
  }

  const graph = captureFirstDraftGraph(request);
  const destination = findAdjacentValidInsertionPlacement({
    originBlockId: wrapper.id,
    proposedType: "paragraph",
    ...graph,
    blockDefinitions: context.definition.blocks,
  });
  if (!destination.ok) return null;
  const crossedAncestors = destination.crossedAncestorIds.flatMap(
    (blockId) => graph.blocks[blockId] ? [graph.blocks[blockId]!] : [],
  );
  return planTextSplit(
    context,
    request,
    "paragraph",
    destination.placement,
    [wrapper, body, ...crossedAncestors],
  );
}

function planExpandedToggleSummaryEnter(
  context: EditorBlockCommandExecutionContext,
  request: EditorStructuralTextBoundaryRequest,
  wrapper: VersionedBlock,
): PlannedFirstDraftBoundary | null {
  const children = request.graph.getChildBlockIds(wrapper.id);
  const primary = children[0] ? request.graph.getBlock(children[0]!) : null;
  const body = children[1] ? request.graph.getBlock(children[1]!) : null;
  if (
    children.length !== 2 ||
    primary?.id !== request.focusedBlock.id ||
    !body ||
    body.tombstone ||
    !isToggleBody(body.type)
  ) {
    return null;
  }
  return planTextSplit(context, request, "paragraph", {
    parentId: body.id,
    childIndex: 0,
  }, [wrapper, body]);
}

function planListEnter(
  context: EditorBlockCommandExecutionContext,
  request: EditorStructuralTextBoundaryRequest,
  item: VersionedBlock,
  content: NonNullable<ReturnType<EditorStructuralTextBoundaryRequest["readBlockContent"]>>,
): PlannedFirstDraftBoundary | null {
  const container = item.parentId
    ? request.graph.getBlock(item.parentId)
    : null;
  if (!container || !isMatchingList(container.type, item.type)) return null;
  const itemChildren = request.graph.getChildBlockIds(item.id);
  if (itemChildren[0] !== request.focusedBlock.id) return null;
  const contentAfterSelection = removeTextRangeFromRichTextDocument(
    request.focusedBlock.type,
    content,
    request.selection.from,
    request.selection.to,
  );
  const emptyAfterSelection = richTextDocumentContentSize(contentAfterSelection) === 0;
  if (emptyAfterSelection && itemChildren.length === 1) {
    return planEmptyListExit(request, item, container);
  }
  if (emptyAfterSelection) return null;

  const items = request.graph.getChildBlockIds(container.id);
  const itemIndex = items.indexOf(item.id);
  if (itemIndex < 0) return null;
  const placement = {
    parentId: container.id,
    childIndex: request.selection.from === 0 ? itemIndex : itemIndex + 1,
  };
  if (request.selection.from > 0) {
    return planTextSplit(context, request, item.type, placement, [item, container]);
  }

  const created = createProductTree(item.type, container.id);
  if (!created) return null;
  const operations: StructuralTransactionOperation[] = [];
  if (request.selection.to > 0) {
    operations.push(
      replaceContent({
        blockId: request.focusedBlock.id,
        expectedContentVersion: request.focusedBlock.contentVersion,
        value: {
          kind: "value",
          content: contentAfterSelection,
          plainText: extractPlainTextFromRichTextDocument(contentAfterSelection),
        },
      }),
    );
  }
  operations.push(
    insertBlocks({ placement, blocks: created.blocks }),
    setSelection({ kind: "text-offset", blockId: created.selectionBlockId, offset: 0 }),
  );
  return {
    plan: {
      origin: "first-draft-list-enter",
      operations,
      preconditions: {
        blocks: uniqueExpectations([request.focusedBlock, item, container]),
      },
    },
    focus: { blockId: created.selectionBlockId, offset: 0 },
  };
}

function planEmptyListExit(
  request: EditorStructuralTextBoundaryRequest,
  item: VersionedBlock,
  container: VersionedBlock,
): PlannedFirstDraftBoundary | null {
  const items = request.graph.getChildBlockIds(container.id);
  const itemIndex = items.indexOf(item.id);
  const outerSiblings = container.parentId === null
    ? request.graph.getRootBlockIds()
    : request.graph.getChildBlockIds(container.parentId);
  const containerIndex = outerSiblings.indexOf(container.id);
  if (itemIndex < 0 || containerIndex < 0) return null;
  const hasLeading = itemIndex > 0;
  const hasTrailing = itemIndex < items.length - 1;
  const focused = request.focusedBlock;
  const operations: StructuralTransactionOperation[] = [
    moveBlocks({
      blockIds: [focused.id],
      sourcePlacement: { parentId: item.id, childIndex: 0 },
      destinationPlacement: {
        parentId: container.parentId,
        childIndex: containerIndex + (hasLeading ? 1 : 0),
      },
    }),
  ];
  if (hasLeading && hasTrailing) {
    const trailingContainer = createCanonicalBlockRecord({
      type: container.type,
      parentId: container.parentId,
    });
    operations.push(
      insertBlocks({
        placement: {
          parentId: container.parentId,
          childIndex: containerIndex + 2,
        },
        blocks: [trailingContainer],
      }),
      moveBlocks({
        blockIds: items.slice(itemIndex + 1),
        sourcePlacement: {
          parentId: container.id,
          childIndex: itemIndex + 1,
        },
        destinationPlacement: { parentId: trailingContainer.id, childIndex: 0 },
      }),
    );
  }
  operations.push(
    removeBlocks({
      blockIds: [item.id],
      includeDescendants: false,
      expectedParents: { [item.id]: container.id },
    }),
  );
  if (!hasLeading && !hasTrailing) {
    operations.push(
      removeBlocks({
        blockIds: [container.id],
        includeDescendants: false,
        expectedParents: { [container.id]: container.parentId },
      }),
    );
  }
  operations.push(
    setSelection({ kind: "text-offset", blockId: focused.id, offset: 0 }),
  );
  return {
    plan: {
      origin: "first-draft-empty-list-exit",
      operations,
      preconditions: {
        blocks: uniqueExpectations([focused, item, container]),
      },
    },
    focus: { blockId: focused.id, offset: 0 },
  };
}

function planEmptyFixedWrapperExit(
  request: EditorStructuralTextBoundaryRequest,
  focused: VersionedBlock,
  wrapper: VersionedBlock,
): PlannedFirstDraftBoundary | null {
  const placement = afterBlock(request, wrapper);
  if (!placement) return null;
  return {
    plan: {
      origin: "first-draft-empty-fixed-wrapper-exit",
      operations: [
        moveBlocks({
          blockIds: [focused.id],
          sourcePlacement: { parentId: wrapper.id, childIndex: 0 },
          destinationPlacement: { ...placement, childIndex: placement.childIndex - 1 },
        }),
        removeBlocks({
          blockIds: [wrapper.id],
          includeDescendants: false,
          expectedParents: { [wrapper.id]: wrapper.parentId },
        }),
        setSelection({ kind: "text-offset", blockId: focused.id, offset: 0 }),
      ],
      preconditions: { blocks: [expectation(focused), expectation(wrapper)] },
    },
    focus: { blockId: focused.id, offset: 0 },
  };
}

function planTextSplit(
  context: EditorBlockCommandExecutionContext,
  request: EditorStructuralTextBoundaryRequest,
  resultType: BlockType,
  placement: BlockPlacement,
  additionalExpectations: readonly VersionedBlock[] = [],
): PlannedFirstDraftBoundary | null {
  const source = request.focusedBlock;
  const created = createProductTree(resultType, placement.parentId);
  if (!created) return null;
  const operations: StructuralTransactionOperation[] = [
    splitText({
      blockId: source.id,
      offset: request.selection.from,
      ...(request.selection.from === request.selection.to
        ? {}
        : { selectionRange: request.selection }),
      expectedContentVersion: source.contentVersion,
      outputId: "right",
    }),
    insertBlocks({
      placement,
      blocks: created.blocks,
    }),
    replaceContent({
      blockId: created.selectionBlockId,
      expectedContentVersion: "1",
      value: { kind: "split-output", outputId: "right" },
    }),
    setSelection({
      kind: "text-offset",
      blockId: created.selectionBlockId,
      offset: 0,
    }),
  ];
  return {
    plan: {
      origin: "first-draft-enter",
      operations,
      preconditions: {
        blocks: uniqueExpectations([
          source,
          ...additionalExpectations,
        ]),
      },
    },
    focus: { blockId: created.selectionBlockId, offset: 0 },
  };
}
