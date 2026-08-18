import { extractPlainTextFromRichTextDocument } from "@repo/editor-core/content/rich-text";
import {
  planTextSplitAtPlacement,
  type BlockPlacement,
} from "@repo/editor-core/editing";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorBlockCommandDefinition,
  EditorBlockCommandExecutionContext,
} from "@repo/editor-web/document-runtime";
import type { FirstDraftViewStateStore } from "../view-state.tsx";

const toggleListItemType = "toggleListItem";
const toggleListItemBodyType = "toggleListItemBody";

export const COLLAPSED_TOGGLE_ENTER_COMMAND_ID =
  "first-draft.toggle-list-item.collapsed-summary-enter";

export function createCollapsedToggleEnterCommand(
  viewState: FirstDraftViewStateStore,
): EditorBlockCommandDefinition {
  return {
    id: COLLAPSED_TOGGLE_ENTER_COMMAND_ID,
    scope: "block",
    isEnabled: (context) =>
      resolveCollapsedSummary(context, viewState) !== null,
    execute: (context) => executeCollapsedToggleEnter(context, viewState),
  };
}

function executeCollapsedToggleEnter(
  context: EditorBlockCommandExecutionContext,
  viewState: FirstDraftViewStateStore,
): boolean {
  if (
    context.view.composing ||
    !context.view.state.selection.empty ||
    context.textSelection.from !== context.textSelection.to
  ) {
    return false;
  }
  const resolved = resolveCollapsedSummary(context, viewState);
  if (!resolved) return false;

  const content = context.editor.readBlockContent(
    context.blockId,
    context.blockType,
  );
  if (!content) return false;
  const snapshot = context.editor.readSnapshot();
  const blocks: Record<BlockId, VersionedBlock> = {};
  for (const blockId of Object.keys(snapshot.blocks) as BlockId[]) {
    const block = context.editor.getBlock(blockId);
    if (block) blocks[blockId] = block;
  }
  const planned = planTextSplitAtPlacement({
    selectionBlockId: context.blockId,
    selection: context.textSelection,
    content: {
      content,
      plainText: extractPlainTextFromRichTextDocument(content),
      version: blocks[context.blockId]?.contentVersion ?? null,
    },
    blocks,
    rootBlockIds: snapshot.rootBlockIds,
    childIdsByParentId: snapshot.childIdsByParentId,
    blockDefinitions: context.definition.blocks,
    resultType: resolved.wrapper.type,
    placement: resolved.placement,
  });
  if (!planned.ok) return false;

  viewState.setBlockCollapsed(planned.insertedRootBlockId, true);
  const result = context.executeStructuralTransaction(planned.plan);
  if (!result.ok) {
    viewState.deleteBlockState(planned.insertedRootBlockId);
    return false;
  }

  context.editor.focusText(planned.selectionBlockId, {
    offset: 0,
    preventScroll: true,
  });
  return true;
}

function resolveCollapsedSummary(
  context: EditorBlockCommandExecutionContext,
  viewState: FirstDraftViewStateStore,
): {
  readonly wrapper: NonNullable<ReturnType<typeof context.editor.getBlock>>;
  readonly placement: BlockPlacement;
} | null {
  const summary = context.editor.getBlock(context.blockId);
  if (!summary || summary.tombstone || summary.parentId === null) return null;
  const wrapper = context.editor.getBlock(summary.parentId);
  if (
    !wrapper ||
    wrapper.tombstone ||
    wrapper.type !== toggleListItemType ||
    !viewState.isBlockCollapsed(wrapper.id)
  ) {
    return null;
  }
  const wrapperChildren = context.editor.getChildBlockIds(wrapper.id);
  if (
    wrapperChildren[0] !== summary.id ||
    wrapperChildren.length !== 2 ||
    context.editor.getBlock(wrapperChildren[1]!)?.type !== toggleListItemBodyType
  ) {
    return null;
  }
  const siblingIds =
    wrapper.parentId === null
      ? context.editor.getRootBlockIds()
      : context.editor.getChildBlockIds(wrapper.parentId);
  const wrapperIndex = siblingIds.indexOf(wrapper.id);
  if (wrapperIndex < 0) return null;
  return {
    wrapper,
    placement: {
      parentId: wrapper.parentId,
      childIndex: wrapperIndex + 1,
    },
  };
}
