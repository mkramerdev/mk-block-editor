import { act, fireEvent, render } from "@testing-library/react";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  createEditorLogicalSelectionPoint,
  readEditorBlockSelectionTarget,
  registerInternalSelectionSubsystem,
} from "@repo/editor-react/selection";
import { describe, expect, it, vi } from "vitest";
import type { BlockRendererProps } from "../api/block-renderer.ts";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import {
  initializeTestEditableEditor as initializeEditableEditor,
  initializeTestReadEditor as initializeReadEditor,
} from "./test-editor-initializers.ts";
import type { EditableEditorDefinition } from "../runtime/definition/contracts.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import {
  testEditableEditorDefinition,
  testReadEditorDefinition,
} from "./test-editor-definition.ts";

const firstId = "phase-one-selection-first" as BlockId;
const secondId = "phase-one-selection-second" as BlockId;
const registeredInternalSubsystem = registerInternalSelectionSubsystem(
  "phase-one.block-internal",
);
if (!registeredInternalSubsystem) {
  throw new Error(
    "Expected the block-internal selection subsystem to register",
  );
}
const internalSubsystem = registeredInternalSubsystem;

describe("editor-owned standalone selection publication", () => {
  it("makes a read-only block pointer-selectable and publishes exactly once", () => {
    const onStandaloneSettlement = vi.fn();
    const editor = initializeReadEditor({
      definition: testReadEditorDefinition,
      snapshot: createTestEditorSnapshot([{ id: firstId, type: "divider" }]),
    });
    editor.selectionController.subscribeStandaloneSettlements(
      onStandaloneSettlement,
    );
    const view = render(<EditorDocument editor={editor} />);
    act(() => settleBlockRange(editor, firstId, firstId, "pointer"));

    expect(editor.selection.getSnapshot().kind).toBe("document");
    expect(onStandaloneSettlement).toHaveBeenCalledTimes(1);
    expect(onStandaloneSettlement).toHaveBeenCalledWith({
      kind: "selection",
      selection: {
        kind: "document",
        direction: "forward",
        anchor: { kind: "block", blockId: firstId, surface: "block" },
        focus: { kind: "block", blockId: firstId, surface: "block" },
      },
    });

    view.unmount();
    editor.dispose();
  });

  it("publishes keyboard range extension only through the standalone boundary", () => {
    const onChange = vi.fn();
    const onStandaloneSettlement = vi.fn();
    const editor = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: firstId, type: "divider" },
        { id: secondId, type: "divider" },
      ]),
      onChange,
    });
    editor.selectionController.subscribeStandaloneSettlements(
      onStandaloneSettlement,
    );
    const view = render(<EditorDocument editor={editor} />);
    act(() => settleBlockRange(editor, firstId, firstId, "pointer"));
    onStandaloneSettlement.mockClear();
    act(() => settleBlockRange(editor, firstId, secondId, "keyboard"));

    expect(onChange).not.toHaveBeenCalled();
    expect(onStandaloneSettlement).toHaveBeenCalledTimes(1);
    expect(onStandaloneSettlement.mock.calls[0]?.[0]).toMatchObject({
      kind: "selection",
      selection: {
        kind: "document",
        anchor: { blockId: firstId },
        focus: { blockId: secondId },
      },
    });

    view.unmount();
    editor.dispose();
  });

  it("publishes arrow navigation only through the standalone boundary", () => {
    const onChange = vi.fn();
    const onStandaloneSettlement = vi.fn();
    const editor = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: firstId, type: "divider" },
        { id: secondId, type: "divider" },
      ]),
      onChange,
    });
    editor.selectionController.subscribeStandaloneSettlements(
      onStandaloneSettlement,
    );
    const view = render(<EditorDocument editor={editor} />);
    act(() => settleBlockRange(editor, firstId, firstId, "pointer"));
    onStandaloneSettlement.mockClear();
    act(() => settleBlockRange(editor, secondId, secondId, "keyboard"));

    expect(onChange).not.toHaveBeenCalled();
    expect(onStandaloneSettlement).toHaveBeenCalledOnce();
    expect(onStandaloneSettlement.mock.calls[0]?.[0]).toMatchObject({
      kind: "selection",
      selection: {
        kind: "document",
        anchor: { blockId: secondId },
        focus: { blockId: secondId },
      },
    });

    view.unmount();
    editor.dispose();
  });

  it("publishes programmatic mutation and history selections only through transactions", () => {
    const onChange = vi.fn();
    const onStandaloneSettlement = vi.fn();
    const editor = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: firstId, type: "paragraph", text: "abc" },
      ]),
      onChange,
    });
    editor.selectionController.subscribeStandaloneSettlements(
      onStandaloneSettlement,
    );
    const view = render(<EditorDocument editor={editor} />);

    act(() => {
      expect(
        editor.insertText({ blockId: firstId, offset: 1, text: "X" }),
      ).toBe(true);
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      historyAction: "command",
      selectionBefore: { kind: "none" },
      selectionAfter: { kind: "none" },
    });
    expect(onStandaloneSettlement).not.toHaveBeenCalled();

    onChange.mockClear();
    act(() => {
      expect(editor.undo()).toEqual({ status: "applied" });
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      historyAction: "undo",
      selectionBefore: { kind: "none" },
      selectionAfter: { kind: "none" },
    });
    expect(onStandaloneSettlement).not.toHaveBeenCalled();

    onChange.mockClear();
    act(() => {
      expect(editor.redo()).toEqual({ status: "applied" });
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      historyAction: "redo",
      selectionBefore: { kind: "none" },
      selectionAfter: { kind: "none" },
    });
    expect(onStandaloneSettlement).not.toHaveBeenCalled();

    view.unmount();
    editor.dispose();
  });

  it("publishes a direct stable JSON block-internal payload", () => {
    const onChange = vi.fn();
    const onStandaloneSettlement = vi.fn();
    const editor = initializeEditableEditor({
      definition: internalSelectionDefinition,
      snapshot: createTestEditorSnapshot([{ id: firstId, type: "divider" }]),
      onChange,
    });
    editor.selectionController.subscribeStandaloneSettlements(
      onStandaloneSettlement,
    );
    const view = render(<EditorDocument editor={editor} />);

    fireEvent.click(view.getByTestId("commit-internal-selection"));

    expect(onChange).not.toHaveBeenCalled();
    expect(onStandaloneSettlement).toHaveBeenCalledOnce();
    expect(onStandaloneSettlement).toHaveBeenCalledWith({
      kind: "selection",
      selection: {
        kind: "block-internal",
        blockId: firstId,
        subsystem: "phase-one.block-internal",
        payload: {
          kind: "cell-range",
          anchorCellId: "cell-a",
          focusCellId: "cell-b",
        },
      },
    });

    view.unmount();
    editor.dispose();
  });

  it("clears a block-internal selection when a primary pointer leaves its subsystem", () => {
    const onChange = vi.fn();
    const onStandaloneSettlement = vi.fn();
    const editor = initializeEditableEditor({
      definition: internalSelectionDefinition,
      snapshot: createTestEditorSnapshot([{ id: firstId, type: "divider" }]),
      onChange,
    });
    editor.selectionController.subscribeStandaloneSettlements(
      onStandaloneSettlement,
    );
    const view = render(<EditorDocument editor={editor} />);
    const internalControl = view.getByTestId("commit-internal-selection");
    fireEvent.pointerDown(internalControl, { button: 0, pointerId: 71 });
    fireEvent.click(internalControl);
    expect(editor.selectionController.getCanonicalSnapshot()).toMatchObject({
      kind: "block-internal",
    });
    onStandaloneSettlement.mockClear();
    const outside = document.createElement("button");
    document.body.append(outside);

    fireEvent.pointerDown(outside, { button: 0, pointerId: 72 });

    expect(editor.selectionController.getCanonicalSnapshot()).toMatchObject({
      kind: "none",
    });
    expect(onStandaloneSettlement).toHaveBeenCalledOnce();
    expect(onStandaloneSettlement).toHaveBeenCalledWith({ kind: "none" });
    expect(onChange).not.toHaveBeenCalled();
    outside.remove();
    view.unmount();
    editor.dispose();
  });

  it("publishes an explicit standalone none when local selection is cleared", () => {
    const onChange = vi.fn();
    const onStandaloneSettlement = vi.fn();
    const editor = initializeEditableEditor({
      definition: internalSelectionDefinition,
      snapshot: createTestEditorSnapshot([{ id: firstId, type: "divider" }]),
      onChange,
    });
    editor.selectionController.subscribeStandaloneSettlements(
      onStandaloneSettlement,
    );
    const view = render(<EditorDocument editor={editor} />);

    fireEvent.click(view.getByTestId("commit-internal-selection"));
    onStandaloneSettlement.mockClear();
    fireEvent.click(view.getByTestId("clear-local-selection"));

    expect(onChange).not.toHaveBeenCalled();
    expect(onStandaloneSettlement).toHaveBeenCalledOnce();
    expect(onStandaloneSettlement).toHaveBeenCalledWith({ kind: "none" });

    view.unmount();
    editor.dispose();
  });
});

function InternalSelectionRenderer({
  block,
  editor,
  selectionController,
}: BlockRendererProps) {
  return (
    <div data-editor-block-internal-selection-host="true">
      <button
        data-testid="commit-internal-selection"
        onClick={() => {
          const target = readEditorBlockSelectionTarget(editor, block.id);
          if (!target) throw new Error("Expected block selection target");
          const payload = {
            kind: "cell-range",
            anchorCellId: "cell-a",
            focusCellId: "cell-b",
          } as const;
          selectionController.commitBlockSelection(
            target,
            {
              blockId: block.id,
              blockType: block.type,
              modelId: target.selection.id,
              coverage: "partial",
              internal: payload,
              stableSelectionPayload: payload,
            },
            internalSubsystem,
            {
              publication: { kind: "standalone-local" },
              cause: "pointer",
            },
            editor.getSelectionGraphRevision(),
          );
        }}
      >
        select cells
      </button>
      <button
        data-testid="clear-local-selection"
        onClick={() =>
          selectionController.clearSelection({
            publication: { kind: "standalone-local" },
            cause: "focus",
          })
        }
      >
        clear selection
      </button>
    </div>
  );
}

const internalSelectionDefinition: EditableEditorDefinition = {
  ...testEditableEditorDefinition,
  blocks: {
    ...testEditableEditorDefinition.blocks,
    divider: {
      ...testEditableEditorDefinition.blocks.divider!,
      renderer: InternalSelectionRenderer,
    },
  },
};

function settleBlockRange(
  editor:
    | ReturnType<typeof initializeEditableEditor>
    | ReturnType<typeof initializeReadEditor>,
  anchorBlockId: BlockId,
  focusBlockId: BlockId,
  cause: "pointer" | "keyboard",
): void {
  const anchor = createEditorLogicalSelectionPoint({
    graph: editor,
    blockId: anchorBlockId,
    textOffset: 0,
  });
  const focus = createEditorLogicalSelectionPoint({
    graph: editor,
    blockId: focusBlockId,
    textOffset: 0,
  });
  if (!anchor || !focus)
    throw new Error("Expected live block selection points");
  const settled = editor.selectionController.extendSelection(
    anchor,
    focus,
    editor,
    editor.getSelectionGraphRevision(),
    { publication: { kind: "standalone-local" }, cause },
  );
  if (!settled) throw new Error("Expected canonical block selection");
}
