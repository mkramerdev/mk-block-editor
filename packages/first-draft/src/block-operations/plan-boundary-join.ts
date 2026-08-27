import {
  joinTextBlocks,
  moveBlocks,
  removeBlocks,
  replaceContent,
  setSelection,
  type StructuralTransactionOperation,
} from "@repo/editor-core/editing";
import {
  concatenateRichTextDocuments,
  extractPlainTextFromRichTextDocument,
  richTextDocumentContentSize,
} from "@repo/editor-core/content/rich-text";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorBlockCommandExecutionContext,
  EditorStructuralTextBoundaryRequest,
} from "@repo/editor-web/document-runtime";
import type { FirstDraftViewStateStore } from "../blocks/view-state.tsx";
import {
  findAdjacentVisibleTextBlock,
  isListItem,
  isMatchingList,
  isToggle,
  isToggleBody,
  uniqueExpectations,
  validSelection,
  type FirstDraftBoundaryResult,
} from "./structural-command-model.ts";

type Direction = "previous" | "next";

interface CleanupPlan {
  readonly operations: readonly StructuralTransactionOperation[];
  readonly expectations: readonly VersionedBlock[];
  readonly focusBlockId: BlockId;
  readonly focusOffset: number;
  /** The highest semantic donor root removed by this boundary join. */
  readonly removedRootId: BlockId;
  readonly skipTextMerge?: boolean;
}

export function planFirstDraftBoundaryJoin(
  context: EditorBlockCommandExecutionContext,
  request: EditorStructuralTextBoundaryRequest,
  viewState: FirstDraftViewStateStore,
  direction: Direction,
): FirstDraftBoundaryResult | null {
  const sourceContent = request.readBlockContent(
    request.focusedBlock.id,
    request.focusedBlock.type,
  );
  if (!sourceContent) return null;
  const sourceSize = richTextDocumentContentSize(sourceContent);
  if (
    !validSelection(request, sourceSize) ||
    request.selection.from !== request.selection.to ||
    (direction === "previous"
      ? request.selection.from !== 0
      : request.selection.from !== sourceSize)
  ) {
    return null;
  }
  const adjacent = findAdjacentVisibleTextBlock(
    context,
    request,
    viewState,
    request.focusedBlock.id,
    direction,
  );
  if (!adjacent) {
    return planIsolatedTabPaneBoundary(
      request,
      request.focusedBlock,
      sourceSize,
      direction,
    );
  }
  const left = direction === "previous" ? adjacent : request.focusedBlock;
  const right = direction === "previous" ? request.focusedBlock : adjacent;
  const leftContent = request.readBlockContent(left.id, left.type);
  const rightContent = request.readBlockContent(right.id, right.type);
  if (!leftContent || !rightContent) return null;
  const joinOffset = richTextDocumentContentSize(leftContent);

  const tabsBoundary = planTabsBoundary(
    request,
    left,
    right,
    joinOffset,
    richTextDocumentContentSize(rightContent),
    direction,
  );
  if (tabsBoundary) return tabsBoundary;

  const cleanup = planProductCleanup(
    context,
    request,
    left,
    right,
    joinOffset,
    richTextDocumentContentSize(rightContent),
  );
  if (!cleanup) return null;
  const columnCleanup = planEmptyDonorColumnCleanup(request, right, cleanup);
  if (!columnCleanup) return null;
  const operations: StructuralTransactionOperation[] = [];
  if (!cleanup.skipTextMerge) {
    const sameParent = left.parentId === right.parentId;
    const sharedParent = sameParent ? parentOf(request, left) : null;
    const sharedParentIsContentBoundary = Boolean(
      sharedParent &&
      context.definition.blocks[sharedParent.type]?.contentBoundary,
    );
    if (
      sameParent &&
      !sharedParentIsContentBoundary &&
      cleanup.operations.length === 0
    ) {
      operations.push(joinTextBlocks(left.id, right.id));
    } else {
      const joined = concatenateRichTextDocuments(
        left.type,
        leftContent,
        rightContent,
      );
      operations.push(
        replaceContent({
          blockId: left.id,
          expectedContentVersion: left.contentVersion,
          value: {
            kind: "value",
            content: joined,
            plainText: extractPlainTextFromRichTextDocument(joined),
          },
        }),
        removeBlocks({
          blockIds: [right.id],
          includeDescendants: false,
          expectedParents: { [right.id]: right.parentId },
        }),
      );
    }
  }
  operations.push(
    ...columnCleanup.operations,
    setSelection({
      kind: "text-offset",
      blockId: columnCleanup.focusBlockId,
      offset: columnCleanup.focusOffset,
    }),
  );
  return {
    plan: {
      origin:
        direction === "previous"
          ? "first-draft-backspace"
          : "first-draft-delete",
      operations,
      preconditions: {
        blocks: uniqueExpectations([
          left,
          right,
          ...columnCleanup.expectations,
        ]),
      },
    },
    focus: {
      blockId: columnCleanup.focusBlockId,
      offset: columnCleanup.focusOffset,
    },
  };
}

function planProductCleanup(
  context: EditorBlockCommandExecutionContext,
  request: EditorStructuralTextBoundaryRequest,
  left: VersionedBlock,
  right: VersionedBlock,
  joinOffset: number,
  rightSize: number,
): CleanupPlan | null {
  if (left.parentId === right.parentId) {
    const sharedParent = parentOf(request, left);
    return {
      operations: [],
      expectations:
        sharedParent &&
        context.definition.blocks[sharedParent.type]?.contentBoundary
          ? [sharedParent]
          : [],
      focusBlockId: left.id,
      focusOffset: joinOffset,
      removedRootId: right.id,
    };
  }

  const leftParent = parentOf(request, left);
  const rightParent = parentOf(request, right);
  if (
    leftParent &&
    rightParent &&
    isListItem(leftParent.type) &&
    isListItem(rightParent.type)
  ) {
    return planListItemJoin(
      request,
      left,
      right,
      leftParent,
      rightParent,
      joinOffset,
    );
  }

  if (
    rightParent &&
    isToggle(rightParent.type) &&
    isPrimary(request, rightParent, right)
  ) {
    return rightSize === 0
      ? planRemoveEmptyCompound(request, left, rightParent, joinOffset)
      : planUnwrapCompoundDonor(request, left, right, rightParent, joinOffset);
  }

  if (
    leftParent &&
    isToggle(leftParent.type) &&
    isPrimary(request, leftParent, left)
  ) {
    const body = toggleBody(request, leftParent);
    if (body && right.parentId === body.id) {
      return {
        operations: [],
        expectations: [leftParent, body],
        focusBlockId: left.id,
        focusOffset: joinOffset,
        removedRootId: right.id,
      };
    }
    return {
      operations: [],
      expectations: [leftParent],
      focusBlockId: left.id,
      focusOffset: joinOffset,
      removedRootId: right.id,
    };
  }

  const rightFixed = nearestAncestor(request, right, [
    "quote",
    "code",
    "callout",
  ]);
  if (rightFixed && !isDescendantOf(request, left, rightFixed.id)) {
    return planUnwrapBoundaryWrapper(
      request,
      left,
      right,
      rightFixed,
      joinOffset,
    );
  }

  return {
    operations: [],
    expectations: [],
    focusBlockId: left.id,
    focusOffset: joinOffset,
    removedRootId: right.id,
  };
}

function planListItemJoin(
  request: EditorStructuralTextBoundaryRequest,
  left: VersionedBlock,
  right: VersionedBlock,
  leftItem: VersionedBlock,
  rightItem: VersionedBlock,
  joinOffset: number,
): CleanupPlan | null {
  const leftList = parentOf(request, leftItem);
  const rightList = parentOf(request, rightItem);
  if (
    !leftList ||
    !rightList ||
    !isMatchingList(leftList.type, leftItem.type) ||
    !isMatchingList(rightList.type, rightItem.type) ||
    leftItem.type !== rightItem.type
  ) {
    return null;
  }
  const operations: StructuralTransactionOperation[] = [];
  const nested = request.graph.getChildBlockIds(rightItem.id).slice(1);
  if (nested.length > 0) {
    operations.push(
      moveBlocks({
        blockIds: nested,
        sourcePlacement: { parentId: rightItem.id, childIndex: 1 },
        destinationPlacement: {
          parentId: leftItem.id,
          childIndex: request.graph.getChildBlockIds(leftItem.id).length,
        },
      }),
    );
  }
  if (leftList.id !== rightList.id) {
    const leftSiblings = siblingsOf(request, leftList);
    const leftIndex = leftSiblings.indexOf(leftList.id);
    const rightIndex = leftSiblings.indexOf(rightList.id);
    if (
      leftIndex < 0 ||
      rightIndex !== leftIndex + 1 ||
      leftList.type !== rightList.type
    ) {
      return null;
    }
    const remaining = request.graph
      .getChildBlockIds(rightList.id)
      .filter((blockId) => blockId !== rightItem.id);
    if (remaining.length > 0) {
      operations.push(
        moveBlocks({
          blockIds: remaining,
          sourcePlacement: { parentId: rightList.id, childIndex: 1 },
          destinationPlacement: {
            parentId: leftList.id,
            childIndex: request.graph.getChildBlockIds(leftList.id).length,
          },
        }),
      );
    }
    operations.push(
      removeBlocks({
        blockIds: [rightItem.id],
        includeDescendants: false,
        expectedParents: { [rightItem.id]: rightList.id },
      }),
    );
    operations.push(
      removeBlocks({
        blockIds: [rightList.id],
        includeDescendants: false,
        expectedParents: { [rightList.id]: rightList.parentId },
      }),
    );
  } else {
    operations.push(
      removeBlocks({
        blockIds: [rightItem.id],
        includeDescendants: false,
        expectedParents: { [rightItem.id]: rightList.id },
      }),
    );
  }
  return {
    operations,
    expectations: [leftItem, rightItem, leftList, rightList],
    focusBlockId: left.id,
    focusOffset: joinOffset,
    removedRootId: leftList.id === rightList.id ? rightItem.id : rightList.id,
  };
}

function planRemoveEmptyCompound(
  request: EditorStructuralTextBoundaryRequest,
  previous: VersionedBlock,
  wrapper: VersionedBlock,
  focusOffset: number,
): CleanupPlan | null {
  const placement = placementOf(request, wrapper);
  if (!placement) return null;
  return {
    skipTextMerge: true,
    operations: [
      removeBlocks({
        blockIds: [wrapper.id],
        includeDescendants: true,
        expectedParents: { [wrapper.id]: wrapper.parentId },
      }),
    ],
    expectations: [wrapper],
    focusBlockId: previous.id,
    focusOffset,
    removedRootId: wrapper.id,
  };
}

function planUnwrapCompoundDonor(
  request: EditorStructuralTextBoundaryRequest,
  left: VersionedBlock,
  right: VersionedBlock,
  wrapper: VersionedBlock,
  joinOffset: number,
): CleanupPlan | null {
  const body = toggleBody(request, wrapper);
  const placement = placementOf(request, wrapper);
  if (!body || !placement) return null;
  const promoted = request.graph.getChildBlockIds(body.id);
  const operations: StructuralTransactionOperation[] = [];
  if (promoted.length > 0) {
    operations.push(
      moveBlocks({
        blockIds: promoted,
        sourcePlacement: { parentId: body.id, childIndex: 0 },
        destinationPlacement: {
          parentId: wrapper.parentId,
          childIndex: placement.childIndex + 1,
        },
      }),
    );
  }
  operations.push(
    removeBlocks({
      blockIds: [body.id],
      includeDescendants: true,
      expectedParents: { [body.id]: wrapper.id },
    }),
    removeBlocks({
      blockIds: [wrapper.id],
      includeDescendants: false,
      expectedParents: { [wrapper.id]: wrapper.parentId },
    }),
  );
  return {
    operations,
    expectations: [wrapper, body, right],
    focusBlockId: left.id,
    focusOffset: joinOffset,
    removedRootId: wrapper.id,
  };
}

function planUnwrapBoundaryWrapper(
  request: EditorStructuralTextBoundaryRequest,
  left: VersionedBlock,
  right: VersionedBlock,
  wrapper: VersionedBlock,
  joinOffset: number,
): CleanupPlan | null {
  const placement = placementOf(request, wrapper);
  if (!placement) return null;
  const children = request.graph.getChildBlockIds(wrapper.id);
  const promoted = children.filter((blockId) => blockId !== right.id);
  const operations: StructuralTransactionOperation[] = [];
  if (promoted.length > 0) {
    operations.push(
      moveBlocks({
        blockIds: promoted,
        sourcePlacement: { parentId: wrapper.id, childIndex: 0 },
        destinationPlacement: {
          parentId: wrapper.parentId,
          childIndex: placement.childIndex + 1,
        },
      }),
    );
  }
  operations.push(
    removeBlocks({
      blockIds: [wrapper.id],
      includeDescendants: false,
      expectedParents: { [wrapper.id]: wrapper.parentId },
    }),
  );
  return {
    operations,
    expectations: [wrapper],
    focusBlockId: left.id,
    focusOffset: joinOffset,
    removedRootId: wrapper.id,
  };
}

function planEmptyDonorColumnCleanup(
  request: EditorStructuralTextBoundaryRequest,
  donor: VersionedBlock,
  cleanup: CleanupPlan,
): CleanupPlan | null {
  const donorColumn = nearestAncestor(request, donor, ["column"]);
  if (!donorColumn) return cleanup;
  const directDonorRoot = directChildOf(request, donor, donorColumn.id);
  if (!directDonorRoot || directDonorRoot.id !== cleanup.removedRootId) {
    return cleanup;
  }
  const donorChildren = request.graph.getChildBlockIds(donorColumn.id);
  if (donorChildren.length !== 1 || donorChildren[0] !== directDonorRoot.id) {
    return cleanup;
  }
  const columns = parentOf(request, donorColumn);
  if (!columns || columns.type !== "columns") return null;
  const columnIds = request.graph.getChildBlockIds(columns.id);
  if (!columnIds.includes(donorColumn.id) || columnIds.length < 2) return null;
  const operations: StructuralTransactionOperation[] = [
    ...cleanup.operations,
    removeBlocks({
      blockIds: [donorColumn.id],
      includeDescendants: false,
      expectedParents: { [donorColumn.id]: columns.id },
    }),
  ];
  const expectations: VersionedBlock[] = [
    ...cleanup.expectations,
    donorColumn,
    columns,
  ];
  if (columnIds.length === 2) {
    const placement = placementOf(request, columns);
    if (!placement) return null;
    const survivorId = columnIds.find(
      (columnId) => columnId !== donorColumn.id,
    );
    const survivor = survivorId ? request.graph.getBlock(survivorId) : null;
    if (!survivor || survivor.type !== "column") return null;
    expectations.push(survivor);
    const survivorChildren = request.graph.getChildBlockIds(survivor.id);
    for (const childId of survivorChildren) {
      const child = request.graph.getBlock(childId);
      if (!child) return null;
      expectations.push(child);
    }
    operations.push(
      moveBlocks({
        blockIds: survivorChildren,
        sourcePlacement: { parentId: survivor.id, childIndex: 0 },
        destinationPlacement: {
          parentId: columns.parentId,
          childIndex: placement.childIndex,
        },
      }),
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
  return {
    operations,
    expectations,
    focusBlockId: cleanup.focusBlockId,
    focusOffset: cleanup.focusOffset,
    removedRootId: cleanup.removedRootId,
  };
}

function directChildOf(
  request: EditorStructuralTextBoundaryRequest,
  block: VersionedBlock,
  ancestorId: BlockId,
): VersionedBlock | null {
  let current = block;
  while (current.parentId && current.parentId !== ancestorId) {
    const parent = request.graph.getBlock(current.parentId);
    if (!parent) return null;
    current = parent;
  }
  return current.parentId === ancestorId ? current : null;
}

function planTabsBoundary(
  request: EditorStructuralTextBoundaryRequest,
  left: VersionedBlock,
  right: VersionedBlock,
  joinOffset: number,
  rightSize: number,
  direction: Direction,
): FirstDraftBoundaryResult | null {
  const leftStructure = tabPaneStructure(request, left);
  const rightStructure = tabPaneStructure(request, right);
  if (
    (!leftStructure && !rightStructure) ||
    leftStructure?.tabs.id === rightStructure?.tabs.id
  ) {
    return null;
  }

  const emptyPaneChild =
    rightStructure &&
    right.parentId === rightStructure.pane.id &&
    rightSize === 0
      ? {
          block: right,
          structure: rightStructure,
          selection: {
            kind: "text-offset" as const,
            blockId: left.id,
            offset: joinOffset,
          },
          focus: { blockId: left.id, offset: joinOffset },
        }
      : leftStructure &&
          left.parentId === leftStructure.pane.id &&
          joinOffset === 0
        ? {
            block: left,
            structure: leftStructure,
            selection: {
              kind: "text-offset" as const,
              blockId: right.id,
              offset: 0,
            },
            focus: { blockId: right.id, offset: 0 },
          }
        : null;
  if (!emptyPaneChild) return { handled: true };

  return {
    plan: {
      origin:
        direction === "previous"
          ? "first-draft-backspace"
          : "first-draft-delete",
      operations: [
        removeBlocks({
          blockIds: [emptyPaneChild.block.id],
          includeDescendants: false,
          expectedParents: {
            [emptyPaneChild.block.id]: emptyPaneChild.structure.pane.id,
          },
        }),
        setSelection(emptyPaneChild.selection),
      ],
      preconditions: {
        blocks: uniqueExpectations([
          left,
          right,
          emptyPaneChild.structure.pane,
          emptyPaneChild.structure.tabs,
        ]),
      },
    },
    focus: emptyPaneChild.focus,
  };
}

function planIsolatedTabPaneBoundary(
  request: EditorStructuralTextBoundaryRequest,
  focused: VersionedBlock,
  contentSize: number,
  direction: Direction,
): FirstDraftBoundaryResult | null {
  const structure = tabPaneStructure(request, focused);
  if (!structure || focused.parentId !== structure.pane.id) return null;
  if (contentSize !== 0) return { handled: true };
  return {
    plan: {
      origin:
        direction === "previous"
          ? "first-draft-backspace"
          : "first-draft-delete",
      operations: [
        removeBlocks({
          blockIds: [focused.id],
          includeDescendants: false,
          expectedParents: { [focused.id]: structure.pane.id },
        }),
        setSelection({ kind: "none" }),
      ],
      preconditions: {
        blocks: uniqueExpectations([focused, structure.pane, structure.tabs]),
      },
    },
  };
}

function tabPaneStructure(
  request: EditorStructuralTextBoundaryRequest,
  block: VersionedBlock,
): { readonly pane: VersionedBlock; readonly tabs: VersionedBlock } | null {
  const pane = nearestAncestor(request, block, ["tabPane"]);
  const tabs = pane ? parentOf(request, pane) : null;
  return pane && tabs?.type === "tabs" ? { pane, tabs } : null;
}

function parentOf(
  request: EditorStructuralTextBoundaryRequest,
  block: VersionedBlock,
): VersionedBlock | null {
  return block.parentId ? request.graph.getBlock(block.parentId) : null;
}

function siblingsOf(
  request: EditorStructuralTextBoundaryRequest,
  block: VersionedBlock,
): readonly BlockId[] {
  return block.parentId === null
    ? request.graph.getRootBlockIds()
    : request.graph.getChildBlockIds(block.parentId);
}

function placementOf(
  request: EditorStructuralTextBoundaryRequest,
  block: VersionedBlock,
): { readonly parentId: BlockId | null; readonly childIndex: number } | null {
  const index = siblingsOf(request, block).indexOf(block.id);
  return index < 0 ? null : { parentId: block.parentId, childIndex: index };
}

function isPrimary(
  request: EditorStructuralTextBoundaryRequest,
  wrapper: VersionedBlock,
  block: VersionedBlock,
): boolean {
  return request.graph.getChildBlockIds(wrapper.id)[0] === block.id;
}

function toggleBody(
  request: EditorStructuralTextBoundaryRequest,
  wrapper: VersionedBlock,
): VersionedBlock | null {
  const children = request.graph.getChildBlockIds(wrapper.id);
  if (children.length !== 2) return null;
  const body = request.graph.getBlock(children[1]!);
  return body && isToggleBody(body.type) ? body : null;
}

function nearestAncestor(
  request: EditorStructuralTextBoundaryRequest,
  block: VersionedBlock,
  types: readonly string[],
): VersionedBlock | null {
  let current = parentOf(request, block);
  while (current) {
    if (types.includes(current.type)) return current;
    current = parentOf(request, current);
  }
  return null;
}

function isDescendantOf(
  request: EditorStructuralTextBoundaryRequest,
  block: VersionedBlock,
  ancestorId: BlockId,
): boolean {
  let current: VersionedBlock | null = block;
  while (current) {
    if (current.id === ancestorId) return true;
    current = parentOf(request, current);
  }
  return false;
}
