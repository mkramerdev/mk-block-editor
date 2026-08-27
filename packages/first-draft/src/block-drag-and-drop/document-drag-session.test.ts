import { describe, expect, it, vi } from "vitest";
import type { VersionedBlock } from "@repo/editor-core/document";
import {
  asBlockId,
  asContentVersion,
  type BlockId,
} from "@repo/editor-core/kernel";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";
import type { FirstDraftViewStateStore } from "../blocks/view-state.tsx";
import type { FirstDraftBlockType } from "./document-drag-overlay-contracts.ts";
import { captureFirstDraftDocumentBlockDragSession } from "./document-drag-session.ts";
import {
  FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
  FIRST_DRAFT_TABLE_GRID_BOUNDS_TARGET,
} from "./document-drag-visual-bounds.ts";

const sourceId = asBlockId("source");
const parentId = asBlockId("parent");

describe("First Draft document drag-session capture", () => {
  it("captures and freezes a root placement only after canonical membership is confirmed", () => {
    const fixture = createFixture({ parentId: null, rootIds: [sourceId] });

    const session = captureFirstDraftDocumentBlockDragSession(
      fixture.editor,
      fixture.viewState,
      sourceId,
    );

    expect(session).toMatchObject({
      blockId: sourceId,
      captureSucceeded: true,
      sourcePlacement: { blockId: sourceId, parentId: null, childIndex: 0 },
    });
    expect(Object.isFrozen(session)).toBe(true);
    if (!session.captureSucceeded) throw new Error("Expected valid session");
    expect(Object.isFrozen(session.sourcePlacement)).toBe(true);
    expect(session.preview.block.id).toBe(sourceId);
    expect(fixture.getRootBlockIds).toHaveBeenCalledTimes(2);
    expect(fixture.readBlockContent).toHaveBeenCalledOnce();
    expect(fixture.getSelectedTab).not.toHaveBeenCalled();
    expect(fixture.isBlockCollapsed).not.toHaveBeenCalled();
    expect(fixture.readViewportBlockShellRect).toHaveBeenCalledOnce();
    expect(fixture.readViewportBlockSelectionRect).not.toHaveBeenCalled();
  });

  it("captures a nested direct-child index and rejects missing or changing membership", () => {
    const nested = createFixture({
      parentId,
      childIds: [asBlockId("before"), sourceId],
    });
    const valid = captureFirstDraftDocumentBlockDragSession(
      nested.editor,
      nested.viewState,
      sourceId,
    );
    expect(valid).toMatchObject({
      captureSucceeded: true,
      sourcePlacement: { parentId, childIndex: 1 },
    });

    const missing = createFixture({ parentId: null, rootIds: [] });
    expect(
      captureFirstDraftDocumentBlockDragSession(
        missing.editor,
        missing.viewState,
        sourceId,
      ),
    ).toEqual({ blockId: sourceId, captureSucceeded: false });
    expect(missing.readBlockContent).not.toHaveBeenCalled();

    const changing = createFixture({ parentId: null, rootIds: [sourceId] });
    changing.getRootBlockIds
      .mockReturnValueOnce([sourceId])
      .mockReturnValueOnce([asBlockId("before"), sourceId]);
    expect(
      captureFirstDraftDocumentBlockDragSession(
        changing.editor,
        changing.viewState,
        sourceId,
      ),
    ).toEqual({ blockId: sourceId, captureSucceeded: false });
  });

  it("uses the named visual rectangle instead of the shell for a margin-bearing block", () => {
    const visualRect = Object.freeze({
      left: 19,
      top: 31,
      width: 280,
      height: 44,
    });
    const fixture = createFixture({
      blockType: "heading",
      parentId: null,
      rootIds: [sourceId],
      visualRect,
    });

    const session = captureFirstDraftDocumentBlockDragSession(
      fixture.editor,
      fixture.viewState,
      sourceId,
    );

    expect(session).toMatchObject({ captureSucceeded: true, sourceRect: visualRect });
    expect(fixture.readViewportBlockSelectionRect).toHaveBeenCalledOnce();
    expect(fixture.readViewportBlockSelectionRect).toHaveBeenCalledWith(
      sourceId,
      FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
    );
    expect(fixture.readViewportBlockShellRect).not.toHaveBeenCalled();
  });

  it("uses the full table-grid rectangle rather than table shell or scroll geometry", () => {
    const gridRect = Object.freeze({
      left: -140,
      top: 88,
      width: 920,
      height: 260,
    });
    const fixture = createFixture({
      blockType: "table",
      parentId: null,
      rootIds: [sourceId],
      visualRect: gridRect,
    });

    const session = captureFirstDraftDocumentBlockDragSession(
      fixture.editor,
      fixture.viewState,
      sourceId,
    );

    expect(session).toMatchObject({ captureSucceeded: true, sourceRect: gridRect });
    expect(fixture.readViewportBlockSelectionRect).toHaveBeenCalledWith(
      sourceId,
      FIRST_DRAFT_TABLE_GRID_BOUNDS_TARGET,
    );
    expect(fixture.readViewportBlockShellRect).not.toHaveBeenCalled();
  });

  it.each([
    "missing",
    "duplicated",
    "disconnected",
    "foreign-editor",
    "wrong-block",
  ])(
    "fails closed for a %s required visual target without falling back to the shell",
    () => {
      const fixture = createFixture({
        blockType: "heading",
        parentId: null,
        rootIds: [sourceId],
        visualRect: null,
      });

      const session = captureFirstDraftDocumentBlockDragSession(
        fixture.editor,
        fixture.viewState,
        sourceId,
      );

      expect(session).toEqual({ blockId: sourceId, captureSucceeded: false });
      expect(fixture.readViewportBlockSelectionRect).toHaveBeenCalledWith(
        sourceId,
        FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
      );
      expect(fixture.readViewportBlockShellRect).not.toHaveBeenCalled();
    },
  );

  it("records an invalid operation when shell geometry cannot be captured", () => {
    const fixture = createFixture({
      parentId: null,
      rootIds: [sourceId],
      shellRect: null,
    });

    const session = captureFirstDraftDocumentBlockDragSession(
      fixture.editor,
      fixture.viewState,
      sourceId,
    );

    expect(session).toEqual({ blockId: sourceId, captureSucceeded: false });
    expect(Object.isFrozen(session)).toBe(true);
  });
});

function createFixture(input: {
  readonly blockType?: FirstDraftBlockType;
  readonly parentId: BlockId | null;
  readonly rootIds?: readonly BlockId[];
  readonly childIds?: readonly BlockId[];
  readonly shellRect?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly visualRect?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  } | null;
}) {
  const rowId = asBlockId("source-row");
  const cellId = asBlockId("source-cell");
  const block: VersionedBlock = {
    id: sourceId,
    type: input.blockType ?? "paragraph",
    parentId: input.parentId,
    tombstone: null,
    metadataVersion: "metadata:source",
    contentVersion: null,
  };
  const blocks = new Map<BlockId, VersionedBlock>([[sourceId, block]]);
  if (input.blockType === "table") {
    blocks.set(rowId, {
      id: rowId,
      type: "tableRow",
      parentId: sourceId,
      tombstone: null,
      metadataVersion: "metadata:row",
      contentVersion: null,
    });
    blocks.set(cellId, {
      id: cellId,
      type: "tableCell",
      parentId: rowId,
      tombstone: null,
      metadataVersion: "metadata:cell",
      contentVersion: asContentVersion("content:cell"),
    });
  }
  const getBlock = vi.fn((blockId: BlockId) => blocks.get(blockId) ?? null);
  const getParentId = vi.fn((blockId: BlockId) =>
    blocks.get(blockId)?.parentId ?? null,
  );
  const getRootBlockIds = vi.fn(() => input.rootIds ?? []);
  const getChildBlockIds = vi.fn((blockId: BlockId) => {
    if (input.blockType === "table" && blockId === sourceId) return [rowId];
    if (input.blockType === "table" && blockId === rowId) return [cellId];
    return blockId === input.parentId ? input.childIds ?? [] : [];
  });
  const readBlockContent = vi.fn(() => ({
    type: "doc" as const,
    content: [{ type: "paragraph" as const, content: [] }],
  }));
  const readViewportBlockShellRect = vi.fn(() =>
    input.shellRect === undefined
      ? Object.freeze({ left: 5, top: 7, width: 300, height: 40 })
      : input.shellRect,
  );
  const readViewportBlockSelectionRect = vi.fn(() =>
    input.visualRect === undefined
      ? Object.freeze({ left: 9, top: 11, width: 280, height: 32 })
      : input.visualRect,
  );
  const getSelectedTab = vi.fn(() => null);
  const isBlockCollapsed = vi.fn(() => false);
  const editor = {
    getBlock,
    getParentId,
    getRootBlockIds,
    getChildBlockIds,
    readBlockContent,
    geometry: {
      readViewportBlockShellRect,
      readViewportBlockSelectionRect,
    },
  } as unknown as FirstDraftEditor;
  const viewState = {
    getSelectedTab,
    isBlockCollapsed,
  } as unknown as FirstDraftViewStateStore;
  return {
    editor,
    viewState,
    getRootBlockIds,
    readBlockContent,
    getSelectedTab,
    isBlockCollapsed,
    readViewportBlockShellRect,
    readViewportBlockSelectionRect,
  };
}
