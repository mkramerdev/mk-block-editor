import { describe, expect, it, vi } from "vitest";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType } from "@repo/editor-core/document";
import {
  asBlockId,
  asContentVersion,
  type JsonValue,
} from "@repo/editor-core/kernel";
import type { UpdateBlockMetadataOperation } from "@repo/editor-core/operations";
import { createVersionedBlockRecord } from "@repo/editor-core/metadata";
import { createEditorExternalStore } from "../../../store/external-store.ts";
import { createInitialEditorSessionState } from "../../../store/session-state.ts";
import type {
  CanonicalEditorCommit,
  InitializeEditorImplementationOptions,
} from "../api/contracts.ts";
import type {
  EditorSelection,
  EditorSelectionTextAnchorResolver,
} from "../../../selection/model/types.ts";
import { createEditorSelectionTextAnchor } from "../../../selection/anchors/text-anchor.ts";
import { createInitialEditorManifestState } from "../state/command-state.ts";
import type { EditorHistoryEntry, EditorHistorySelection } from "../history.ts";
import { EditorImplementation } from "./editor-implementation.ts";

const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  textBlock: {
    kind: "text",
    type: "textBlock",
  },
  containerWrapper: {
    kind: "atomic",
    type: "containerWrapper",
  },
};
const blockId = asBlockId("01890f07-1c00-7000-8000-000000000001");
const missingBlockId = asBlockId("01890f07-1c00-7000-8000-000000000002");
const secondBlockId = asBlockId("01890f07-1c00-7000-8000-000000000003");
const testTextAnchorResolver: EditorSelectionTextAnchorResolver = {
  resolveTextAnchor: (point) => ({
    ok: true,
    blockId: point.blockId,
    textAnchor: point.textAnchor!,
    textOffset: point.textOffset,
    affinity: point.affinity,
  }),
};

interface HistoryTestAccess {
  readonly history: readonly EditorHistoryEntry[];
  readonly historyIndex: number;
}

function createTestEditor(
  options: {
    readonly maximumHistoryEntries?: number;
    readonly onCanonicalCommit?: (
      commit: CanonicalEditorCommit,
      editor: EditorImplementation,
    ) => void;
    readonly resolveSelectionTextAnchor?: NonNullable<
      InitializeEditorImplementationOptions["resolveSelectionTextAnchor"]
    >;
    readonly createSelectionTextAnchor?: NonNullable<
      InitializeEditorImplementationOptions["createSelectionTextAnchor"]
    >;
    readonly acquireTextContentAccess?: NonNullable<
      InitializeEditorImplementationOptions["acquireTextContentAccess"]
    >;
  } = {},
): EditorImplementation {
  const block = createVersionedBlockRecord({
    id: blockId,
    type: "textBlock",
    parentId: null,
    version: {
      metadataVersion: "1",
      contentVersion: asContentVersion("1"),
    },
  });
  const secondBlock = createVersionedBlockRecord({
    id: secondBlockId,
    type: "containerWrapper",
    parentId: null,
    metadata: { existing: "kept", nested: { width: 100, height: 80 } },
    version: {
      metadataVersion: "1",
      contentVersion: asContentVersion("1"),
    },
  });
  const editor = new EditorImplementation({
    store: createEditorExternalStore(createInitialEditorSessionState({})),
    manifest: createInitialEditorManifestState({
      blocks: { [blockId]: block, [secondBlockId]: secondBlock },
      rootBlockIds: [blockId, secondBlockId],
      childIdsByParentId: {},
    }),
    blockDefinitions: definitions,
    defaultRootBlockType: "textBlock",
    inlineMarks: [],
    readBlockPlainText: () => "history selection",
    resolveSelectionTextAnchor:
      options.resolveSelectionTextAnchor ??
      testTextAnchorResolver.resolveTextAnchor,
    ...(options.createSelectionTextAnchor === undefined
      ? {}
      : { createSelectionTextAnchor: options.createSelectionTextAnchor }),
    ...(options.acquireTextContentAccess === undefined
      ? {}
      : { acquireTextContentAccess: options.acquireTextContentAccess }),
    ...(options.maximumHistoryEntries === undefined
      ? {}
      : { maximumHistoryEntries: options.maximumHistoryEntries }),
    onCanonicalCommit: (commit) => options.onCanonicalCommit?.(commit, editor),
  });
  return editor;
}

function setMetadata(
  editor: EditorImplementation,
  value: JsonValue,
  field = "value",
): boolean {
  return editor.updateBlockMetadata([{ blockId, values: { [field]: value } }]);
}

function metadataValue(
  editor: EditorImplementation,
  field = "value",
): JsonValue | undefined {
  return editor.getBlock(blockId)?.metadata?.[field];
}

function applyInvalidMetadataUpdate(editor: EditorImplementation): boolean {
  return editor.updateBlockMetadata([
    { blockId: missingBlockId, values: { value: "invalid" } },
  ]);
}

function removeTestBlock(editor: EditorImplementation): void {
  const replacement = createVersionedBlockRecord({
    id: missingBlockId,
    type: "textBlock",
    parentId: null,
    version: {
      metadataVersion: "1",
      contentVersion: asContentVersion("1"),
    },
  });
  editor.reconcileEditorSnapshotForRecovery({
    origin: "external-snapshot",
    blockGraphVersion: editor.getEditorInfo().blockGraphVersion + 1,
    blocks: { [missingBlockId]: replacement },
    rootBlockIds: [missingBlockId],
    childIdsByParentId: {},
  });
}

function historyAccess(editor: EditorImplementation): HistoryTestAccess {
  return editor as unknown as HistoryTestAccess;
}

function expectLinearHistoryState(
  editor: EditorImplementation,
  expected: {
    readonly length: number;
    readonly index: number;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly maximum: number;
  },
): void {
  const access = historyAccess(editor);
  expect(access.history).toHaveLength(expected.length);
  expect(access.historyIndex).toBe(expected.index);
  expect(access.historyIndex).toBeGreaterThanOrEqual(0);
  expect(access.historyIndex).toBeLessThanOrEqual(access.history.length);
  expect(access.history.length).toBeLessThanOrEqual(expected.maximum);
  expect(editor.canUndo).toBe(expected.canUndo);
  expect(editor.canRedo).toBe(expected.canRedo);
  expect(editor.canUndo).toBe(access.historyIndex > 0);
  expect(editor.canRedo).toBe(access.historyIndex < access.history.length);
}

function logicalSelection(offset: number): EditorSelection {
  const anchor = createEditorSelectionTextAnchor({
    codec: "test-runtime-anchor",
    payload: {
      encoded: ["AA==", "AQ==", "Ag==", "Aw=="][offset] ?? "BA==",
      assoc: 1,
    },
  });
  if (!anchor.ok) throw new Error(anchor.message);
  const point = {
    blockId,
    blockType: "textBlock",
    blockCategory: "text" as const,
    textOffset: offset,
    textAnchor: anchor.textAnchor,
    affinity: null,
  };
  return {
    direction: "forward",
    anchor: { ...point },
    focus: { ...point },
  };
}

function readCanonicalFocusOffset(
  editor: EditorImplementation,
): number | undefined {
  const canonical = editor.selectionController.canonical.getSnapshot();
  return canonical.kind === "none"
    ? undefined
    : canonical.snapshot.documentSelection.focus?.textOffset;
}

function settleTestSelection(
  editor: EditorImplementation,
  selection: EditorSelection,
): void {
  expect(
    editor.selectionController.commitCanonicalSelection(
      selection,
      editor,
      editor.getSelectionGraphRevision(),
      {
        publication: { kind: "silent" },
        cause: "canonical-rebase",
      },
      testTextAnchorResolver,
    ),
  ).toMatchObject({ kind: "changed" });
}

function clearTestSelection(editor: EditorImplementation): void {
  expect(
    editor.selectionController.commitCanonicalSelection(
      null,
      editor,
      editor.getSelectionGraphRevision(),
      {
        publication: { kind: "silent" },
        cause: "canonical-rebase",
      },
      null,
    ),
  ).toEqual({ kind: "changed", selection: null });
}

describe("EditorImplementation linear history", () => {
  it("starts empty and treats empty commands as notification-free no-ops", () => {
    const editor = createTestEditor();
    const listener = vi.fn();
    editor.commandAvailability.subscribe(listener);

    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
    expect(editor.undo()).toEqual({ status: "history-empty" });
    expect(editor.redo()).toEqual({ status: "history-empty" });
    expect(listener).not.toHaveBeenCalled();
    expect(metadataValue(editor)).toBeUndefined();
    editor.dispose();
  });

  it("records a completed metadata pair and replays inverse and forward operations", () => {
    const editor = createTestEditor();

    expect(setMetadata(editor, "first")).toBe(true);
    expect(metadataValue(editor)).toBe("first");
    expect(editor.canUndo).toBe(true);
    expect(editor.canRedo).toBe(false);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBeUndefined();
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);

    expect(editor.redo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBe("first");
    expect(editor.canUndo).toBe(true);
    expect(editor.canRedo).toBe(false);
    editor.dispose();
  });

  it("commits a multi-block shallow update as one transaction and one history entry", () => {
    const onCanonicalCommit = vi.fn();
    const editor = createTestEditor({ onCanonicalCommit });
    const nested = { width: 320 };
    const array = [1, 2, 3];
    const beforeVersion = editor.getEditorInfo().blockGraphVersion;

    expect(
      editor.updateBlockMetadata([
        {
          blockId,
          values: { introduced: true, nullable: null },
        },
        {
          blockId: secondBlockId,
          values: { nested, array },
        },
      ]),
    ).toBe(true);

    expect(onCanonicalCommit).toHaveBeenCalledOnce();
    expect(editor.getEditorInfo().blockGraphVersion).toBe(beforeVersion + 1);
    expect(historyAccess(editor).history).toHaveLength(1);
    expect(editor.getBlock(blockId)?.metadata).toStrictEqual({
      introduced: true,
      nullable: null,
    });
    expect(editor.getBlock(secondBlockId)?.metadata).toStrictEqual({
      existing: "kept",
      nested: { width: 320 },
      array: [1, 2, 3],
    });

    nested.width = 999;
    array.push(4);
    expect(editor.getBlock(secondBlockId)?.metadata?.nested).toStrictEqual({
      width: 320,
    });
    expect(editor.getBlock(secondBlockId)?.metadata?.array).toStrictEqual([
      1, 2, 3,
    ]);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.getBlock(blockId)?.metadata).toBeUndefined();
    expect(editor.getBlock(secondBlockId)?.metadata).toStrictEqual({
      existing: "kept",
      nested: { width: 100, height: 80 },
    });
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(editor.getBlock(blockId)?.metadata).toStrictEqual({
      introduced: true,
      nullable: null,
    });
    expect(editor.getBlock(secondBlockId)?.metadata?.nested).toStrictEqual({
      width: 320,
    });
    editor.dispose();
  });

  it("does not transact for empty, unchanged, invalid JSON, duplicate, or invalid atomic updates", () => {
    const onCanonicalCommit = vi.fn();
    const editor = createTestEditor({ onCanonicalCommit });
    const beforeVersion = editor.getEditorInfo().blockGraphVersion;

    expect(editor.updateBlockMetadata([])).toBe(false);
    expect(
      editor.updateBlockMetadata([
        { blockId: secondBlockId, values: { existing: "kept" } },
      ]),
    ).toBe(false);
    expect(
      editor.updateBlockMetadata([
        {
          blockId,
          values: { invalid: (() => undefined) as never },
        },
      ]),
    ).toBe(false);
    expect(
      editor.updateBlockMetadata([
        { blockId, values: { value: "first" } },
        { blockId, values: { value: "second" } },
      ]),
    ).toBe(false);
    expect(
      editor.updateBlockMetadata([
        { blockId, values: { accepted: true } },
        { blockId: missingBlockId, values: { rejected: true } },
      ]),
    ).toBe(false);

    expect(editor.getEditorInfo().blockGraphVersion).toBe(beforeVersion);
    expect(editor.getBlock(blockId)?.metadata).toBeUndefined();
    expect(onCanonicalCommit).not.toHaveBeenCalled();
    expect(historyAccess(editor).history).toHaveLength(0);
    editor.dispose();
  });

  it("accepts a local atomic metadata update after replaying remote metadata", () => {
    const onCanonicalCommit = vi.fn();
    const editor = createTestEditor({ onCanonicalCommit });

    editor.replayLogicalBlockMetadataOperation({
      kind: "updateBlockMetadata",
      updates: [
        { blockId, values: { value: "remote-left" } },
        { blockId: secondBlockId, values: { value: "remote-right" } },
      ],
    });
    expect(onCanonicalCommit).not.toHaveBeenCalled();

    expect(
      editor.updateBlockMetadata([
        { blockId, values: { value: "local-left" } },
        { blockId: secondBlockId, values: { value: "local-right" } },
      ]),
    ).toBe(true);
    expect(onCanonicalCommit).toHaveBeenCalledTimes(1);
    expect(editor.getBlock(blockId)?.metadata?.value).toBe("local-left");
    expect(editor.getBlock(secondBlockId)?.metadata?.value).toBe("local-right");
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.getBlock(blockId)?.metadata?.value).toBe("remote-left");
    expect(editor.getBlock(secondBlockId)?.metadata?.value).toBe(
      "remote-right",
    );
    editor.dispose();
  });

  it("settles the recorded before and after selections only after successful replay", () => {
    const changes: CanonicalEditorCommit[] = [];
    const editor = createTestEditor({
      onCanonicalCommit: (commit) => changes.push(commit),
    });
    const before = logicalSelection(1);
    const after = logicalSelection(2);
    const effects: Array<number | undefined> = [];
    const uninstall = editor.selectionController.canonical.subscribe(() => {
      effects.push(readCanonicalFocusOffset(editor));
    });

    settleTestSelection(editor, before);
    effects.length = 0;
    expect(
      editor.updateBlockMetadata([{ blockId, values: { value: "next" } }], {
        selectionEffect: { kind: "selection", selection: after },
      }),
    ).toBe(true);
    expect(effects).toEqual([2]);
    expect(publishedFocusAnchor(changes[0]!)).toBe("Ag==");

    clearTestSelection(editor);
    effects.length = 0;
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(effects).toEqual([1]);
    expect(changes[1]).toMatchObject({ historyAction: "undo" });
    expect(changes[1]?.provenance).toBeNull();
    expect(publishedFocusAnchor(changes[1]!)).toBe("AQ==");
    clearTestSelection(editor);
    effects.length = 0;
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(effects).toEqual([2]);
    expect(changes[2]).toMatchObject({ historyAction: "redo" });
    expect(changes[2]?.provenance).toBeNull();
    expect(publishedFocusAnchor(changes[2]!)).toBe("Ag==");
    expect(editor.redo()).toEqual({ status: "history-empty" });
    expect(effects).toHaveLength(1);

    uninstall();
    editor.dispose();
  });

  it("settles logical selection before releasing document notifications", () => {
    const editor = createTestEditor();
    const before = logicalSelection(2);
    const observed: string[] = [];
    const uninstallSelection = editor.selectionController.canonical.subscribe(
      () => {
        observed.push(
          `selection:${String(metadataValue(editor))}:${String(
            readCanonicalFocusOffset(editor),
          )}`,
        );
      },
    );
    const unsubscribeManifest = editor.subscribeManifest(() => {
      observed.push(`document:${String(metadataValue(editor))}`);
    });

    settleTestSelection(editor, before);
    observed.length = 0;
    expect(
      editor.updateBlockMetadata([{ blockId, values: { value: "next" } }]),
    ).toBe(true);
    clearTestSelection(editor);
    observed.length = 0;

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(observed).toEqual(["selection:undefined:2", "document:undefined"]);

    unsubscribeManifest();
    uninstallSelection();
    editor.dispose();
  });

  it("preserves operation order across multiple undos and redos", () => {
    const editor = createTestEditor();
    expect(setMetadata(editor, "first")).toBe(true);
    expect(setMetadata(editor, "second")).toBe(true);
    expect(setMetadata(editor, "third")).toBe(true);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBe("second");
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBe("first");
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBeUndefined();

    expect(editor.redo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBe("first");
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBe("second");
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBe("third");
    editor.dispose();
  });

  it("abandons the complete redo tail only when a new entry is recorded", () => {
    const editor = createTestEditor();
    expect(setMetadata(editor, "first")).toBe(true);
    expect(setMetadata(editor, "second")).toBe(true);
    expect(setMetadata(editor, "third")).toBe(true);
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.canRedo).toBe(true);

    expect(setMetadata(editor, "branch")).toBe(true);
    expect(metadataValue(editor)).toBe("branch");
    expect(editor.canRedo).toBe(false);
    expect(editor.redo()).toEqual({ status: "history-empty" });
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBe("first");
    editor.dispose();
  });

  it("preserves the redo tail when a new edit fails", () => {
    const editor = createTestEditor();
    expect(setMetadata(editor, "first")).toBe(true);
    expect(setMetadata(editor, "second")).toBe(true);
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.canRedo).toBe(true);

    expect(applyInvalidMetadataUpdate(editor)).toBe(false);
    expect(editor.canRedo).toBe(true);
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBe("second");
    editor.dispose();
  });

  it("clears undo history when recovery replaces the target block", () => {
    const editor = createTestEditor();
    expect(setMetadata(editor, "first")).toBe(true);
    removeTestBlock(editor);
    const before = editor.getCommandState();
    const listener = vi.fn();
    const selectionEffect = vi.fn();
    editor.commandAvailability.subscribe(listener);
    editor.selectionController.canonical.subscribe(selectionEffect);

    expect(editor.undo()).toEqual({ status: "history-empty" });
    expect(editor.getCommandState()).toEqual(before);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(selectionEffect).not.toHaveBeenCalled();
    editor.dispose();
  });

  it("clears redo history when recovery replaces the target block", () => {
    const editor = createTestEditor();
    expect(setMetadata(editor, "first")).toBe(true);
    expect(editor.undo()).toEqual({ status: "applied" });
    removeTestBlock(editor);
    const before = editor.getCommandState();
    const listener = vi.fn();
    const selectionEffect = vi.fn();
    editor.commandAvailability.subscribe(listener);
    editor.selectionController.canonical.subscribe(selectionEffect);

    expect(editor.redo()).toEqual({ status: "history-empty" });
    expect(editor.getCommandState()).toEqual(before);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(selectionEffect).not.toHaveBeenCalled();
    editor.dispose();
  });

  it("never records undo or redo replay as a new entry", () => {
    const editor = createTestEditor();
    expect(setMetadata(editor, "first")).toBe(true);

    for (let index = 0; index < 3; index += 1) {
      expect(editor.undo()).toEqual({ status: "applied" });
      expect(editor.undo()).toEqual({ status: "history-empty" });
      expect(editor.redo()).toEqual({ status: "applied" });
      expect(editor.redo()).toEqual({ status: "history-empty" });
    }
    expect(historyAccess(editor).history).toHaveLength(1);
    expect(historyAccess(editor).historyIndex).toBe(1);
    editor.dispose();
  });

  it("trims only the oldest entries and retains a correct cursor", () => {
    const editor = createTestEditor({ maximumHistoryEntries: 2 });
    expect(setMetadata(editor, "first")).toBe(true);
    expect(setMetadata(editor, "second")).toBe(true);
    expect(setMetadata(editor, "third")).toBe(true);
    expect(historyAccess(editor).history).toHaveLength(2);
    expect(historyAccess(editor).historyIndex).toBe(2);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBe("second");
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBe("first");
    expect(editor.undo()).toEqual({ status: "history-empty" });
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBe("second");
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(metadataValue(editor)).toBe("third");
    editor.dispose();
  });

  it("preserves the linear state machine invariants through replay, branching, and retention", () => {
    const editor = createTestEditor({ maximumHistoryEntries: 3 });
    const steps = [
      {
        apply: () => setMetadata(editor, "one"),
        expected: { length: 1, index: 1, canUndo: true, canRedo: false },
      },
      {
        apply: () => setMetadata(editor, "two"),
        expected: { length: 2, index: 2, canUndo: true, canRedo: false },
      },
      {
        apply: () => setMetadata(editor, "three"),
        expected: { length: 3, index: 3, canUndo: true, canRedo: false },
      },
      {
        apply: () => editor.undo(),
        expected: { length: 3, index: 2, canUndo: true, canRedo: true },
      },
      {
        apply: () => editor.undo(),
        expected: { length: 3, index: 1, canUndo: true, canRedo: true },
      },
      {
        apply: () => setMetadata(editor, "branch"),
        expected: { length: 2, index: 2, canUndo: true, canRedo: false },
      },
      {
        apply: () => setMetadata(editor, "four"),
        expected: { length: 3, index: 3, canUndo: true, canRedo: false },
      },
      {
        apply: () => setMetadata(editor, "five"),
        expected: { length: 3, index: 3, canUndo: true, canRedo: false },
      },
      {
        apply: () => editor.redo(),
        expected: { length: 3, index: 3, canUndo: true, canRedo: false },
      },
    ] as const;

    for (const step of steps) {
      step.apply();
      expectLinearHistoryState(editor, { ...step.expected, maximum: 3 });
    }
    editor.dispose();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid maximum history entry value %s",
    (maximumHistoryEntries) => {
      expect(() => createTestEditor({ maximumHistoryEntries })).toThrow(
        "maximumHistoryEntries must be a positive safe integer",
      );
    },
  );

  it("keeps histories isolated between editor instances", () => {
    const first = createTestEditor();
    const second = createTestEditor();
    expect(setMetadata(first, "first-only")).toBe(true);

    expect(first.canUndo).toBe(true);
    expect(second.canUndo).toBe(false);
    expect(second.undo()).toEqual({ status: "history-empty" });
    expect(metadataValue(second)).toBeUndefined();
    expect(first.undo()).toEqual({ status: "applied" });
    expect(metadataValue(first)).toBeUndefined();
    first.dispose();
    second.dispose();
  });

  it("clears operation-anchor history at an external snapshot reconciliation boundary", () => {
    const editor = createTestEditor();
    expect(setMetadata(editor, "local")).toBe(true);
    const before = {
      history: [...historyAccess(editor).history],
      index: historyAccess(editor).historyIndex,
      availability: editor.commandAvailability.getSnapshot(),
    };
    const listener = vi.fn();
    editor.commandAvailability.subscribe(listener);
    const replacement = createVersionedBlockRecord({
      id: blockId,
      type: "textBlock",
      parentId: null,
      metadata: { remote: true },
      version: {
        metadataVersion: "2",
        contentVersion: asContentVersion("1"),
      },
    });

    editor.reconcileEditorSnapshotForRecovery({
      origin: "remote-replay",
      blockGraphVersion: editor.getEditorInfo().blockGraphVersion + 1,
      blocks: { [blockId]: replacement },
      rootBlockIds: [blockId],
      childIdsByParentId: {},
    });

    expect(before.history).toHaveLength(1);
    expect(historyAccess(editor).history).toEqual([]);
    expect(historyAccess(editor).historyIndex).toBe(0);
    expect(editor.commandAvailability.getSnapshot()).toEqual({
      canUndo: false,
      canRedo: false,
    });
    expect(listener).toHaveBeenCalledOnce();
    editor.dispose();
  });

  it("publishes availability changes after record, undo, and redo only", () => {
    const editor = createTestEditor();
    const listener = vi.fn();
    const unsubscribe = editor.commandAvailability.subscribe(listener);

    expect(editor.commandAvailability.getSnapshot()).toEqual({
      canUndo: false,
      canRedo: false,
    });
    expect(setMetadata(editor, "first")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(editor.commandAvailability.getSnapshot()).toEqual({
      canUndo: true,
      canRedo: false,
    });
    expect(applyInvalidMetadataUpdate(editor)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(editor.commandAvailability.getSnapshot()).toEqual({
      canUndo: false,
      canRedo: true,
    });
    expect(editor.undo()).toEqual({ status: "history-empty" });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(listener).toHaveBeenCalledTimes(3);
    expect(editor.redo()).toEqual({ status: "history-empty" });
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    editor.dispose();
  });

  it("owns immutable selection metadata without restoring browser state", () => {
    const editor = createTestEditor();
    const before = logicalSelection(1);
    settleTestSelection(editor, before);
    expect(
      editor.updateBlockMetadata([{ blockId, values: { stored: "saved" } }]),
    ).toBe(true);
    before.anchor.textOffset = 99;
    const stored = historyAccess(editor).history[0]!;

    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.semanticForward)).toBe(true);
    expect(stored.state).toBe("applied");
    if (stored.state !== "applied") throw new Error("Expected applied history");
    expect(Object.isFrozen(stored.nextUndo)).toBe(true);
    expect(stored.nextUndo.steps).toMatchObject([
      {
        kind: "anchor-free",
        operation: { kind: "updateBlockMetadata" },
      },
    ]);
    expect(
      historyDocumentSelection(stored.selectionBefore)?.anchor.textOffset,
    ).toBe(1);
    expect(
      historyDocumentSelection(stored.selectionAfter)?.focus.textOffset,
    ).toBe(1);
    expect(
      (stored.semanticForward as UpdateBlockMetadataOperation).updates[0]
        ?.values.stored,
    ).toBe("saved");
    expect(Object.keys(stored).sort()).toEqual([
      "nextUndo",
      "selectionAfter",
      "selectionBefore",
      "semanticForward",
      "semanticInverse",
      "state",
    ]);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(metadataValue(editor, "stored")).toBe("saved");
    expect(
      historyDocumentSelection(historyAccess(editor).history[0]!.selectionAfter)
        ?.focus.textOffset,
    ).toBe(1);
    editor.dispose();
  });

  it("re-anchors a historical text point after its original runtime anchor becomes unresolved", () => {
    const changes: CanonicalEditorCommit[] = [];
    const editor = createTestEditor({
      resolveSelectionTextAnchor: (point) =>
        point.textAnchor?.payload.encoded === "Ag=="
          ? {
              ok: true,
              blockId: point.blockId,
              textAnchor: point.textAnchor,
              textOffset: point.textOffset,
              affinity: point.affinity,
            }
          : { ok: false, reason: "missing-text", blockId: point.blockId },
      createSelectionTextAnchor: (point) => {
        const anchor = createEditorSelectionTextAnchor({
          codec: "test-runtime-anchor",
          payload: { encoded: "Ag==", assoc: 1 },
        });
        return anchor.ok
          ? {
              ok: true,
              textAnchor: anchor.textAnchor,
              textOffset: point.textOffset,
            }
          : { ok: false };
      },
      onCanonicalCommit: (commit) => changes.push(commit),
    });
    settleTestSelection(editor, logicalSelection(1));
    expect(
      editor.updateBlockMetadata([{ blockId, values: { stored: "saved" } }], {
        editorSuggestion: null,
      }),
    ).toBe(true);
    clearTestSelection(editor);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(readCanonicalFocusOffset(editor)).toBe(1);
    expect(publishedFocusAnchor(changes.at(-1)!)).toBe("Ag==");
    editor.dispose();
  });

  it("rejects reentrant history commands while replay is applying", () => {
    const observed: Array<{
      readonly action: "undo" | "redo";
      readonly nestedResult: ReturnType<EditorImplementation["undo"]>;
      readonly historyIndex: number;
      readonly state: EditorHistoryEntry["state"];
      readonly canUndo: boolean;
      readonly canRedo: boolean;
    }> = [];
    const editor = createTestEditor({
      onCanonicalCommit: (commit, currentEditor) => {
        if (commit.historyAction !== "undo" && commit.historyAction !== "redo")
          return;
        const access = historyAccess(currentEditor);
        observed.push({
          action: commit.historyAction,
          nestedResult:
            commit.historyAction === "undo"
              ? currentEditor.undo()
              : currentEditor.redo(),
          historyIndex: access.historyIndex,
          state: access.history[0]!.state,
          canUndo: currentEditor.canUndo,
          canRedo: currentEditor.canRedo,
        });
      },
    });
    expect(setMetadata(editor, "first")).toBe(true);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(observed).toEqual([
      {
        action: "undo",
        nestedResult: {
          status: "execution-unavailable",
          reason: "history-replay-in-progress",
        },
        historyIndex: 0,
        state: "undone",
        canUndo: false,
        canRedo: true,
      },
      {
        action: "redo",
        nestedResult: {
          status: "execution-unavailable",
          reason: "history-replay-in-progress",
        },
        historyIndex: 1,
        state: "applied",
        canUndo: true,
        canRedo: false,
      },
    ]);
    expect(metadataValue(editor)).toBe("first");
    expect(editor.canUndo).toBe(true);
    expect(editor.canRedo).toBe(false);
    editor.dispose();
  });

  it("keeps replay healthy when saved selection restoration fails", () => {
    const editor = createTestEditor({
      resolveSelectionTextAnchor: (point) => ({
        ok: false,
        reason: "missing-text",
        blockId: point.blockId,
      }),
      createSelectionTextAnchor: () => ({ ok: false }),
    });
    settleTestSelection(editor, logicalSelection(1));
    expect(setMetadata(editor, "first")).toBe(true);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    expect(historyAccess(editor).history[0]?.state).toBe("undone");
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(editor.canUndo).toBe(true);
    expect(editor.canRedo).toBe(false);
    expect(historyAccess(editor).history[0]?.state).toBe("applied");
    expect(metadataValue(editor)).toBe("first");
    editor.dispose();
  });

  it.each([
    "acquire-unavailable",
    "acquire-throw",
    "resolve-failure",
    "resolve-throw",
    "create-failure",
    "create-throw",
    "release-throw",
  ] as const)(
    "treats %s as best-effort during graph history selection restoration",
    (failureMode) => {
      let replaying = false;
      let releaseCalls = 0;
      const publications: CanonicalEditorCommit[] = [];
      const createAnchor: NonNullable<
        InitializeEditorImplementationOptions["createSelectionTextAnchor"]
      > = (point) => {
        if (replaying && failureMode === "create-throw") {
          throw new Error("test selection anchor creation failed");
        }
        if (
          replaying &&
          (failureMode === "create-failure" ||
            failureMode === "resolve-failure")
        ) {
          return { ok: false };
        }
        const created = createEditorSelectionTextAnchor({
          codec: "test-runtime-anchor",
          payload: { encoded: "AQ==", assoc: 1 },
        });
        return created.ok
          ? {
              ok: true,
              textAnchor: created.textAnchor,
              textOffset: point.textOffset,
            }
          : { ok: false };
      };
      const editor = createTestEditor({
        acquireTextContentAccess: () => {
          if (replaying && failureMode === "acquire-throw") {
            throw new Error("test selection content acquisition failed");
          }
          if (replaying && failureMode === "acquire-unavailable") return null;
          return () => {
            releaseCalls += 1;
            if (replaying && failureMode === "release-throw") {
              throw new Error("test selection content release failed");
            }
          };
        },
        resolveSelectionTextAnchor: (point) => {
          if (replaying && failureMode === "resolve-throw") {
            throw new Error("test selection anchor resolution failed");
          }
          if (
            replaying &&
            (failureMode === "resolve-failure" ||
              failureMode === "create-failure" ||
              failureMode === "create-throw")
          ) {
            return {
              ok: false,
              reason: "missing-text",
              blockId: point.blockId,
            };
          }
          return {
            ok: true,
            blockId: point.blockId,
            textAnchor: point.textAnchor!,
            textOffset: point.textOffset,
            affinity: point.affinity,
          };
        },
        createSelectionTextAnchor: createAnchor,
        onCanonicalCommit: (commit, currentEditor) => {
          publications.push(commit);
          if (commit.historyAction === "command") return;
          const access = historyAccess(currentEditor);
          expect(access.historyIndex).toBe(
            commit.historyAction === "undo" ? 0 : 1,
          );
          expect(access.history[0]?.state).toBe(
            commit.historyAction === "undo" ? "undone" : "applied",
          );
          expect(currentEditor.canUndo).toBe(commit.historyAction === "redo");
          expect(currentEditor.canRedo).toBe(commit.historyAction === "undo");
          expect(commit.selectionAfter).toEqual({ kind: "none" });
        },
      });
      settleTestSelection(editor, logicalSelection(1));
      expect(setMetadata(editor, "first")).toBe(true);
      clearTestSelection(editor);
      replaying = true;

      expect(editor.undo()).toEqual({ status: "applied" });
      expect(metadataValue(editor)).toBeUndefined();
      expect(readCanonicalFocusOffset(editor)).toBeUndefined();
      expect(editor.canUndo).toBe(false);
      expect(editor.canRedo).toBe(true);
      expect(historyAccess(editor).history[0]?.state).toBe("undone");

      expect(editor.redo()).toEqual({ status: "applied" });
      expect(metadataValue(editor)).toBe("first");
      expect(readCanonicalFocusOffset(editor)).toBeUndefined();
      expect(editor.canUndo).toBe(true);
      expect(editor.canRedo).toBe(false);
      expect(historyAccess(editor).history[0]?.state).toBe("applied");
      expect(publications.map((commit) => commit.historyAction)).toEqual([
        "command",
        "undo",
        "redo",
      ]);
      expect(releaseCalls).toBe(
        failureMode === "acquire-unavailable" || failureMode === "acquire-throw"
          ? 0
          : 2,
      );
      editor.dispose();
    },
  );
});

function publishedFocusAnchor(change: CanonicalEditorCommit): string | null {
  if (
    change.selectionAfter.kind !== "selection" ||
    change.selectionAfter.selection.kind !== "document" ||
    change.selectionAfter.selection.focus.kind !== "text"
  ) {
    return null;
  }
  return change.selectionAfter.selection.focus.textAnchor.payload.encoded;
}

function historyDocumentSelection(
  selection: EditorHistorySelection,
): EditorSelection | null {
  return selection.kind === "document" ? selection.selection : null;
}
