import { asBlockId } from "@repo/editor-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { createEditorSelectionTextAnchor } from "@repo/editor-react/selection";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import type { EditorSemanticChange } from "../document/contracts.ts";
import { initializeTestEditableEditor as initializeEditableEditor } from "../../tests/test-editor-initializers.ts";
import type { EditableEditorRuntimePort } from "../document/render-port.ts";
import type { EditableEditorDefinition } from "../definition/contracts.ts";

const textBlockId = asBlockId("selection-color-text");
const atomicBlockId = asBlockId("selection-color-atomic");
const subject = {
  actorId: "actor-a",
  clientId: "client-a",
  sessionId: "session-a",
};
const selection = {
  kind: "selection" as const,
  selection: {
    kind: "document" as const,
    direction: "forward" as const,
    anchor: {
      kind: "block" as const,
      blockId: atomicBlockId,
      surface: "block" as const,
    },
    focus: {
      kind: "block" as const,
      blockId: atomicBlockId,
      surface: "block" as const,
    },
  },
};

describe("additional selection canonical reconciliation", () => {
  it("re-resolves a transported Yjs anchor after every local insertion before it", () => {
    const editor = createTextEditor("abcd");
    installTextSelection(editor, textBlockId, 2, 11);
    const initial = onlyRecord(editor);
    const stableSelection = initial.stableSelection;
    const notify = vi.fn();
    editor.additionalSelections.subscribe(notify);

    expect(resolvedOffsets(editor)).toEqual([2, 2]);
    expect(editor.insertText({ blockId: textBlockId, offset: 0, text: "X" })).toBe(
      true,
    );
    expect(resolvedOffsets(editor)).toEqual([3, 3]);
    expect(editor.insertText({ blockId: textBlockId, offset: 0, text: "Y" })).toBe(
      true,
    );
    expect(resolvedOffsets(editor)).toEqual([4, 4]);
    expect(editor.insertText({ blockId: textBlockId, offset: 0, text: "Z" })).toBe(
      true,
    );

    const resolved = onlyRecord(editor);
    expect(resolvedOffsets(editor)).toEqual([5, 5]);
    expect(resolved.stableSelection).toEqual(stableSelection);
    expect(resolved.subject).toBe(initial.subject);
    expect(resolved.watermark).toBe(11);
    expect(notify).toHaveBeenCalledTimes(3);
    editor.dispose();
  });

  it("does not notify when a local insertion after the anchor resolves identically", () => {
    const editor = createTextEditor("abcd");
    installTextSelection(editor, textBlockId, 2);
    const notify = vi.fn();
    editor.additionalSelections.subscribe(notify);

    expect(editor.insertText({ blockId: textBlockId, offset: 4, text: "X" })).toBe(
      true,
    );
    expect(resolvedOffsets(editor)).toEqual([2, 2]);
    expect(notify).not.toHaveBeenCalled();
    editor.dispose();
  });

  it("re-resolves both endpoints of a noncollapsed remote selection", () => {
    const editor = createTextEditor("abcdef");
    const anchor = runtime(editor).createSelectionTextPoint(textBlockId, 1);
    const focus = runtime(editor).createSelectionTextPoint(textBlockId, 4);
    if (!anchor || !focus) throw new Error("Expected stable range points");
    editor.setSelections({
      entries: [
        {
          subject,
          selectionRevision: 1,
          selection: stableDocumentRange(anchor, focus),
        },
      ],
    });

    expect(editor.insertText({ blockId: textBlockId, offset: 0, text: "X" })).toBe(
      true,
    );
    expect(resolvedOffsets(editor)).toEqual([2, 5]);
    editor.dispose();
  });

  it("preserves the codec association for insertion exactly at the anchor", () => {
    const backward = createTextEditor("abcd");
    installTextSelection(backward, textBlockId, 2, 1, "backward");
    expect(
      backward.insertText({ blockId: textBlockId, offset: 2, text: "X" }),
    ).toBe(true);
    expect(resolvedOffsets(backward)).toEqual([2, 2]);
    backward.dispose();

    const forward = createTextEditor("abcd");
    installTextSelection(forward, textBlockId, 2, 1, "forward");
    expect(
      forward.insertText({ blockId: textBlockId, offset: 2, text: "X" }),
    ).toBe(true);
    expect(resolvedOffsets(forward)).toEqual([3, 3]);
    forward.dispose();
  });

  it("re-resolves deletions before and spanning an anchor", () => {
    const before = createTextEditor("abcdef");
    installTextSelection(before, textBlockId, 4);
    expect(
      before.deleteText({ blockId: textBlockId, range: { from: 1, to: 3 } }),
    ).toBe(true);
    expect(resolvedOffsets(before)).toEqual([2, 2]);
    before.dispose();

    const spanning = createTextEditor("abcdef");
    installTextSelection(spanning, textBlockId, 4);
    expect(
      spanning.deleteText({
        blockId: textBlockId,
        range: { from: 2, to: 5 },
      }),
    ).toBe(true);
    expect(resolvedOffsets(spanning)).toEqual([2, 2]);
    spanning.dispose();
  });

  it("re-resolves local replacement, undo, and redo commits", () => {
    const editor = createTextEditor("abcdef");
    installTextSelection(editor, textBlockId, 4);
    const notify = vi.fn();
    editor.additionalSelections.subscribe(notify);

    expect(
      editor.transaction(() => {
        editor.deleteText({
          blockId: textBlockId,
          range: { from: 0, to: 1 },
        });
        editor.insertText({ blockId: textBlockId, offset: 0, text: "XYZ" });
      }),
    ).toMatchObject({ ok: true, changed: true });
    expect(resolvedOffsets(editor)).toEqual([6, 6]);
    expect(notify).toHaveBeenCalledOnce();

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(resolvedOffsets(editor)).toEqual([4, 4]);
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(resolvedOffsets(editor)).toEqual([6, 6]);
    expect(notify).toHaveBeenCalledTimes(3);
    editor.dispose();
  });

  it("makes a locally deleted selection block unresolved and retains its fallback", () => {
    const editor = createTextEditor("abcd", [
      { id: atomicBlockId, type: "atomicBlock" },
    ]);
    installTextSelection(editor, textBlockId, 2);
    const stableSelection = onlyRecord(editor).stableSelection;
    const notify = vi.fn();
    editor.additionalSelections.subscribe(notify);

    expect(
      editor.transaction(() => {
        editor.deleteBlocks({
          blockIds: [textBlockId],
          includeDescendants: true,
        });
      }),
    ).toMatchObject({ ok: true, changed: true });
    expect(onlyRecord(editor)).toMatchObject({
      resolution: "unresolved",
      resolvedSelection: null,
      stableSelection,
    });
    expect(notify).toHaveBeenCalledOnce();

    notify.mockClear();
    expect(
      editor.updateBlockMetadata([
        { blockId: atomicBlockId, values: { unchangedFallback: true } },
      ]),
    ).toBe(true);
    expect(onlyRecord(editor)).toMatchObject({
      resolution: "unresolved",
      resolvedSelection: null,
      stableSelection,
    });
    expect(notify).not.toHaveBeenCalled();
    editor.dispose();
  });

  it("keeps block-internal and moved text selections valid without false notifications", () => {
    const definition: EditableEditorDefinition = {
      ...testEditableEditorDefinition,
      blockInternalSelectionSubsystems: [
        {
          id: "test.semantic-selection",
          validate: ({ payload }) => ({
            ok: true,
            payload,
            resolution: "resolved",
          }),
        },
      ],
    };
    const editor = initializeEditableEditor({
      definition,
      snapshot: createTestEditorSnapshot([
        { id: textBlockId, type: "textBlock", text: "abcd" },
        { id: atomicBlockId, type: "atomicBlock" },
      ]),
    });
    installTextSelection(editor, textBlockId, 2);
    const notify = vi.fn();
    editor.additionalSelections.subscribe(notify);

    expect(
      editor.transaction(() => {
        editor.moveBlocks({
          blockIds: [textBlockId],
          destination: { parentId: null, childIndex: 1 },
        });
      }),
    ).toMatchObject({ ok: true, changed: true });
    expect(resolvedOffsets(editor)).toEqual([2, 2]);
    expect(notify).not.toHaveBeenCalled();

    editor.setSelections({
      entries: [
        {
          subject,
          selectionRevision: 2,
          selection: {
            kind: "selection",
            selection: {
              kind: "block-internal",
              blockId: atomicBlockId,
              subsystem: "test.semantic-selection",
              payload: { cell: 1 },
            },
          },
        },
      ],
    });
    notify.mockClear();
    expect(
      editor.updateBlockMetadata([
        { blockId: textBlockId, values: { graphStillValid: true } },
      ]),
    ).toBe(true);
    expect(onlyRecord(editor)).toMatchObject({
      resolution: "resolved",
      resolvedSelection: {
        kind: "block-internal",
        blockId: atomicBlockId,
        payload: { cell: 1 },
      },
    });
    expect(notify).not.toHaveBeenCalled();
    editor.dispose();
  });

  it("does not reactivate inactive presence during local commits", () => {
    const editor = createTextEditor("abcd");
    installTextSelection(editor, textBlockId, 2);
    editor.setSelections({ entries: [] });
    expect(onlyRecord(editor)).toMatchObject({
      active: false,
      resolution: "inactive",
      stableSelection: null,
      resolvedSelection: null,
    });
    const notify = vi.fn();
    editor.additionalSelections.subscribe(notify);

    expect(editor.insertText({ blockId: textBlockId, offset: 0, text: "X" })).toBe(
      true,
    );
    expect(onlyRecord(editor)).toMatchObject({
      active: false,
      resolution: "inactive",
      stableSelection: null,
      resolvedSelection: null,
    });
    expect(notify).not.toHaveBeenCalled();
    editor.dispose();
  });

  it("reconciles formatting commits without changing a stable numeric projection", () => {
    const editor = createTextEditor("abcd");
    installTextSelection(editor, textBlockId, 2);
    const notify = vi.fn();
    editor.additionalSelections.subscribe(notify);

    expect(
      editor.updateMark({
        blockId: textBlockId,
        range: { from: 0, to: 4 },
        mark: { type: "strong" },
        enabled: true,
      }),
    ).toBe(true);
    expect(resolvedOffsets(editor)).toEqual([2, 2]);
    expect(notify).not.toHaveBeenCalled();
    editor.dispose();
  });

  it("atomically re-resolves existing records and installs a remote author sidecar once", () => {
    const snapshot = createTestEditorSnapshot([
      { id: textBlockId, type: "textBlock", text: "abcd" },
    ]);
    let donorChange: EditorSemanticChange | null = null;
    const donor = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
      onChange: (change) => {
        donorChange = change;
      },
    });
    const receiver = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
    });
    installTextSelection(receiver, textBlockId, 2);
    expect(donor.insertText({ blockId: textBlockId, offset: 0, text: "X" })).toBe(
      true,
    );
    const authorPoint = runtime(donor).createSelectionTextPoint(textBlockId, 1);
    if (!authorPoint) throw new Error("Expected author text point");
    const notify = vi.fn();
    receiver.additionalSelections.subscribe(notify);

    const result = receiver.applyRemoteTransaction({
      transaction: {
        transactionId: "atomic-additional-selection-reconcile",
        historyAction: "command",
        graph: null,
        metadata: null,
        content: [
          {
            blockId: textBlockId,
            blockType: "textBlock",
            update: requireContentChange(donorChange).yjsUpdate,
            readProjection: requireContentChange(donorChange).readProjection,
          },
        ],
      },
      authorSelection: {
        kind: "author-selection",
        subject: {
          actorId: "actor-b",
          clientId: "client-b",
          sessionId: "session-b",
        },
        selectionRevision: 4,
        selectionAfter: stableDocumentSelection(authorPoint),
      },
    });

    expect(result).toMatchObject({
      status: "applied",
      authorSelection: { status: "installed" },
    });
    expect(notify).toHaveBeenCalledOnce();
    expect(
      receiver.additionalSelections
        .getSnapshot()
        .map((record) =>
          record.resolvedSelection?.kind === "document"
            ? record.resolvedSelection.anchor.textOffset
            : null,
        ),
    ).toEqual([3, 1]);
    donor.dispose();
    receiver.dispose();
  });
});

describe("additional selection color state", () => {
  it("notifies for same-revision color changes and safely rejects invalid colors", () => {
    const editor = createEditor();
    const notify = vi.fn();
    editor.additionalSelections.subscribe(notify);

    editor.setSelections({
      entries: [{ subject, selectionRevision: 7, selection }],
    });
    expect(editor.additionalSelections.getSnapshot()[0]?.color).toBeNull();

    notify.mockClear();
    editor.setSelections({
      entries: [{ subject, selectionRevision: 7, selection, color: "#123456" }],
    });
    expect(notify).toHaveBeenCalledOnce();
    expect(editor.additionalSelections.getSnapshot()[0]?.color).toBe("#123456");

    notify.mockClear();
    editor.setSelections({
      entries: [{ subject, selectionRevision: 7, selection, color: "red" }],
    });
    expect(notify).toHaveBeenCalledOnce();
    expect(editor.additionalSelections.getSnapshot()[0]?.color).toBeNull();
    editor.dispose();
  });

  it("preserves participant color while graph/content invalidation re-resolves", () => {
    const snapshot = createSnapshot();
    let donorChange: EditorSemanticChange | null = null;
    const donor = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
      onChange: (change) => {
        donorChange = change;
      },
    });
    const receiver = initializeEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
    });
    receiver.setSelections({
      entries: [{ subject, selectionRevision: 3, selection, color: "#abcdef" }],
    });
    expect(
      donor.insertText({ blockId: textBlockId, offset: 1, text: "X" }),
    ).toBe(true);
    const contentChange = requireContentChange(donorChange);
    const result = receiver.applyRemoteTransaction({
      transaction: {
        transactionId: "selection-color-reresolve",
        historyAction: "command",
        graph: null,
        metadata: null,
        content: [
          {
            blockId: textBlockId,
            blockType: "textBlock",
            update: contentChange.yjsUpdate,
            readProjection: contentChange.readProjection,
          },
        ],
      },
      authorSelection: { kind: "no-author-selection" },
    });

    expect(result.status).toBe("applied");
    expect(receiver.additionalSelections.getSnapshot()[0]).toMatchObject({
      color: "#abcdef",
      resolution: "resolved",
      watermark: 3,
    });
    donor.dispose();
    receiver.dispose();
  });

  it("projects repeated inactive text presence without acquiring block content", () => {
    const source = createEditor();
    const sourceRuntime = source as EditableEditorRuntimePort;
    const sourceLease = sourceRuntime.contentRuntime.acquireBlockContent(
      textBlockId,
      "textBlock",
      "canonical-transaction",
    );
    const encoded = sourceRuntime.contentRuntime.createTextAnchorInContext(
      sourceLease,
      { textOffset: 1, affinity: null },
    );
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) throw new Error("Expected a source text anchor");
    const stableAnchor = createEditorSelectionTextAnchor({
      codec: encoded.codec,
      payload: encoded.payload,
    });
    expect(stableAnchor.ok).toBe(true);
    if (!stableAnchor.ok) throw new Error("Expected a stable text anchor");
    sourceLease.release();
    source.dispose();

    const receiver = createEditor();
    const runtime = receiver as EditableEditorRuntimePort;
    const acquire = vi.spyOn(runtime.contentRuntime, "acquireBlockContent");
    for (let revision = 1; revision <= 100; revision += 1) {
      const point = {
        kind: "text" as const,
        blockId: textBlockId,
        textOffset: revision % 2,
        textAnchor: stableAnchor.textAnchor,
        affinity: null,
      };
      receiver.setSelections({
        entries: [
          {
            subject,
            selectionRevision: revision,
            selection: {
              kind: "selection",
              selection: {
                kind: "document",
                direction: "forward",
                anchor: point,
                focus: point,
              },
            },
          },
        ],
      });
      expect(acquire).not.toHaveBeenCalled();
    }
    receiver.dispose();
  });

  it("does not notify for reordered block-internal JSON payloads", () => {
    const definition: EditableEditorDefinition = {
      ...testEditableEditorDefinition,
      blockInternalSelectionSubsystems: [
        {
          id: "test.semantic-selection",
          validate: ({ payload }) => ({
            ok: true,
            payload,
            resolution: "resolved",
          }),
        },
      ],
    };
    const editor = initializeEditableEditor({
      definition,
      snapshot: createSnapshot(),
    });
    const notify = vi.fn();
    editor.additionalSelections.subscribe(notify);
    const entry = (payload: unknown) => ({
      subject,
      selectionRevision: 1,
      selection: {
        kind: "selection",
        selection: {
          kind: "block-internal",
          blockId: atomicBlockId,
          subsystem: "test.semantic-selection",
          payload,
        },
      },
    });

    editor.setSelections({
      entries: [entry({ a: 1, nested: { x: true, y: false }, order: [1, 2] })],
    });
    expect(notify).toHaveBeenCalledOnce();

    notify.mockClear();
    editor.setSelections({
      entries: [entry({ order: [1, 2], nested: { y: false, x: true }, a: 1 })],
    });
    expect(notify).not.toHaveBeenCalled();

    editor.setSelections({
      entries: [entry({ order: [2, 1], nested: { y: false, x: true }, a: 1 })],
    });
    expect(notify).toHaveBeenCalledOnce();
    editor.dispose();
  });
});

function createEditor() {
  return initializeEditableEditor({
    definition: testEditableEditorDefinition,
    snapshot: createSnapshot(),
  });
}

function createTextEditor(
  text: string,
  additional: readonly { id: typeof atomicBlockId; type: "atomicBlock" }[] = [],
) {
  return initializeEditableEditor({
    definition: testEditableEditorDefinition,
    snapshot: createTestEditorSnapshot([
      { id: textBlockId, type: "textBlock", text },
      ...additional,
    ]),
  });
}

function runtime(editor: ReturnType<typeof createEditor>): EditableEditorRuntimePort {
  return editor as EditableEditorRuntimePort;
}

function stableDocumentSelection(
  anchor: NonNullable<ReturnType<EditableEditorRuntimePort["createSelectionTextPoint"]>>,
) {
  return stableDocumentRange(anchor, anchor);
}

function stableDocumentRange(
  anchor: NonNullable<ReturnType<EditableEditorRuntimePort["createSelectionTextPoint"]>>,
  focus: NonNullable<ReturnType<EditableEditorRuntimePort["createSelectionTextPoint"]>>,
) {
  const stableAnchor = {
    kind: "text" as const,
    blockId: anchor.blockId,
    textOffset: anchor.textOffset,
    textAnchor: anchor.textAnchor,
    affinity: anchor.affinity,
  };
  const stableFocus = {
    kind: "text" as const,
    blockId: focus.blockId,
    textOffset: focus.textOffset,
    textAnchor: focus.textAnchor,
    affinity: focus.affinity,
  };
  return {
    kind: "selection" as const,
    selection: {
      kind: "document" as const,
      direction: "forward" as const,
      anchor: stableAnchor,
      focus: stableFocus,
    },
  };
}

function installTextSelection(
  editor: ReturnType<typeof createEditor>,
  blockId: typeof textBlockId,
  offset: number,
  selectionRevision = 1,
  affinity: "forward" | "backward" | null = null,
): void {
  const point = runtime(editor).createSelectionTextPoint(
    blockId,
    offset,
    affinity,
  );
  if (!point) throw new Error("Expected stable Yjs text point");
  editor.setSelections({
    entries: [
      {
        subject,
        selectionRevision,
        selection: stableDocumentSelection(point),
      },
    ],
  });
}

function onlyRecord(editor: ReturnType<typeof createEditor>) {
  const record = editor.additionalSelections.getSnapshot()[0];
  if (!record) throw new Error("Expected one additional selection");
  return record;
}

function resolvedOffsets(
  editor: ReturnType<typeof createEditor>,
): readonly [number, number] {
  const resolved = onlyRecord(editor).resolvedSelection;
  if (!resolved || resolved.kind !== "document") {
    throw new Error("Expected a resolved document selection");
  }
  return [resolved.anchor.textOffset, resolved.focus.textOffset];
}

function createSnapshot() {
  return createTestEditorSnapshot([
    { id: textBlockId, type: "textBlock", text: "A" },
    { id: atomicBlockId, type: "atomicBlock" },
  ]);
}

function requireContentChange(
  change: EditorSemanticChange | null,
): Extract<EditorSemanticChange, { readonly kind: "block-content" }> {
  expect(change).not.toBeNull();
  if (!change || change.kind !== "block-content") {
    throw new Error("Expected donor content change");
  }
  return change;
}
