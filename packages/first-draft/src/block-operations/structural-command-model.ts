import {
  createCanonicalBlockRecord,
  type BlockPlacement,
  type CanonicalBlockRecord,
  type StructuralTransactionOperation,
} from "@repo/editor-core/editing";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorBlockCommandExecutionContext,
  EditorStructuralTextBoundaryRequest,
} from "@repo/editor-web/document-runtime";
import type { FirstDraftViewStateStore } from "../blocks/view-state.tsx";

export interface PlannedFirstDraftBoundary {
  readonly plan: {
    readonly origin: string;
    readonly operations: readonly StructuralTransactionOperation[];
    readonly preconditions?: {
      readonly blocks?: readonly BlockExpectation[];
    };
  };
  readonly focus?: { readonly blockId: BlockId; readonly offset: number };
  readonly createdCollapsedBlockId?: BlockId;
}

export interface HandledFirstDraftBoundary {
  readonly handled: true;
}

export type FirstDraftBoundaryResult =
  | PlannedFirstDraftBoundary
  | HandledFirstDraftBoundary;

export interface BlockExpectation {
  readonly blockId: BlockId;
  readonly type: BlockType;
  readonly parentId: BlockId | null;
}

export interface CapturedFirstDraftGraph {
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>;
}

export function captureFirstDraftGraph(
  request: EditorStructuralTextBoundaryRequest,
): CapturedFirstDraftGraph {
  const blocks = {} as Record<BlockId, VersionedBlock>;
  const childIdsByParentId = {} as Record<BlockId, readonly BlockId[]>;
  const visit = (blockId: BlockId) => {
    const block = request.graph.getBlock(blockId);
    if (!block || block.tombstone || blocks[blockId]) return;
    blocks[blockId] = block;
    const children = request.graph.getChildBlockIds(blockId);
    childIdsByParentId[blockId] = children;
    children.forEach(visit);
  };
  const rootBlockIds = request.graph.getRootBlockIds();
  rootBlockIds.forEach(visit);
  return { blocks, rootBlockIds, childIdsByParentId };
}

export function createProductTree(
  type: BlockType,
  parentId: BlockId | null,
): {
  readonly blocks: readonly CanonicalBlockRecord[];
  readonly selectionBlockId: BlockId;
} | null {
  if (type === "paragraph" || type === "heading" || type === "tableCell") {
    const text = createTextRecord(type, parentId);
    return { blocks: [text], selectionBlockId: text.id };
  }
  if (isListItem(type)) {
    const item = createCanonicalBlockRecord({
      type,
      parentId,
      ...(type === "checklistItem" ? { metadata: { checked: false } } : {}),
    });
    const primary = createTextRecord("paragraph", item.id);
    return { blocks: [item, primary], selectionBlockId: primary.id };
  }
  if (isToggle(type)) {
    const wrapper = createCanonicalBlockRecord({ type, parentId });
    const primary = createTextRecord(
      type === "toggleHeading" ? "heading" : "paragraph",
      wrapper.id,
    );
    const body = createCanonicalBlockRecord({
      type:
        type === "toggleHeading"
          ? "toggleHeadingBody"
          : "toggleListItemBody",
      parentId: wrapper.id,
    });
    return {
      blocks: [wrapper, primary, body],
      selectionBlockId: primary.id,
    };
  }
  return null;
}

export function createTextRecord(
  type: BlockType,
  parentId: BlockId | null,
): CanonicalBlockRecord {
  return createCanonicalBlockRecord({
    type,
    parentId,
    content: createBlockRichTextContentFromPlainText(type, ""),
    plainText: "",
  });
}

export function findAdjacentVisibleTextBlock(
  context: EditorBlockCommandExecutionContext,
  request: EditorStructuralTextBoundaryRequest,
  viewState: FirstDraftViewStateStore,
  blockId: BlockId,
  direction: "previous" | "next",
): VersionedBlock | null {
  const snapshot = viewState.getSnapshot();
  const visibleChildren = (parentId: BlockId | null): readonly BlockId[] => {
    if (parentId === null) return request.graph.getRootBlockIds();
    const parent = request.graph.getBlock(parentId);
    if (!parent || parent.tombstone) return [];
    const children = request.graph.getChildBlockIds(parent.id);
    if (isToggle(parent.type) && viewState.isBlockCollapsed(parent.id)) {
      return children.slice(0, 1);
    }
    if (parent.type === "tabs") {
      const selected = snapshot.selectedTabs[parent.id] as BlockId | undefined;
      const effective = selected && children.includes(selected) ? selected : children[0];
      return effective ? [effective] : [];
    }
    return children;
  };
  const edgeText = (id: BlockId, edge: "first" | "last"): VersionedBlock | null => {
    const block = request.graph.getBlock(id);
    if (!block || block.tombstone) return null;
    const definition = context.definition.blocks[block.type];
    if (definition?.kind === "text") return block;
    if (definition?.kind !== "wrapper") return null;
    const children = visibleChildren(block.id);
    const ordered = edge === "first" ? children : [...children].reverse();
    for (const childId of ordered) {
      const found = edgeText(childId, edge);
      if (found) return found;
    }
    return null;
  };
  let current = request.graph.getBlock(blockId);
  const visited = new Set<BlockId>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    const siblings = visibleChildren(current.parentId);
    const index = siblings.indexOf(current.id);
    if (index < 0) return null;
    const step = direction === "next" ? 1 : -1;
    for (
      let siblingIndex = index + step;
      siblingIndex >= 0 && siblingIndex < siblings.length;
      siblingIndex += step
    ) {
      const found = edgeText(
        siblings[siblingIndex]!,
        direction === "next" ? "first" : "last",
      );
      if (found) return found;
    }
    current = current.parentId ? request.graph.getBlock(current.parentId) : null;
  }
  return null;
}

export function validSelection(
  request: EditorStructuralTextBoundaryRequest,
  contentSize: number,
): boolean {
  return (
    Number.isInteger(request.selection.from) &&
    Number.isInteger(request.selection.to) &&
    request.selection.from >= 0 &&
    request.selection.to >= request.selection.from &&
    request.selection.to <= contentSize
  );
}

export function afterBlock(
  request: EditorStructuralTextBoundaryRequest,
  block: VersionedBlock,
): BlockPlacement | null {
  const siblings =
    block.parentId === null
      ? request.graph.getRootBlockIds()
      : request.graph.getChildBlockIds(block.parentId);
  const index = siblings.indexOf(block.id);
  return index < 0
    ? null
    : { parentId: block.parentId, childIndex: index + 1 };
}

export function expectation(block: VersionedBlock): BlockExpectation {
  return { blockId: block.id, type: block.type, parentId: block.parentId };
}

export function uniqueExpectations(
  blocks: readonly VersionedBlock[],
): readonly BlockExpectation[] {
  return [...new Map(blocks.map((block) => [block.id, expectation(block)])).values()];
}

export function insertedRootId(
  plan: PlannedFirstDraftBoundary["plan"],
): BlockId {
  const insertion = plan.operations.find(
    (operation) => operation.kind === "insertBlocks",
  );
  if (!insertion || insertion.kind !== "insertBlocks" || !insertion.blocks[0]) {
    throw new Error("First Draft structural split did not create a root block");
  }
  return insertion.blocks[0].id;
}

export function isToggle(type: string): boolean {
  return type === "toggleHeading" || type === "toggleListItem";
}

export function isToggleBody(type: string): boolean {
  return type === "toggleHeadingBody" || type === "toggleListItemBody";
}

export function isListItem(type: string): boolean {
  return (
    type === "bulletListItem" ||
    type === "orderedListItem" ||
    type === "checklistItem"
  );
}

export function isListContainer(type: string): boolean {
  return type === "bulletList" || type === "orderedList" || type === "checklist";
}

export function isMatchingList(container: string, item: string): boolean {
  return (
    (container === "bulletList" && item === "bulletListItem") ||
    (container === "orderedList" && item === "orderedListItem") ||
    (container === "checklist" && item === "checklistItem")
  );
}
