import {
  blockDefinitionAcceptsParent,
  blockDefinitionAcceptsSequence,
} from "@repo/editor-core/definitions";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorBlockOperationResult } from "@repo/editor-web/block-operations";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";

export type FirstDraftAdjacentParagraphDirection = "before" | "after";

export type FirstDraftAdjacentParagraphAvailability =
  | { readonly kind: "available" }
  | { readonly kind: "disabled" }
  | { readonly kind: "stale" };

type AdjacentParagraphPlan =
  | {
      readonly kind: "insert";
      readonly target: VersionedBlock;
      readonly childIndex: number;
    }
  | {
      readonly kind: "exit-list";
      readonly item: VersionedBlock;
      readonly container: VersionedBlock;
      readonly paragraph: VersionedBlock;
      readonly childIndex: number;
      readonly deleteContainer: boolean;
    };

export function readFirstDraftAdjacentParagraphAvailability(
  editor: FirstDraftEditor,
  blockId: BlockId,
  direction: FirstDraftAdjacentParagraphDirection,
): FirstDraftAdjacentParagraphAvailability {
  const planned = planAdjacentParagraph(editor, blockId, direction);
  return "plan" in planned ? { kind: "available" } : planned;
}

export function insertFirstDraftAdjacentParagraph(
  editor: FirstDraftEditor,
  blockId: BlockId,
  direction: FirstDraftAdjacentParagraphDirection,
): EditorBlockOperationResult {
  const planned = planAdjacentParagraph(editor, blockId, direction);
  if (!("plan" in planned)) {
    return {
      ok: false,
      handled: planned.kind !== "stale",
      reason: planned.kind === "stale" ? "stale-plan" : "invalid-input",
      message:
        planned.kind === "stale"
          ? `Block ${blockId} is unavailable.`
          : "The adjacent paragraph boundary is unavailable.",
    };
  }
  const plan = planned.plan;
  if (plan.kind === "insert") {
    return editor.insertBlockAt({
      placement: {
        parentId: plan.target.parentId,
        childIndex: plan.childIndex,
      },
      blockType: "paragraph",
      selection: true,
    });
  }

  const result = editor.transaction(() => {
    editor.moveBlocks({
      blockIds: [plan.paragraph.id],
      destination: {
        parentId: plan.container.parentId,
        childIndex: plan.childIndex,
      },
    });
    const deletedId = plan.deleteContainer ? plan.container.id : plan.item.id;
    editor.deleteBlocks({
      blockIds: [deletedId],
      includeDescendants: true,
      expectedParents: {
        [deletedId]: plan.deleteContainer
          ? plan.container.parentId
          : plan.container.id,
      },
    });
    editor.setTransactionSelection({
      kind: "text",
      blockId: plan.paragraph.id,
      offset: 0,
    });
  });
  if (result.ok && result.changed) {
    return { ok: true, handled: true, transaction: result };
  }
  return {
    ok: false,
    handled: true,
    reason: "transaction-rejected",
    message: result.ok ? "The insertion made no change." : result.message,
  };
}

export function presentFirstDraftBlockOperationSelection(
  editor: FirstDraftEditor,
  result: Extract<EditorBlockOperationResult, { readonly ok: true }>,
): void {
  const selection = result.transaction.transaction.selection;
  switch (selection.kind) {
    case "text-offset":
      editor.focusText(selection.blockId, {
        offset: selection.offset,
        preventScroll: true,
      });
      return;
    case "atomic":
    case "block-start":
    case "block-end":
      editor.focusBlock(selection.blockId, { preventScroll: true });
      return;
    case "none":
      return;
  }
}

function planAdjacentParagraph(
  editor: FirstDraftEditor,
  blockId: BlockId,
  direction: FirstDraftAdjacentParagraphDirection,
):
  | { readonly plan: AdjacentParagraphPlan }
  | { readonly kind: "disabled" | "stale" } {
  const target = editor.getBlock(blockId);
  if (!target || target.tombstone) return { kind: "stale" };

  const expectedContainerType = listContainerType(target.type);
  if (expectedContainerType) {
    return planListExit(editor, target, expectedContainerType, direction);
  }

  const siblings = directChildIds(editor, target.parentId);
  const targetIndex = siblings.indexOf(target.id);
  if (targetIndex < 0) return { kind: "stale" };
  const childIndex = targetIndex + (direction === "after" ? 1 : 0);
  if (!acceptsParagraphAt(editor, target.parentId, siblings, childIndex)) {
    return { kind: "disabled" };
  }
  return { plan: { kind: "insert", target, childIndex } };
}

function planListExit(
  editor: FirstDraftEditor,
  item: VersionedBlock,
  expectedContainerType: BlockType,
  direction: FirstDraftAdjacentParagraphDirection,
):
  | { readonly plan: AdjacentParagraphPlan }
  | { readonly kind: "disabled" | "stale" } {
  if (!item.parentId) return { kind: "disabled" };
  const container = editor.getBlock(item.parentId);
  if (!container || container.tombstone) return { kind: "stale" };
  if (container.type !== expectedContainerType) return { kind: "disabled" };
  const itemIds = editor.getChildBlockIds(container.id);
  const itemIndex = itemIds.indexOf(item.id);
  if (itemIndex < 0) return { kind: "stale" };
  const itemChildren = editor.getChildBlockIds(item.id);
  if (itemChildren.length !== 1) return { kind: "disabled" };
  const paragraph = editor.getBlock(itemChildren[0]!);
  if (!paragraph || paragraph.tombstone) return { kind: "stale" };
  if (paragraph.type !== "paragraph") return { kind: "disabled" };

  const containerSiblings = directChildIds(editor, container.parentId);
  const containerIndex = containerSiblings.indexOf(container.id);
  if (containerIndex < 0) return { kind: "stale" };
  const deleteContainer = itemIds.length === 1;
  const childIndex = containerIndex + (direction === "after" ? 1 : 0);
  if (
    !acceptsListExit(
      editor,
      container,
      containerSiblings,
      childIndex,
      deleteContainer,
    )
  ) {
    return { kind: "disabled" };
  }
  return {
    plan: {
      kind: "exit-list",
      item,
      container,
      paragraph,
      childIndex,
      deleteContainer,
    },
  };
}

function acceptsParagraphAt(
  editor: FirstDraftEditor,
  parentId: BlockId | null,
  siblingIds: readonly BlockId[],
  childIndex: number,
): boolean {
  const paragraphDefinition = editor.definition.blocks.paragraph;
  if (!paragraphDefinition) return false;
  if (parentId === null) {
    return blockDefinitionAcceptsParent(paragraphDefinition, null);
  }
  const parent = editor.getBlock(parentId);
  const parentDefinition = parent
    ? editor.definition.blocks[parent.type]
    : undefined;
  if (!parentDefinition || parentDefinition.kind !== "wrapper") return false;
  const types = liveTypes(editor, siblingIds);
  if (types.length !== siblingIds.length) return false;
  types.splice(childIndex, 0, "paragraph");
  return blockDefinitionAcceptsSequence(
    editor.definition.blocks,
    parentDefinition,
    types,
  );
}

function acceptsListExit(
  editor: FirstDraftEditor,
  container: VersionedBlock,
  siblingIds: readonly BlockId[],
  childIndex: number,
  deleteContainer: boolean,
): boolean {
  const paragraphDefinition = editor.definition.blocks.paragraph;
  if (!paragraphDefinition) return false;
  if (container.parentId === null) {
    return blockDefinitionAcceptsParent(paragraphDefinition, null);
  }
  const parent = editor.getBlock(container.parentId);
  const parentDefinition = parent
    ? editor.definition.blocks[parent.type]
    : undefined;
  if (!parentDefinition || parentDefinition.kind !== "wrapper") return false;
  const types = liveTypes(editor, siblingIds);
  if (types.length !== siblingIds.length) return false;
  if (deleteContainer) {
    const containerIndex = siblingIds.indexOf(container.id);
    if (containerIndex < 0) return false;
    types.splice(containerIndex, 1, "paragraph");
  } else {
    types.splice(childIndex, 0, "paragraph");
  }
  return blockDefinitionAcceptsSequence(
    editor.definition.blocks,
    parentDefinition,
    types,
  );
}

function directChildIds(
  editor: FirstDraftEditor,
  parentId: BlockId | null,
): readonly BlockId[] {
  return parentId === null
    ? editor.getRootBlockIds()
    : editor.getChildBlockIds(parentId);
}

function liveTypes(
  editor: FirstDraftEditor,
  blockIds: readonly BlockId[],
): BlockType[] {
  return blockIds.flatMap((blockId) => {
    const block = editor.getBlock(blockId);
    return block && !block.tombstone ? [block.type] : [];
  });
}

function listContainerType(itemType: BlockType): BlockType | undefined {
  switch (itemType) {
    case "bulletListItem":
      return "bulletList";
    case "orderedListItem":
      return "orderedList";
    case "checklistItem":
      return "checklist";
    default:
      return undefined;
  }
}
