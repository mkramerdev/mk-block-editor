import {
  blockDefinitionAcceptsParent,
  blockDefinitionAcceptsSequence,
} from "@repo/editor-core/definitions";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { BlockPlacement } from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorBlockOperationResult } from "@repo/editor-web/block-operations";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";
import {
  isFirstDraftDocumentBlockSourcePlacementCurrent,
} from "../block-drag-and-drop/document-drag-session.ts";
import type { FirstDraftDocumentBlockSourcePlacement } from "../block-drag-and-drop/document-drag-overlay-contracts.ts";

const LIST_CONTAINER_BY_ITEM_TYPE = Object.freeze({
  bulletListItem: "bulletList",
  orderedListItem: "orderedList",
  checklistItem: "checklist",
} as const satisfies Readonly<Record<string, BlockType>>);

type FirstDraftListItemType = keyof typeof LIST_CONTAINER_BY_ITEM_TYPE;

/** Dispatches a document-block drop without teaching the generic editor about lists. */
export function moveFirstDraftDocumentBlock(
  editor: FirstDraftEditor,
  expectedSource: FirstDraftDocumentBlockSourcePlacement,
  position: BlockPlacement,
): EditorBlockOperationResult {
  if (!isFirstDraftDocumentBlockSourcePlacementCurrent(editor, expectedSource)) {
    return stalePlan("The dragged block source placement is stale.");
  }
  const blockId = expectedSource.blockId;
  const block = liveBlock(editor, blockId);
  if (!block || !isFirstDraftListItemType(block.type)) {
    return editor.moveBlockToPosition({ blockId, position });
  }
  return extractFirstDraftListItem(editor, block, position);
}

function extractFirstDraftListItem(
  editor: FirstDraftEditor,
  item: VersionedBlock,
  position: BlockPlacement,
): EditorBlockOperationResult {
  if (!isFirstDraftListItemType(item.type)) {
    return invalidInput("The dragged block is not a list item.");
  }
  const container =
    item.parentId === null ? null : liveBlock(editor, item.parentId);
  if (
    !container ||
    container.type !== LIST_CONTAINER_BY_ITEM_TYPE[item.type]
  ) {
    return invalidInput("The list item no longer has its matching list container.");
  }

  const containerChildren = readLiveDirectChildren(editor, container.id);
  if (!containerChildren || !containerChildren.some(({ id }) => id === item.id)) {
    return stalePlan("The list item is no longer a direct child of its list.");
  }
  const itemChildren = readLiveDirectChildren(editor, item.id);
  if (!itemChildren || itemChildren[0]?.type !== "paragraph") {
    return invalidInput("The list item no longer has its required first paragraph.");
  }
  if (!isValidPosition(position)) {
    return invalidInput("The destination position is invalid.");
  }
  if (
    position.parentId !== null &&
    isBlockOrDescendant(editor, position.parentId, item.id)
  ) {
    return invalidInput("A list item cannot be extracted into its own subtree.");
  }

  const destinationChildren = readLiveDirectChildren(editor, position.parentId);
  if (
    !destinationChildren ||
    position.childIndex > destinationChildren.length
  ) {
    return stalePlan("The destination boundary is stale.");
  }

  const finalContainerChildren = containerChildren.filter(
    ({ id }) => id !== item.id,
  );
  const removeContainer = finalContainerChildren.length === 0;
  const affectedSequences = new Map<BlockId | null, VersionedBlock[]>();
  affectedSequences.set(position.parentId, [...destinationChildren]);
  affectedSequences.get(position.parentId)!.splice(
    position.childIndex,
    0,
    ...itemChildren,
  );

  if (removeContainer) {
    const containerParentChildren =
      affectedSequences.get(container.parentId) ??
      readLiveDirectChildren(editor, container.parentId);
    if (!containerParentChildren) {
      return stalePlan("The list container boundary is stale.");
    }
    const finalChildren = [...containerParentChildren].filter(
      ({ id }) => id !== container.id,
    );
    if (finalChildren.length === containerParentChildren.length) {
      return stalePlan("The list container is no longer a direct child.");
    }
    affectedSequences.set(container.parentId, finalChildren);
  } else {
    const destinationSequence = affectedSequences.get(container.id);
    affectedSequences.set(
      container.id,
      (destinationSequence ?? containerChildren).filter(
        ({ id }) => id !== item.id,
      ),
    );
  }

  for (const [parentId, children] of affectedSequences) {
    if (!acceptsFinalSequence(editor, parentId, children)) {
      return invalidInput(
        "The destination cannot accept the list item's promoted children.",
      );
    }
  }

  const transaction = editor.transaction(() => {
    editor.moveBlocks({
      blockIds: itemChildren.map(({ id }) => id),
      destination: position,
    });
    const removed = removeContainer ? container : item;
    editor.deleteBlocks({
      blockIds: [removed.id],
      includeDescendants: true,
      expectedParents: { [removed.id]: removed.parentId },
    });
    editor.setTransactionSelection({ kind: "preserve" });
  });
  return transactionResult(transaction);
}

function readLiveDirectChildren(
  editor: FirstDraftEditor,
  parentId: BlockId | null,
): readonly VersionedBlock[] | null {
  const childIds =
    parentId === null
      ? editor.getRootBlockIds()
      : editor.getChildBlockIds(parentId);
  const children: VersionedBlock[] = [];
  for (const childId of childIds) {
    const child = liveBlock(editor, childId);
    if (!child || child.parentId !== parentId) return null;
    children.push(child);
  }
  return children;
}

function acceptsFinalSequence(
  editor: FirstDraftEditor,
  parentId: BlockId | null,
  children: readonly VersionedBlock[],
): boolean {
  const definitions = editor.definition.blocks;
  if (parentId === null) {
    return children.every((child) => {
      const definition = definitions[child.type];
      return Boolean(
        definition && blockDefinitionAcceptsParent(definition, null),
      );
    });
  }
  const parent = liveBlock(editor, parentId);
  const definition = parent ? definitions[parent.type] : undefined;
  return Boolean(
    definition &&
      blockDefinitionAcceptsSequence(
        definitions,
        definition,
        children.map(({ type }) => type),
      ),
  );
}

function isBlockOrDescendant(
  editor: FirstDraftEditor,
  blockId: BlockId,
  possibleAncestorId: BlockId,
): boolean {
  let currentId: BlockId | null = blockId;
  const visited = new Set<BlockId>();
  while (currentId !== null) {
    if (currentId === possibleAncestorId) return true;
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    const current = liveBlock(editor, currentId);
    if (!current) return true;
    currentId = current.parentId;
  }
  return false;
}

function isFirstDraftListItemType(type: string): type is FirstDraftListItemType {
  return Object.prototype.hasOwnProperty.call(LIST_CONTAINER_BY_ITEM_TYPE, type);
}

function liveBlock(
  editor: Pick<FirstDraftEditor, "getBlock">,
  blockId: BlockId,
): VersionedBlock | null {
  const block = editor.getBlock(blockId);
  return block && !block.tombstone ? block : null;
}

function isValidPosition(position: BlockPlacement): boolean {
  return Boolean(
    position &&
      Number.isInteger(position.childIndex) &&
      position.childIndex >= 0,
  );
}

function transactionResult(
  transaction: ReturnType<FirstDraftEditor["transaction"]>,
): EditorBlockOperationResult {
  if (transaction.ok && transaction.changed) {
    return { ok: true, handled: true, transaction };
  }
  if (transaction.ok) {
    return {
      ok: false,
      handled: false,
      reason: "no-change",
      message: "The operation would not change the document.",
    };
  }
  return {
    ok: false,
    handled: true,
    reason: "transaction-rejected",
    message: transaction.message,
  };
}

function invalidInput(message: string): EditorBlockOperationResult {
  return { ok: false, handled: false, reason: "invalid-input", message };
}

function stalePlan(message: string): EditorBlockOperationResult {
  return { ok: false, handled: true, reason: "stale-plan", message };
}
