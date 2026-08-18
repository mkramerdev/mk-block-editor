import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import type { BlockId } from "@repo/editor-core/kernel";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import { readEditorBlockSelectionTarget } from "@repo/editor-web/block-renderer";
import { EditorDocument } from "@repo/editor-web/document-runtime";
import { initializeTestEditableEditor as initializeEditableEditor } from "../../test-editor.ts";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
} from "../view-state.tsx";
import { createFirstDraftEditorDefinition } from "../../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../../first-draft-fixture.ts";
import { handleTransaction } from "../../transport/handle-transaction.ts";
import {
  createTableRangeCoverage,
  tableInternalSelectionSubsystem,
} from "./selection.ts";
import {
  FirstDraftBlockHoverProvider,
  FirstDraftBlockHoverTracker,
} from "../../block-controls/index.ts";

const id = (value: string) => value as BlockId;
const disposables: Array<{ dispose(): void }> = [];

afterEach(() => {
  cleanup();
  for (const editor of disposables.splice(0)) editor.dispose();
  vi.restoreAllMocks();
});

describe("First Draft table-cell boundary commands", () => {
  it("consumes Backspace in an empty cell without replacing that cell", () => {
    const onChange = vi.fn();
    const viewState = createFirstDraftViewStateStore();
    const editor = addEditorBlockOperations(
      initializeEditableEditor({
        definition: createFirstDraftEditorDefinition(viewState),
        snapshot: createFirstDraftSnapshot(),
        onChange,
      }),
    );
    disposables.push(editor);
    const cellId = id("fd-table-cell-2-2");
    editor.transaction(() => {
      editor.replaceText(cellId, { from: 0, to: 3, text: "" });
      editor.setTransactionSelection({ kind: "preserve" });
    });
    const priorEditBlockId = id("fd-paragraph-outro");
    const priorText = editor.readBlockPlainText(priorEditBlockId, "paragraph");
    expect(
      editor.insertText({ blockId: priorEditBlockId, offset: 0, text: "X" }),
    ).toBe(true);
    onChange.mockClear();
    const structural = vi.spyOn(editor, "executeStructuralTransaction");
    const rendered = render(
      <FirstDraftViewStateProvider store={viewState}>
        <FirstDraftBlockHoverProvider enabled={editor.editable}>
          <FirstDraftBlockHoverTracker>
            <EditorDocument editor={editor} />
          </FirstDraftBlockHoverTracker>
        </FirstDraftBlockHoverProvider>
      </FirstDraftViewStateProvider>,
    );
    const rowId = editor.getBlock(cellId)?.parentId;
    const tableId = rowId ? editor.getBlock(rowId)?.parentId : null;
    const rowChildren = rowId ? [...editor.getChildBlockIds(rowId)] : [];

    act(() => {
      expect(editor.focusText(cellId, { offset: 0, preventScroll: true })).toEqual({
        status: "focused",
      });
    });
    const root = textRoot(rendered.container, cellId);
    const editorView = activeEditorView(editor);
    const dispatched = Array.from({ length: 3 }, () =>
      fireEvent.keyDown(root, { key: "Backspace" }),
    );

    expect(dispatched).toEqual([false, false, false]);
    expect(editor.getBlock(cellId)).not.toBeNull();
    expect(editor.getBlock(cellId)?.tombstone).not.toBe(true);
    expect(editor.getBlock(cellId)?.parentId).toBe(rowId);
    expect(rowId ? editor.getChildBlockIds(rowId) : []).toEqual(rowChildren);
    expect(rowId && editor.getBlock(rowId)?.tombstone).not.toBe(true);
    expect(tableId && editor.getBlock(tableId)?.tombstone).not.toBe(true);
    expect(textRoot(rendered.container, cellId)).toBe(root);
    expect(activeEditorView(editor)).toBe(editorView);
    expect(document.activeElement).toBe(root);
    expect(nativeCaretOffset(root)).toBe(0);
    expect(structural).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.readBlockPlainText(cellId, "tableCell")).toBe("Ada");
    expect(editor.readBlockPlainText(priorEditBlockId, "paragraph")).toBe(
      priorText,
    );
    expect(editor.undo()).toEqual({ status: "history-empty" });
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(editor.readBlockPlainText(cellId, "tableCell")).toBe("Ada");
    expect(editor.readBlockPlainText(priorEditBlockId, "paragraph")).toBe(
      `X${priorText}`,
    );
    expect(editor.redo()).toEqual({ status: "history-empty" });
  });

  it("consumes Backspace in first, middle, and last non-empty cells without changing any identity", () => {
    const fixture = renderFixture();
    const tableId = id("fd-table");
    const rowId = id("fd-table-row-1");
    const table = fixture.editor.getBlock(tableId);
    const row = fixture.editor.getBlock(rowId);
    const rowOrder = [...fixture.editor.getChildBlockIds(rowId)];
    const editorIdentity = fixture.editor;

    for (const cellId of rowOrder) {
      act(() => {
        expect(
          fixture.editor.focusText(cellId, {
            offset: 0,
            preventScroll: true,
          }),
        ).toEqual({ status: "focused" });
      });
      const cell = fixture.editor.getBlock(cellId);
      const root = textRoot(fixture.container, cellId);
      const editorView = activeEditorView(fixture.editor);
      expect(fireEvent.keyDown(root, { key: "Backspace" })).toBe(false);
      expect(fixture.editor.getBlock(cellId)).toBe(cell);
      expect(fixture.editor.getBlock(rowId)).toBe(row);
      expect(fixture.editor.getBlock(tableId)).toBe(table);
      expect(fixture.editor.getChildBlockIds(rowId)).toEqual(rowOrder);
      expect(textRoot(fixture.container, cellId)).toBe(root);
      expect(activeEditorView(fixture.editor)).toBe(editorView);
      expect(document.activeElement).toBe(root);
      expect(nativeCaretOffset(root)).toBe(0);
      expect(fixture.editor).toBe(editorIdentity);
    }

    expect(fixture.structural).not.toHaveBeenCalled();
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(fixture.editor.canUndo).toBe(false);
  });

  it("protects the original cell in a rectangular one-by-one table", () => {
    const fixture = renderFixture(oneCellTableSnapshot());
    const cellId = id("fd-table-cell-1-1");
    const rowId = id("fd-table-row-1");
    const tableId = id("fd-table");
    const cell = fixture.editor.getBlock(cellId);
    const row = fixture.editor.getBlock(rowId);
    const table = fixture.editor.getBlock(tableId);

    act(() => {
      fixture.editor.focusText(cellId, { offset: 0, preventScroll: true });
    });
    const root = textRoot(fixture.container, cellId);
    const editorView = activeEditorView(fixture.editor);
    expect(fireEvent.keyDown(root, { key: "Backspace" })).toBe(false);

    expect(fixture.editor.getBlock(cellId)).toBe(cell);
    expect(fixture.editor.getBlock(rowId)).toBe(row);
    expect(fixture.editor.getBlock(tableId)).toBe(table);
    expect(fixture.editor.getChildBlockIds(tableId)).toEqual([rowId]);
    expect(fixture.editor.getChildBlockIds(rowId)).toEqual([cellId]);
    expect(textRoot(fixture.container, cellId)).toBe(root);
    expect(activeEditorView(fixture.editor)).toBe(editorView);
    expect(fixture.structural).not.toHaveBeenCalled();
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(fixture.editor.canUndo).toBe(false);
  });

  it("consumes forward Delete at content end without removing the following cell", () => {
    const fixture = renderFixture();
    const cellId = id("fd-table-cell-2-2");
    const nextCellId = id("fd-table-cell-2-3");
    const nextCell = fixture.editor.getBlock(nextCellId);
    const end = fixture.editor.readBlockPlainText(cellId, "tableCell").length;
    act(() => {
      fixture.editor.focusText(cellId, { offset: end, preventScroll: true });
    });
    const root = textRoot(fixture.container, cellId);

    expect(fireEvent.keyDown(root, { key: "Delete" })).toBe(false);
    expect(fixture.editor.getBlock(nextCellId)).toBe(nextCell);
    expect(textRoot(fixture.container, cellId)).toBe(root);
    expect(nativeCaretOffset(root)).toBe(end);
    expect(fixture.structural).not.toHaveBeenCalled();
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(fixture.editor.canUndo).toBe(false);
  });

  it.each(["Backspace", "Delete"])(
    "preserves table-range %s clearing as one canonical content transaction",
    (key) => {
      const fixture = renderFixture();
      const tableId = id("fd-table");
      const selectedCellIds = [
        id("fd-table-cell-1-1"),
        id("fd-table-cell-1-2"),
        id("fd-table-cell-2-1"),
        id("fd-table-cell-2-2"),
      ];
      const identities = selectedCellIds.map((cellId) =>
        fixture.editor.getBlock(cellId),
      );
      const target = readEditorBlockSelectionTarget(fixture.editor, tableId);
      if (!target) throw new Error("Missing table selection target");
      act(() => {
        expect(
          fixture.editor.selectionController.commitBlockSelection(
            target,
            createTableRangeCoverage(
              tableId,
              "table",
              {
                kind: "cell-range",
                anchorCellId: selectedCellIds[0]!,
                headCellId: selectedCellIds[3]!,
              },
              fixture.editor,
            ),
            tableInternalSelectionSubsystem,
            {
              publication: { kind: "standalone-local" },
              cause: "keyboard",
            },
            fixture.editor.getSelectionGraphRevision(),
          ),
        ).toMatchObject({ kind: "changed" });
      });
      const grid = fixture.container.querySelector<HTMLElement>(
        `[data-editor-block-id='${tableId}'] [data-table-grid]`,
      );
      if (!grid) throw new Error("Missing table grid");

      expect(fireEvent.keyDown(grid, { key })).toBe(false);
      selectedCellIds.forEach((cellId, index) => {
        expect(fixture.editor.getBlock(cellId)).toBe(identities[index]);
        expect(
          fixture.editor.readBlockPlainText(cellId, "tableCell"),
        ).toBe("");
      });
      expect(fixture.onChange).toHaveBeenCalledTimes(1);
      expect(fixture.structural).not.toHaveBeenCalled();
      expect(fixture.editor.getChildBlockIds(tableId)).toHaveLength(3);
      for (const rowId of fixture.editor.getChildBlockIds(tableId)) {
        expect(fixture.editor.getChildBlockIds(rowId)).toHaveLength(3);
      }
    },
  );

  it("publishes no collaboration or persistence work and reloads the same structure", () => {
    const frames: ArrayBuffer[] = [];
    const persistence = vi.fn();
    const onChange = handleTransaction({
      readyState: 1,
      send(frame) {
        frames.push(frame);
        persistence(frame);
      },
    });
    const viewState = createFirstDraftViewStateStore();
    const editor = initializeEditableEditor({
      definition: createFirstDraftEditorDefinition(viewState),
      snapshot: oneCellTableSnapshot(),
      onChange,
    });
    disposables.push(editor);
    const peer = initializeEditableEditor({
      definition: createFirstDraftEditorDefinition(
        createFirstDraftViewStateStore(),
      ),
      snapshot: oneCellTableSnapshot(),
    });
    disposables.push(peer);
    const peerCell = peer.getBlock(id("fd-table-cell-1-1"));
    const peerText = peer.readBlockPlainText(
      id("fd-table-cell-1-1"),
      "tableCell",
    );
    const rendered = render(
      <FirstDraftViewStateProvider store={viewState}>
        <FirstDraftBlockHoverProvider enabled={editor.editable}>
          <FirstDraftBlockHoverTracker>
            <EditorDocument editor={editor} />
          </FirstDraftBlockHoverTracker>
        </FirstDraftBlockHoverProvider>
      </FirstDraftViewStateProvider>,
    );
    const cellId = id("fd-table-cell-1-1");
    const rowId = id("fd-table-row-1");
    const tableId = id("fd-table");
    act(() => {
      editor.focusText(cellId, { offset: 0, preventScroll: true });
    });

    expect(
      fireEvent.keyDown(textRoot(rendered.container, cellId), {
        key: "Backspace",
      }),
    ).toBe(false);
    expect(frames).toEqual([]);
    expect(persistence).not.toHaveBeenCalled();
    expect(peer.getBlock(cellId)).toBe(peerCell);
    expect(peer.readBlockPlainText(cellId, "tableCell")).toBe(peerText);

    const reloaded = initializeEditableEditor({
      definition: createFirstDraftEditorDefinition(
        createFirstDraftViewStateStore(),
      ),
      snapshot: editor.readSnapshot(),
    });
    disposables.push(reloaded);
    expect(reloaded.getBlock(tableId)?.id).toBe(tableId);
    expect(reloaded.getBlock(rowId)?.id).toBe(rowId);
    expect(reloaded.getBlock(cellId)?.id).toBe(cellId);
    expect(reloaded.getChildBlockIds(tableId)).toEqual([rowId]);
    expect(reloaded.getChildBlockIds(rowId)).toEqual([cellId]);
  });

  it("keeps row append, column append, and resize behavior operational", () => {
    const fixture = renderFixture();
    const tableId = id("fd-table");
    const addRow = fixture.container.querySelector<HTMLButtonElement>(
      `[data-editor-block-id='${tableId}'] button[aria-label='Add table row']`,
    );
    const addColumn = fixture.container.querySelector<HTMLButtonElement>(
      `[data-editor-block-id='${tableId}'] button[aria-label='Add table column']`,
    );
    if (!addRow || !addColumn) throw new Error("Missing table append controls");

    fireEvent.pointerDown(addRow, { button: 0 });
    expect(fixture.editor.getChildBlockIds(tableId)).toHaveLength(4);
    fireEvent.pointerDown(addColumn, { button: 0 });
    for (const rowId of fixture.editor.getChildBlockIds(tableId)) {
      expect(fixture.editor.getChildBlockIds(rowId)).toHaveLength(4);
    }

    const resize = fixture.container.querySelector<HTMLElement>(
      `[data-editor-block-id='${tableId}'] [aria-label='Resize column 1']`,
    );
    if (!resize) throw new Error("Missing table resize control");
    const widthBefore = Number(resize.getAttribute("aria-valuenow"));
    fireEvent.keyDown(resize, { key: "ArrowRight" });
    expect(Number(resize.getAttribute("aria-valuenow"))).toBe(widthBefore + 8);
  });
});

function renderFixture(snapshot = createFirstDraftSnapshot()) {
  const onChange = vi.fn();
  const viewState = createFirstDraftViewStateStore();
  const editor = addEditorBlockOperations(
    initializeEditableEditor({
      definition: createFirstDraftEditorDefinition(viewState),
      snapshot,
      onChange,
    }),
  );
  disposables.push(editor);
  const structural = vi.spyOn(editor, "executeStructuralTransaction");
  const rendered = render(
    <FirstDraftViewStateProvider store={viewState}>
      <FirstDraftBlockHoverProvider enabled={editor.editable}>
        <FirstDraftBlockHoverTracker>
          <EditorDocument editor={editor} />
        </FirstDraftBlockHoverTracker>
      </FirstDraftBlockHoverProvider>
    </FirstDraftViewStateProvider>,
  );
  return { ...rendered, editor, onChange, structural };
}

function oneCellTableSnapshot(): EditorInstanceSnapshot {
  const source = createFirstDraftSnapshot();
  const removed = new Set<BlockId>([
    id("fd-table-cell-1-2"),
    id("fd-table-cell-1-3"),
    id("fd-table-row-2"),
    id("fd-table-cell-2-1"),
    id("fd-table-cell-2-2"),
    id("fd-table-cell-2-3"),
    id("fd-table-row-3"),
    id("fd-table-cell-3-1"),
    id("fd-table-cell-3-2"),
    id("fd-table-cell-3-3"),
  ]);
  const keepEntries = <Value,>(record: Readonly<Partial<Record<BlockId, Value>>>) =>
    Object.fromEntries(
      Object.entries(record).filter(([blockId]) => !removed.has(id(blockId))),
    ) as Partial<Record<BlockId, Value>>;
  return {
    ...source,
    blocks: keepEntries(source.blocks) as EditorInstanceSnapshot["blocks"],
    childIdsByParentId: {
      ...keepEntries(source.childIdsByParentId),
      [id("fd-table")]: [id("fd-table-row-1")],
      [id("fd-table-row-1")]: [id("fd-table-cell-1-1")],
    },
    content: keepEntries(source.content),
    opaqueContentCheckpoints: keepEntries(source.opaqueContentCheckpoints),
  };
}

function textRoot(container: ParentNode, blockId: BlockId): HTMLElement {
  const root = container.querySelector<HTMLElement>(
    `[data-editor-block-id='${blockId}'] [data-editor-text-root='true']`,
  );
  if (!root) throw new Error(`Missing text root for ${blockId}`);
  return root;
}

function nativeCaretOffset(root: HTMLElement): number | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.focusNode || !root.contains(selection.focusNode)) return null;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(selection.focusNode, selection.focusOffset);
  return range.toString().length;
}

function activeEditorView(editor: unknown): unknown {
  return (
    editor as { readonly readActiveTextView: () => unknown }
  ).readActiveTextView();
}
