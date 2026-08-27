import type { BlockId } from "@repo/editor-core/kernel";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";
import type { FirstDraftViewStateStore } from "../blocks/view-state.tsx";
import type {
  FirstDraftBlockDragPreviewEditor,
  FirstDraftDocumentBlockDragSession,
  FirstDraftDocumentBlockSourcePlacement,
} from "./document-drag-overlay-contracts.ts";
import { resolveFirstDraftBlockDragPreview } from "./document-drag-overlay-snapshot.ts";
import { readFirstDraftDocumentDragVisualBoundsTarget } from "./document-drag-visual-bounds.ts";

type SourcePlacementReader = Pick<
  FirstDraftEditor,
  | "getBlock"
  | "getParentId"
  | "getChildBlockIds"
  | "getRootBlockIds"
>;

type FirstDraftDocumentBlockDragSessionEditor =
  FirstDraftBlockDragPreviewEditor &
    SourcePlacementReader &
    Pick<FirstDraftEditor, "geometry">;

export function captureFirstDraftDocumentBlockDragSession(
  editor: FirstDraftDocumentBlockDragSessionEditor,
  viewState: FirstDraftViewStateStore,
  blockId: BlockId,
): FirstDraftDocumentBlockDragSession {
  try {
    const sourcePlacement = captureFirstDraftDocumentBlockSourcePlacement(
      editor,
      blockId,
    );
    if (!sourcePlacement) return invalidSession(blockId);
    const preview = resolveFirstDraftBlockDragPreview(editor, viewState, blockId);
    if (!preview) return invalidSession(blockId);
    const visualBoundsTarget = readFirstDraftDocumentDragVisualBoundsTarget(
      preview.block.type,
    );
    if (visualBoundsTarget === undefined) return invalidSession(blockId);
    const sourceRect = visualBoundsTarget
      ? editor.geometry.readViewportBlockSelectionRect(
          blockId,
          visualBoundsTarget,
        )
      : editor.geometry.readViewportBlockShellRect(blockId);
    if (
      !sourceRect ||
      !isFirstDraftDocumentBlockSourcePlacementCurrent(editor, sourcePlacement)
    ) {
      return invalidSession(blockId);
    }
    return Object.freeze({
      blockId,
      captureSucceeded: true,
      preview,
      sourceRect,
      sourcePlacement,
    });
  } catch {
    return invalidSession(blockId);
  }
}

export function captureFirstDraftDocumentBlockSourcePlacement(
  editor: SourcePlacementReader,
  blockId: BlockId,
): FirstDraftDocumentBlockSourcePlacement | null {
  const block = editor.getBlock(blockId);
  if (!block || block.tombstone !== null) return null;
  const parentId = editor.getParentId(blockId);
  if (parentId !== block.parentId) return null;
  const siblings =
    parentId === null
      ? editor.getRootBlockIds()
      : editor.getChildBlockIds(parentId);
  const childIndex = siblings.indexOf(blockId);
  if (childIndex < 0 || siblings.lastIndexOf(blockId) !== childIndex) return null;
  return Object.freeze({ blockId, parentId, childIndex });
}

export function isFirstDraftDocumentBlockSourcePlacementCurrent(
  editor: SourcePlacementReader,
  expected: FirstDraftDocumentBlockSourcePlacement,
): boolean {
  const current = captureFirstDraftDocumentBlockSourcePlacement(
    editor,
    expected.blockId,
  );
  return Boolean(
    current &&
      current.parentId === expected.parentId &&
      current.childIndex === expected.childIndex,
  );
}

function invalidSession(blockId: BlockId): FirstDraftDocumentBlockDragSession {
  return Object.freeze({ blockId, captureSucceeded: false });
}
