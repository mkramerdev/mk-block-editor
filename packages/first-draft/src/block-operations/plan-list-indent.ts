import {
  createCanonicalBlockRecord,
  insertBlocks,
  moveBlocks,
  removeBlocks,
  type StructuralTransactionOperation,
} from "@repo/editor-core/editing";
import type {
  EditorBlockCommandExecutionContext,
  EditorStructuralTextBoundaryRequest,
} from "@repo/editor-web/document-runtime";
import {
  expectation,
  isListItem,
  isMatchingList,
  uniqueExpectations,
  type PlannedFirstDraftBoundary,
} from "./structural-command-model.ts";

export function planFirstDraftListIndent(
  _context: EditorBlockCommandExecutionContext,
  request: EditorStructuralTextBoundaryRequest,
  outdent: boolean,
): PlannedFirstDraftBoundary | null {
  const item = request.focusedBlock.parentId
    ? request.graph.getBlock(request.focusedBlock.parentId)
    : null;
  if (!item || !isListItem(item.type) || item.parentId === null) return null;
  const container = request.graph.getBlock(item.parentId);
  if (!container || !isMatchingList(container.type, item.type)) return null;
  const siblings = request.graph.getChildBlockIds(container.id);
  const index = siblings.indexOf(item.id);
  if (index < 0) return null;

  if (outdent) {
    const outerItem = container.parentId
      ? request.graph.getBlock(container.parentId)
      : null;
    const outerContainer = outerItem?.parentId
      ? request.graph.getBlock(outerItem.parentId)
      : null;
    if (
      !outerItem ||
      !outerContainer ||
      !isListItem(outerItem.type) ||
      !isMatchingList(outerContainer.type, item.type)
    ) {
      return null;
    }
    const outerSiblings = request.graph.getChildBlockIds(outerContainer.id);
    const outerIndex = outerSiblings.indexOf(outerItem.id);
    if (outerIndex < 0) return null;
    const operations: StructuralTransactionOperation[] = [
      moveBlocks({
        blockIds: [item.id],
        sourcePlacement: { parentId: container.id, childIndex: index },
        destinationPlacement: {
          parentId: outerContainer.id,
          childIndex: outerIndex + 1,
        },
      }),
    ];
    if (siblings.length === 1) {
      operations.push(
        removeBlocks({
          blockIds: [container.id],
          includeDescendants: false,
          expectedParents: { [container.id]: outerItem.id },
        }),
      );
    }
    return {
      plan: {
        origin: "first-draft-list-outdent",
        operations,
        preconditions: {
          blocks: uniqueExpectations([
            request.focusedBlock,
            item,
            container,
            outerItem,
            outerContainer,
          ]),
        },
      },
    };
  }

  if (index === 0) return null;
  const previous = request.graph.getBlock(siblings[index - 1]!);
  if (!previous || !isListItem(previous.type) || previous.type !== item.type) {
    return null;
  }
  const existingNestedId = request.graph
    .getChildBlockIds(previous.id)
    .find((blockId) => request.graph.getBlock(blockId)?.type === container.type);
  const nested = existingNestedId
    ? null
    : createCanonicalBlockRecord({ type: container.type, parentId: previous.id });
  const nestedId = existingNestedId ?? nested!.id;
  const operations: StructuralTransactionOperation[] = [];
  if (nested) {
    operations.push(
      insertBlocks({
        placement: {
          parentId: previous.id,
          childIndex: request.graph.getChildBlockIds(previous.id).length,
        },
        blocks: [nested],
      }),
    );
  }
  operations.push(
    moveBlocks({
      blockIds: [item.id],
      sourcePlacement: { parentId: container.id, childIndex: index },
      destinationPlacement: {
        parentId: nestedId,
        childIndex: existingNestedId
          ? request.graph.getChildBlockIds(existingNestedId).length
          : 0,
      },
    }),
  );
  return {
    plan: {
      origin: "first-draft-list-indent",
      operations,
      preconditions: {
        blocks: [expectation(request.focusedBlock), expectation(item), expectation(container), expectation(previous)],
      },
    },
  };
}
