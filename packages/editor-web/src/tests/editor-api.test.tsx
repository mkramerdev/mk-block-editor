import { StrictMode, useLayoutEffect } from "react";
import { act, render, renderHook } from "@testing-library/react";
import type { BlockId } from "@repo/editor-core/kernel";
import { moveBlocks } from "@repo/editor-core/editing";
import type {
  EditorHistoryResult,
  EditorImplementation,
} from "@repo/editor-react/editor";
import {
  EDITOR_REDO_COMMAND_ID,
  EDITOR_UNDO_COMMAND_ID,
} from "@repo/editor-react/editor";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createEditorContentRuntime } from "../runtime/content/content-runtime.ts";
import type { EditableEditorDefinition } from "../runtime/definition/contracts.ts";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import type { EditableEditor } from "../runtime/document/contracts.ts";
import type { EditableEditorRuntimePort } from "../runtime/document/render-port.ts";
import {
  createEditorDocumentCommandExecutionContext,
  executeRegisteredEditorDocumentCommand,
  isRegisteredEditorDocumentCommandEnabled,
} from "../runtime/commands/command-routing.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";
import {
  initializeTestEditableEditor,
  useTestEditor as useEditor,
} from "./test-editor-initializers.ts";
import { createTestContentOperationUpdate } from "./editor-web-test-helpers.ts";
import { resolveEditorRuntimePort } from "../runtime/document/runtime-port-registry.ts";

const renderProbe = vi.hoisted(() => ({
  editor: null as unknown,
  selectionController: null as unknown,
}));

const remoteSubject = {
  actorId: "remote-actor",
  clientId: "remote-client",
  sessionId: "remote-session",
};

vi.mock("../document/editor/block-list", () => ({
  BlockList: ({ editor }: { readonly editor: EditableEditorRuntimePort }) => {
    useLayoutEffect(() => editor.acquireEditableDocument(), [editor]);
    renderProbe.editor = editor;
    renderProbe.selectionController = editor.selectionController;
    return <div data-testid="render-probe" />;
  },
}));

describe("initializeTestEditableEditor", () => {
  it("does not expose the internal runtime port on the public editor", () => {
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: "editor-api-no-runtime" as BlockId, type: "textBlock", text: "" },
      ]),
    });
    expect("runtime" in editor).toBe(false);
    editor.dispose();
  });

  it("exposes narrow semantic content commands", () => {
    expectTypeOf<
      EditableEditor["insertText"]
    >().returns.toEqualTypeOf<boolean>();
    expectTypeOf<
      EditableEditor["deleteText"]
    >().returns.toEqualTypeOf<boolean>();
    expectTypeOf<
      EditableEditor["updateMark"]
    >().returns.toEqualTypeOf<boolean>();
    expectTypeOf<
      EditableEditor["updateInlineAtom"]
    >().returns.toEqualTypeOf<boolean>();
    expectTypeOf<EditableEditor>().toHaveProperty(
      "readCurrentSelectionInlineMarkFormatStates",
    );
    expectTypeOf<EditableEditor>().toHaveProperty("formatSelectionInlineMark");
    expectTypeOf<EditableEditor["undo"]>().toEqualTypeOf<
      () => EditorHistoryResult
    >();
    expectTypeOf<EditableEditor["redo"]>().toEqualTypeOf<
      () => EditorHistoryResult
    >();
    expectTypeOf<
      EditableEditor["commandAvailability"]["subscribe"]
    >().toEqualTypeOf<(listener: () => void) => () => void>();
    expectTypeOf<EditableEditor>().toHaveProperty("selection");
    expectTypeOf<EditableEditor>().not.toHaveProperty("history");
    expectTypeOf<EditableEditor>().not.toHaveProperty("readInlineMarkState");
  });

  it("returns a complete, immediately usable editor synchronously", () => {
    const blockId = "editor-api-direct" as BlockId;
    const changes = vi.fn();
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "direct" },
      ]),
      onChange: changes,
    });
    const implementation = editor as EditorImplementation;
    const availabilityChanged = vi.fn();
    const unsubscribeAvailability =
      editor.commandAvailability.subscribe(availabilityChanged);

    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
    expect(editor.undo()).toEqual({ status: "history-empty" });
    expect(editor.redo()).toEqual({ status: "history-empty" });
    expect(editor.getBlock(blockId)?.type).toBe("textBlock");
    expect(editor.readBlockContent(blockId, "textBlock")).not.toBeNull();
    expect(
      implementation.updateBlockMetadata([
        { blockId, values: { "direct-field": true } },
      ]),
    ).toBe(true);
    expect(editor.canUndo).toBe(true);
    expect(editor.canRedo).toBe(false);
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(
      editor.getBlock(blockId)?.metadata?.["direct-field"],
    ).toBeUndefined();
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(editor.getBlock(blockId)?.metadata?.["direct-field"]).toBe(true);
    expect(changes).toHaveBeenCalledTimes(3);
    expect(availabilityChanged).toHaveBeenCalledTimes(3);

    unsubscribeAvailability();
    editor.dispose();
  });

  it("executes hook-owned history commands through core editor history", () => {
    const blockId = "editor-api-registered-history" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "registered" },
      ]),
    });
    const renderEditor = resolveEditorRuntimePort(editor);
    const runtime = {
      definition: testEditableEditorDefinition,
      store: renderEditor.store,
      editor: renderEditor,
    };
    const undo = renderEditor.commands.get(EDITOR_UNDO_COMMAND_ID);
    const redo = renderEditor.commands.get(EDITOR_REDO_COMMAND_ID);
    if (!undo || undo.scope !== "document")
      throw new Error("Missing registered undo command.");
    if (!redo || redo.scope !== "document")
      throw new Error("Missing registered redo command.");
    const undoContext = createEditorDocumentCommandExecutionContext(
      runtime,
      undo,
    );
    const redoContext = createEditorDocumentCommandExecutionContext(
      runtime,
      redo,
    );

    expect(editor.canUndo).toBe(false);
    expect(isRegisteredEditorDocumentCommandEnabled(undo, undoContext)).toBe(
      editor.canUndo,
    );
    expect(isRegisteredEditorDocumentCommandEnabled(redo, redoContext)).toBe(
      editor.canRedo,
    );

    expect(
      (editor as EditorImplementation).updateBlockMetadata([
        { blockId, values: { "registered-history": true } },
      ]),
    ).toBe(true);
    expect(editor.canUndo).toBe(true);
    expect(isRegisteredEditorDocumentCommandEnabled(undo, undoContext)).toBe(
      editor.canUndo,
    );
    expect(executeRegisteredEditorDocumentCommand(undo, undoContext)).toEqual({
      ok: true,
      handled: true,
      commandId: EDITOR_UNDO_COMMAND_ID,
    });
    expect(
      editor.getBlock(blockId)?.metadata?.["registered-history"],
    ).toBeUndefined();
    expect(editor.canRedo).toBe(true);
    expect(isRegisteredEditorDocumentCommandEnabled(redo, redoContext)).toBe(
      editor.canRedo,
    );
    expect(executeRegisteredEditorDocumentCommand(redo, redoContext)).toEqual({
      ok: true,
      handled: true,
      commandId: EDITOR_REDO_COMMAND_ID,
    });
    expect(editor.getBlock(blockId)?.metadata?.["registered-history"]).toBe(
      true,
    );
    editor.dispose();
  });

  it("does not record external rich-text ingress", () => {
    const blockId = "editor-api-external-content-history" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "start" },
      ]),
    });
    const runtime = resolveEditorRuntimePort(editor);
    runtime.contentRuntime.applyExternalContentUpdate({
      blockGraphVersion: runtime.getSelectionGraphRevision(),
      blockId,
      blockType: "textBlock",
      update: createTestContentOperationUpdate(runtime.contentRuntime),
      readProjection: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "start remote" }],
          },
        ],
      },
      origin: "external-change",
      revision: 1,
    });

    expect(editor.canUndo).toBe(false);
    expect(editor.undo()).toEqual({ status: "history-empty" });
    editor.dispose();
  });

  it("commits text insertion and deletion once with undo and redo", () => {
    const blockId = "editor-api-text-mutations" as BlockId;
    const changes = vi.fn();
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "abcd" },
      ]),
      onChange: changes,
    });
    expect(editor.insertText({ blockId, offset: 2, text: "XY" })).toBe(true);
    expect(editor.readBlockContent(blockId, "textBlock")).toMatchObject({
      content: [{ content: [{ text: "abXYcd" }] }],
    });
    expect(changes).toHaveBeenCalledTimes(1);
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(editor.deleteText({ blockId, range: { from: 1, to: 4 } })).toBe(
      true,
    );
    expect(editor.readBlockContent(blockId, "textBlock")).toMatchObject({
      content: [{ content: [{ text: "acd" }] }],
    });
    expect(changes).toHaveBeenCalledTimes(4);
    editor.dispose();
  });

  it("publishes replay content with the refreshed history transition installed", () => {
    const blockId = "editor-api-history-publication-order" as BlockId;
    const observed: Array<Record<string, unknown>> = [];
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "abc" },
      ]),
      onChange: (change) => {
        if (change.historyAction !== "undo" && change.historyAction !== "redo")
          return;
        const access = editor as unknown as {
          readonly history: readonly { readonly state: string }[];
          readonly historyIndex: number;
        };
        observed.push({
          action: change.historyAction,
          text: editor.readBlockPlainText(blockId, "textBlock"),
          historyIndex: access.historyIndex,
          state: access.history[0]?.state,
          canUndo: editor.canUndo,
          canRedo: editor.canRedo,
          nested:
            change.historyAction === "undo" ? editor.undo() : editor.redo(),
        });
      },
    });
    expect(editor.insertText({ blockId, offset: 1, text: "X" })).toBe(true);
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.redo()).toEqual({ status: "applied" });

    expect(observed).toEqual([
      {
        action: "undo",
        text: "abc",
        historyIndex: 0,
        state: "undone",
        canUndo: false,
        canRedo: true,
        nested: {
          status: "execution-unavailable",
          reason: "history-replay-in-progress",
        },
      },
      {
        action: "redo",
        text: "aXbc",
        historyIndex: 1,
        state: "applied",
        canUndo: true,
        canRedo: false,
        nested: {
          status: "execution-unavailable",
          reason: "history-replay-in-progress",
        },
      },
    ]);
    editor.dispose();
  });

  it("uses one released history content lease for all boundaries in a block", () => {
    const blockId = "editor-api-history-anchor-batch" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "abcd" },
      ]),
    });
    const runtime = resolveEditorRuntimePort(editor).contentRuntime;
    const acquire = runtime.acquireBlockContent.bind(runtime);
    const events: string[] = [];
    const acquireSpy = vi
      .spyOn(runtime, "acquireBlockContent")
      .mockImplementation((requestedBlockId, blockType, reason) => {
        const lease = acquire(requestedBlockId, blockType, reason);
        if (reason !== "history") return lease;
        events.push(`acquire:${requestedBlockId}`);
        const release = lease.release.bind(lease);
        lease.release = () => {
          events.push(`release:${requestedBlockId}`);
          release();
        };
        return lease;
      });

    expect(editor.insertText({ blockId, offset: 2, text: "XY" })).toBe(true);
    events.length = 0;
    acquireSpy.mockClear();
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(
      acquireSpy.mock.calls.filter((call) => call[2] === "history"),
    ).toHaveLength(1);
    expect(events).toEqual([`acquire:${blockId}`, `release:${blockId}`]);

    events.length = 0;
    acquireSpy.mockClear();
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(
      acquireSpy.mock.calls.filter((call) => call[2] === "history"),
    ).toHaveLength(1);
    expect(events).toEqual([`acquire:${blockId}`, `release:${blockId}`]);

    expect(editor.insertText({ blockId, offset: 0, text: "Z" })).toBe(true);
    const beforeFailedUndo = editor.readBlockPlainText(blockId, "textBlock");
    vi.spyOn(runtime, "resolveOperationAnchorInContext").mockReturnValueOnce({
      ok: false,
      reason: "invalid",
    });
    events.length = 0;
    acquireSpy.mockClear();
    expect(editor.undo()).toMatchObject({
      status: "operation-application-failed",
    });
    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe(
      beforeFailedUndo,
    );
    expect(events).toEqual([`acquire:${blockId}`, `release:${blockId}`]);
    editor.dispose();
  });

  it("routes public semantic mutations through the configured content runtime", () => {
    const blockId = "editor-api-configured-content-runtime" as BlockId;
    const phases: string[] = [];
    const definition: EditableEditorDefinition = {
      ...testEditableEditorDefinition,
      content: {
        createRuntime(source) {
          const runtime = createEditorContentRuntime(source);
          return {
            ...runtime,
            validateContentCommit(input) {
              phases.push("validate");
              return runtime.validateContentCommit(input);
            },
            commitContent(validated, replayCapture) {
              phases.push("commit");
              return runtime.commitContent(validated, replayCapture);
            },
            publishContentCommit(applied) {
              phases.push("publish");
              runtime.publishContentCommit(applied);
            },
          };
        },
      },
    };
    const editor = initializeTestEditableEditor({
      definition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "A" },
      ]),
    });

    expect(editor.insertText({ blockId, offset: 1, text: "B" })).toBe(true);
    expect(phases).toEqual(["validate", "commit", "publish"]);
    expect(editor.readBlockContent(blockId, "textBlock")).toMatchObject({
      content: [{ content: [{ type: "text", text: "AB" }] }],
    });
    editor.dispose();
  });

  it("isolates configured runtime rejection without history or publication", () => {
    const blockId = "editor-api-rejected-content-runtime" as BlockId;
    const definition: EditableEditorDefinition = {
      ...testEditableEditorDefinition,
      content: {
        createRuntime(source) {
          const runtime = createEditorContentRuntime(source);
          return {
            ...runtime,
            validateContentCommit() {
              throw new Error("configured rejection");
            },
          };
        },
      },
    };
    const changes = vi.fn();
    const editor = initializeTestEditableEditor({
      definition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "A" },
      ]),
      onChange: changes,
    });

    expect(editor.insertText({ blockId, offset: 1, text: "B" })).toBe(false);
    expect(editor.canUndo).toBe(false);
    expect(changes).not.toHaveBeenCalled();
    expect(editor.readBlockContent(blockId, "textBlock")).toMatchObject({
      content: [{ content: [{ type: "text", text: "A" }] }],
    });
    editor.dispose();
  });

  it("rejects invalid and empty text mutations without publication", () => {
    const blockId = "editor-api-text-rejections" as BlockId;
    const changes = vi.fn();
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "text" },
      ]),
      onChange: changes,
    });
    expect(editor.insertText({ blockId, offset: 0, text: "" })).toBe(false);
    expect(editor.insertText({ blockId, offset: 9, text: "x" })).toBe(false);
    expect(editor.deleteText({ blockId, range: { from: 2, to: 2 } })).toBe(
      false,
    );
    expect(editor.deleteText({ blockId, range: { from: -1, to: 2 } })).toBe(
      false,
    );
    expect(
      editor.insertText({
        blockId: "missing-text-block" as BlockId,
        offset: 0,
        text: "x",
      }),
    ).toBe(false);
    expect(changes).not.toHaveBeenCalled();
    expect(editor.canUndo).toBe(false);
    editor.dispose();
  });

  it("establishes and removes deterministic mark state as one history entry", () => {
    const blockId = "editor-api-mark-update" as BlockId;
    const changes = vi.fn();
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "format" },
      ]),
      onChange: changes,
    });
    const update = {
      blockId,
      range: { from: 0, to: 6 },
      mark: { type: "strong" as const },
      enabled: true,
    };
    expect(editor.updateMark(update)).toBe(true);
    expect(editor.updateMark(update)).toBe(false);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(editor.updateMark({ ...update, enabled: false })).toBe(true);
    expect(editor.updateMark({ ...update, enabled: false })).toBe(false);
    expect(changes).toHaveBeenCalledTimes(4);
    editor.dispose();
  });

  it("reads all selection mark states once and formats multiple blocks atomically", () => {
    const firstId = "editor-api-selection-format-first" as BlockId;
    const secondId = "editor-api-selection-format-second" as BlockId;
    const unrelatedBlocks = Array.from({ length: 100 }, (_, index) => ({
      id: `editor-api-selection-format-unrelated-${index}` as BlockId,
      type: "textBlock",
      text: `unrelated ${index}`,
    }));
    const changes = vi.fn();
    const projectionReads = new Map<BlockId, number>();
    const historyLeaseEvents: string[] = [];
    const operationAnchorLeases: Array<{
      readonly blockId: BlockId;
      readonly lease: object;
    }> = [];
    let liveHistoryLeases = 0;
    let maximumLiveHistoryLeases = 0;
    const definition: EditableEditorDefinition = {
      ...testEditableEditorDefinition,
      content: {
        createRuntime(source) {
          const runtime = createEditorContentRuntime(source);
          return {
            ...runtime,
            acquireBlockContent(blockId, blockType, reason) {
              const lease = runtime.acquireBlockContent(
                blockId,
                blockType,
                reason,
              );
              if (reason !== "history") return lease;
              historyLeaseEvents.push(`acquire:${blockId}`);
              liveHistoryLeases += 1;
              maximumLiveHistoryLeases = Math.max(
                maximumLiveHistoryLeases,
                liveHistoryLeases,
              );
              const release = lease.release.bind(lease);
              lease.release = () => {
                historyLeaseEvents.push(`release:${blockId}`);
                liveHistoryLeases -= 1;
                release();
              };
              return lease;
            },
            resolveOperationAnchorInContext(lease, anchor) {
              operationAnchorLeases.push({ blockId: lease.blockId, lease });
              return runtime.resolveOperationAnchorInContext(lease, anchor);
            },
            readBlockProjection(blockId, blockType) {
              projectionReads.set(
                blockId,
                (projectionReads.get(blockId) ?? 0) + 1,
              );
              return runtime.readBlockProjection(blockId, blockType);
            },
          };
        },
      },
    };
    const editor = initializeTestEditableEditor({
      definition,
      snapshot: createTestEditorSnapshot([
        { id: firstId, type: "textBlock", text: "first" },
        { id: secondId, type: "alternateTextBlock", text: "second" },
        ...unrelatedBlocks,
      ]),
      onChange: changes,
    });
    commitTestTextSelection(
      editor as EditorImplementation,
      firstId,
      1,
      secondId,
      4,
    );
    const captured = editor.selection.getSnapshot();
    expect(captured.kind).toBe("document");
    if (captured.kind !== "document")
      throw new Error("selection was not committed");
    projectionReads.clear();

    const read = editor.readCurrentSelectionInlineMarkFormatStates({
      marks: ["strong", "em", "underline", "strikethrough", "code", "link"],
    });
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.reason);
    expect(read.blockIds).toEqual([firstId, secondId]);
    expect(projectionReads).toEqual(
      new Map<BlockId, number>([
        [firstId, 1],
        [secondId, 1],
      ]),
    );
    expect(read.states.strong).toMatchObject({
      active: false,
      mixed: false,
      canExecute: true,
    });

    const result = editor.formatSelectionInlineMark({
      selection: captured.snapshot,
      markName: "strong",
      action: "add",
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(changes).toHaveBeenCalledTimes(1);
    expect(editor.readBlockContent(firstId, "textBlock")).toMatchObject({
      content: [
        {
          content: [
            { text: "f" },
            { text: "irst", marks: [{ type: "strong" }] },
          ],
        },
      ],
    });
    expect(editor.readBlockContent(secondId, "alternateTextBlock")).toMatchObject({
      content: [
        {
          content: [
            { text: "seco", marks: [{ type: "strong" }] },
            { text: "nd" },
          ],
        },
      ],
    });
    for (const [index, block] of unrelatedBlocks.entries()) {
      expect(editor.readBlockContent(block.id, "textBlock")).toMatchObject({
        content: [{ content: [{ text: `unrelated ${index}` }] }],
      });
    }
    historyLeaseEvents.length = 0;
    operationAnchorLeases.length = 0;
    maximumLiveHistoryLeases = 0;
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(historyLeaseEvents).toEqual([
      `acquire:${secondId}`,
      `release:${secondId}`,
      `acquire:${firstId}`,
      `release:${firstId}`,
    ]);
    expect(maximumLiveHistoryLeases).toBe(1);
    expect(operationAnchorLeases).toHaveLength(4);
    expect(operationAnchorLeases[0]?.lease).toBe(
      operationAnchorLeases[1]?.lease,
    );
    expect(operationAnchorLeases[2]?.lease).toBe(
      operationAnchorLeases[3]?.lease,
    );
    expect(operationAnchorLeases[0]?.lease).not.toBe(
      operationAnchorLeases[2]?.lease,
    );
    expect(editor.readBlockContent(firstId, "textBlock")).toMatchObject({
      content: [{ content: [{ text: "first" }] }],
    });
    expect(editor.readBlockContent(secondId, "alternateTextBlock")).toMatchObject({
      content: [{ content: [{ text: "second" }] }],
    });
    expect(editor.redo()).toEqual({ status: "applied" });
    editor.dispose();
  });

  it("rebases an explicitly captured committed selection before formatting", () => {
    const blockId = "editor-api-selection-format-rebase" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "abcde" },
      ]),
    });
    commitTestTextSelection(
      editor as EditorImplementation,
      blockId,
      1,
      blockId,
      4,
    );
    const canonical = editor.selection.getSnapshot();
    if (canonical.kind !== "document")
      throw new Error("selection was not committed");
    const captured = canonical.snapshot;

    expect(editor.insertText({ blockId, offset: 0, text: "X" })).toBe(true);
    expect(
      editor.formatSelectionInlineMark({
        selection: captured,
        markName: "strong",
        action: "add",
      }),
    ).toMatchObject({ ok: true, changed: true });
    expect(editor.readBlockContent(blockId, "textBlock")).toMatchObject({
      content: [
        {
          content: [
            { text: "Xa" },
            { text: "bcd", marks: [{ type: "strong" }] },
            { text: "e" },
          ],
        },
      ],
    });
    editor.dispose();
  });

  it("maintains current canonical offsets centrally for passive formatting reads", () => {
    const blockId = "editor-api-current-selection-offsets" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "abcde" },
      ]),
    });
    commitTestTextSelection(
      editor as EditorImplementation,
      blockId,
      1,
      blockId,
      4,
    );
    expect(editor.insertText({ blockId, offset: 0, text: "X" })).toBe(true);

    const read = editor.readCurrentSelectionInlineMarkFormatStates({
      marks: ["strong"],
    });
    expect(read).toMatchObject({
      ok: true,
      states: {
        strong: {
          ranges: [{ blockId, from: 2, to: 5 }],
        },
      },
    });
    editor.dispose();
  });

  it("reports collapsed and absent selections as ineligible and combines mixed mark values", () => {
    const firstId = "editor-api-selection-state-first" as BlockId;
    const secondId = "editor-api-selection-state-second" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: firstId, type: "textBlock", text: "first" },
        { id: secondId, type: "textBlock", text: "second" },
      ]),
    });
    expect(
      editor.readCurrentSelectionInlineMarkFormatStates({ marks: ["strong"] }),
    ).toMatchObject({ ok: false, reason: "not-committed" });
    commitTestTextSelection(
      editor as EditorImplementation,
      firstId,
      2,
      firstId,
      2,
    );
    expect(
      editor.readCurrentSelectionInlineMarkFormatStates({ marks: ["strong"] }),
    ).toMatchObject({ ok: false, reason: "empty-range" });

    expect(
      editor.updateMark({
        blockId: firstId,
        range: { from: 0, to: 5 },
        mark: { type: "link", attrs: { href: "https://first.example" } },
        enabled: true,
      }),
    ).toBe(true);
    expect(
      editor.updateMark({
        blockId: secondId,
        range: { from: 0, to: 6 },
        mark: { type: "link", attrs: { href: "https://second.example" } },
        enabled: true,
      }),
    ).toBe(true);
    commitTestTextSelection(
      editor as EditorImplementation,
      firstId,
      0,
      secondId,
      6,
    );
    expect(
      editor.readCurrentSelectionInlineMarkFormatStates({ marks: ["link"] }),
    ).toMatchObject({
      ok: true,
      states: { link: { active: false, mixed: true, value: null } },
    });
    editor.dispose();
  });

  it("rejects a captured multi-block selection atomically when a required block disappears", () => {
    const firstId = "editor-api-selection-stale-first" as BlockId;
    const secondId = "editor-api-selection-stale-second" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: firstId, type: "textBlock", text: "first" },
        { id: secondId, type: "textBlock", text: "second" },
      ]),
    });
    commitTestTextSelection(
      editor as EditorImplementation,
      firstId,
      1,
      secondId,
      4,
    );
    const canonical = editor.selection.getSnapshot();
    if (canonical.kind !== "document")
      throw new Error("selection was not committed");
    expect(
      editor.transaction(() => {
        editor.deleteBlocks({
          blockIds: [secondId],
          includeDescendants: true,
        });
      }),
    ).toMatchObject({ ok: true, changed: true });
    expect(
      editor.formatSelectionInlineMark({
        selection: canonical.snapshot,
        markName: "strong",
        action: "add",
      }),
    ).toMatchObject({ ok: false });
    expect(editor.readBlockContent(firstId, "textBlock")).toMatchObject({
      content: [{ content: [{ text: "first" }] }],
    });
    editor.dispose();
  });

  it("removes attributed marks by type without requiring insertion attributes", () => {
    const blockId = "editor-api-link-remove" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "linked" },
      ]),
    });

    expect(
      editor.updateMark({
        blockId,
        range: { from: 0, to: 6 },
        mark: {
          type: "link",
          attrs: { href: "https://example.test" },
        },
        enabled: true,
      }),
    ).toBe(true);
    expect(
      editor.updateMark({
        blockId,
        range: { from: 0, to: 6 },
        mark: { type: "link" },
        enabled: false,
      }),
    ).toBe(true);
    expect(
      editor.updateMark({
        blockId,
        range: { from: 0, to: 6 },
        mark: { type: "link" },
        enabled: false,
      }),
    ).toBe(false);
    editor.dispose();
  });

  it("rejects invalid mark metadata and validates configured inline atoms", () => {
    const blockId = "editor-api-mark-atom-validation" as BlockId;
    const changes = vi.fn();
    const definition: EditableEditorDefinition = {
      ...testEditableEditorDefinition,
      inlineAtoms: [
        {
          type: "mention",
          metadata: { id: { type: "string", required: true } },
          render: () => null,
        },
      ],
    };
    const editor = initializeTestEditableEditor({
      definition,
      snapshot: createTestEditorSnapshot([
        { id: blockId, type: "textBlock", text: "@ada" },
      ]),
      onChange: changes,
    });
    expect(
      editor.updateMark({
        blockId,
        range: { from: 0, to: 4 },
        mark: { type: "link", attrs: { href: "javascript:alert(1)" } },
        enabled: true,
      }),
    ).toBe(false);
    expect(
      editor.updateInlineAtom({
        blockId,
        range: { from: 0, to: 4 },
        atom: { type: "mention", metadata: {} },
      }),
    ).toBe(false);
    expect(changes).not.toHaveBeenCalled();
    expect(editor.canUndo).toBe(false);
    const acceptedAtomMetadata = { id: "ada" };
    expect(
      editor.updateInlineAtom({
        blockId,
        range: { from: 0, to: 4 },
        atom: { type: "mention", metadata: acceptedAtomMetadata },
      }),
    ).toBe(true);
    acceptedAtomMetadata.id = "grace";
    expect(changes).toHaveBeenCalledTimes(1);
    expect(editor.canUndo).toBe(true);
    expect(editor.readBlockContent(blockId, "textBlock")).toMatchObject({
      content: [{ content: [{ type: "mention", metadata: { id: "ada" } }] }],
    });
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.redo()).toEqual({ status: "applied" });
    editor.dispose();
  });

  it("validates the definition and startup snapshot before creating content", () => {
    let contentCreations = 0;
    const createRuntime = (
      source: Parameters<typeof createEditorContentRuntime>[0],
    ) => {
      contentCreations += 1;
      return createEditorContentRuntime(source);
    };
    const invalidDefinition = {
      ...testEditableEditorDefinition,
      content: { createRuntime },
      blocks: {
        ...testEditableEditorDefinition.blocks,
        textBlock: {
          ...testEditableEditorDefinition.blocks.textBlock!,
          renderer: undefined,
        },
      },
    };

    expect(() =>
      initializeTestEditableEditor({
        // @ts-expect-error The missing renderer is the invalid startup contract under test.
        definition: invalidDefinition,
        snapshot: createTestEditorSnapshot([
          { type: "textBlock", text: "invalid definition" },
        ]),
      }),
    ).toThrow();
    expect(contentCreations).toBe(0);

    const definition = {
      ...testEditableEditorDefinition,
      content: { createRuntime },
    } satisfies EditableEditorDefinition;
    const snapshot = createTestEditorSnapshot([
      { type: "textBlock", text: "invalid snapshot" },
    ]);
    expect(() =>
      initializeTestEditableEditor({
        definition,
        snapshot: {
          ...snapshot,
          rootBlockIds: [...snapshot.rootBlockIds, ...snapshot.rootBlockIds],
        },
      }),
    ).toThrow();
    expect(contentCreations).toBe(0);
  });

  it("drains explicit disposal in reverse order and remains idempotent", () => {
    const events: string[] = [];
    const editor = initializeTestEditableEditor({
      definition: createCleanupDefinition(events),
      snapshot: createTestEditorSnapshot([
        {
          id: "editor-api-cleanup" as BlockId,
          type: "textBlock",
          text: "cleanup",
        },
      ]),
    });

    editor.dispose();
    editor.dispose();

    expect(events).toEqual(["content-destroy"]);
  });

  it("continues explicit disposal after a cleanup failure", () => {
    const events: string[] = [];
    const definition = createCleanupDefinition(events);
    const editor = initializeTestEditableEditor({
      definition,
      snapshot: createTestEditorSnapshot([
        { type: "textBlock", text: "cleanup isolation" },
      ]),
    });
    (editor as EditorImplementation).registerCleanup(() => {
      events.push("core-cleanup-failed");
      throw new Error("cleanup failure");
    });

    expect(() => editor.dispose()).not.toThrow();
    expect(events).toEqual(["core-cleanup-failed", "content-destroy"]);
    expect(editor.getDiagnostics().cleanupFailureCount).toBe(1);
  });

  it("isolates stores, content runtimes, selection controllers, and callbacks", () => {
    const blockId = "editor-api-isolation" as BlockId;
    const snapshot = createTestEditorSnapshot([
      { id: blockId, type: "textBlock", text: "isolated" },
    ]);
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const first = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
      onChange: firstListener,
    }) as EditableEditorRuntimePort;
    const second = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
      onChange: secondListener,
    }) as EditableEditorRuntimePort;

    expect(first.store).not.toBe(second.store);
    expect(first.contentRuntime).not.toBe(second.contentRuntime);
    expect(first.selectionController).toBeDefined();
    expect(second.selectionController).toBeDefined();
    expect(first.selectionController).not.toBe(second.selectionController);

    first.updateBlockMetadata([{ blockId, values: { owner: "first" } }]);
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();

    first.dispose();
    expect(second.isDisposed()).toBe(false);
    expect(second.getBlock(blockId)?.metadata?.["owner"]).toBeUndefined();
    second.updateBlockMetadata([{ blockId, values: { owner: "second" } }]);
    expect(secondListener).toHaveBeenCalledOnce();
    second.dispose();
  });
});

describe("core structural key behavior", () => {
  it("retains one selection controller across editable document remounts", () => {
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { type: "textBlock", text: "selection owner" },
      ]),
    }) as EditableEditorRuntimePort;
    const firstView = render(<EditorDocument editor={editor} />);
    const controller = renderProbe.selectionController;

    firstView.unmount();
    const secondView = render(<EditorDocument editor={editor} />);
    expect(renderProbe.selectionController).toBe(controller);

    secondView.unmount();
    editor.dispose();
  });

  it("rejects a second simultaneous editable document lease", () => {
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { type: "textBlock", text: "single editable mount" },
      ]),
    }) as EditableEditorRuntimePort;
    expect(editor.editable).toBe(true);
    const firstView = render(<EditorDocument editor={editor} />);

    expect(() => render(<EditorDocument editor={editor} />)).toThrow(
      /only one mounted editable document/,
    );

    firstView.unmount();
    editor.dispose();
  });

  it("disposes the editor-owned selection controller", () => {
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { type: "textBlock", text: "dispose selection" },
      ]),
    }) as EditableEditorRuntimePort;
    const disposeSelection = vi.spyOn(editor.selectionController, "dispose");

    editor.dispose();

    expect(disposeSelection).toHaveBeenCalledOnce();
  });

  it("keeps one editor object across rerenders and observes the latest callback", async () => {
    const blockId = "editor-api-textBlock" as BlockId;
    const snapshot = createTestEditorSnapshot([
      { id: blockId, type: "textBlock", text: "hello" },
    ]);
    const firstOnChange = vi.fn();
    const secondOnChange = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ onChange }) => {
        const editor = useEditor({
          definition: testEditableEditorDefinition,
          snapshot,
          onChange,
        });
        return editor;
      },
      { initialProps: { onChange: firstOnChange } },
    );
    const initialEditor = result.current;

    rerender({ onChange: secondOnChange });
    expect(result.current).toBe(initialEditor);

    act(() => {
      const changed = (
        result.current as EditorImplementation
      ).updateBlockMetadata([{ blockId, values: { "test-label": "updated" } }]);
      expect(changed).toBe(true);
    });
    expect(firstOnChange).not.toHaveBeenCalled();
    expect(secondOnChange).toHaveBeenCalledOnce();

    unmount();
    await flushMicrotasks();
  });

  it("isolates rejected consumer callbacks from later local changes", async () => {
    const blockId = "editor-api-callback-rejection" as BlockId;
    const rejected = vi.fn(() => Promise.reject(new Error("consumer failed")));
    const recovered = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ onChange }) => {
        const editor = useEditor({
          definition: testEditableEditorDefinition,
          snapshot: createTestEditorSnapshot([
            { id: blockId, type: "textBlock", text: "callback" },
          ]),
          onChange,
        });
        return editor;
      },
      { initialProps: { onChange: rejected } },
    );
    const editor = result.current as EditorImplementation;

    act(() => {
      editor.updateBlockMetadata([
        { blockId, values: { "callback-field": "first" } },
      ]);
    });
    await flushMicrotasks();
    rerender({ onChange: recovered });
    act(() => {
      editor.updateBlockMetadata([
        { blockId, values: { "callback-field": "second" } },
      ]);
    });

    expect(rejected).toHaveBeenCalledOnce();
    expect(recovered).toHaveBeenCalledOnce();
    unmount();
    await flushMicrotasks();
  });

  it("provides onChange for the first transaction without effect registration", () => {
    const blockId = "editor-api-layout-subscription" as BlockId;
    const onChange = vi.fn();
    const hook = renderHook(() =>
      useEditor({
        definition: testEditableEditorDefinition,
        snapshot: createTestEditorSnapshot([
          { id: blockId, type: "textBlock", text: "construction" },
        ]),
        onChange,
      }),
    );

    act(() => {
      (hook.result.current as EditorImplementation).updateBlockMetadata([
        { blockId, values: { "first-transaction": true } },
      ]);
    });
    expect(onChange).toHaveBeenCalledOnce();
    hook.result.current.dispose();
    hook.unmount();
  });

  it("observes graph, metadata, and content changes without observing external changes", async () => {
    const firstId = "editor-api-observation-first" as BlockId;
    const secondId = "editor-api-observation-second" as BlockId;
    const observed = vi.fn();
    const { result, unmount } = renderHook(() => {
      const editor = useEditor({
        definition: testEditableEditorDefinition,
        snapshot: createTestEditorSnapshot([
          { id: firstId, type: "textBlock", text: "first" },
          { id: secondId, type: "textBlock", text: "second" },
        ]),
        onChange: observed,
      });
      return editor as EditableEditorRuntimePort;
    });

    act(() => {
      result.current.updateBlockMetadata([
        { blockId: firstId, values: { observed: true } },
      ]);
      result.current.executeStructuralTransaction({
        origin: "test:observed-move",
        operations: [
          moveBlocks({
            blockIds: [secondId],
            sourcePlacement: { parentId: null, childIndex: 1 },
            destinationPlacement: { parentId: null, childIndex: 0 },
          }),
        ],
      });
      commitTextAppend(result.current, firstId, " local");
    });

    expect(observed.mock.calls.map(([change]) => change.kind)).toEqual([
      "block-metadata",
      "block-graph",
      "block-content",
    ]);
    result.current.applyRemoteTransaction({
      authorSelection: {
        kind: "author-selection",
        subject: remoteSubject,
        selectionRevision: 1,
        selectionAfter: { kind: "none" },
      },
      transaction: {
        transactionId: "external-metadata",
        historyAction: "command",
        graph: null,
        metadata: {
          kind: "updateBlockMetadata",
          updates: [{ blockId: firstId, values: { external: true } }],
        },
        content: [],
      },
    });
    expect(observed).toHaveBeenCalledTimes(3);
    unmount();
    result.current.dispose();
  });

  it("retains the first editor across new options and equivalent snapshots", async () => {
    const snapshot = createTestEditorSnapshot([
      { type: "textBlock", text: "startup" },
    ]);
    let snapshotReads = 0;
    let contentCreations = 0;
    const definition: EditableEditorDefinition = {
      ...testEditableEditorDefinition,
      content: {
        createRuntime(source) {
          contentCreations += 1;
          return createEditorContentRuntime(source);
        },
      },
    };
    const { result, rerender, unmount } = renderHook(() => {
      return useEditor({
        definition,
        get snapshot() {
          snapshotReads += 1;
          return {
            ...snapshot,
            blocks: { ...snapshot.blocks },
            rootBlockIds: [...snapshot.rootBlockIds],
            childIdsByParentId: { ...snapshot.childIdsByParentId },
            content: { ...snapshot.content },
          };
        },
      });
    });
    const editor = result.current;

    rerender();
    expect(result.current).toBe(editor);
    expect(snapshotReads).toBe(1);
    expect(contentCreations).toBe(1);

    unmount();
    await flushMicrotasks();
  });

  it("does not dispose the core editor on unmount", async () => {
    const blockId = "editor-api-unmount" as BlockId;
    const { result, unmount } = renderHook(() =>
      useEditor({
        definition: testEditableEditorDefinition,
        snapshot: createTestEditorSnapshot([
          { id: blockId, type: "textBlock", text: "retained" },
        ]),
      }),
    );
    const editor = result.current as EditorImplementation;
    const dispose = vi.spyOn(result.current, "dispose");

    unmount();
    await flushMicrotasks();

    expect(dispose).not.toHaveBeenCalled();
    expect(editor.isDisposed()).toBe(false);
    expect(
      editor.updateBlockMetadata([
        { blockId, values: { "after-unmount": true } },
      ]),
    ).toBe(true);
    editor.dispose();
  });

  it("keeps the committed Strict Mode editor valid across effects, timers, and unmount", async () => {
    vi.useFakeTimers();
    try {
      const snapshot = createTestEditorSnapshot([
        { type: "textBlock", text: "strict" },
      ]);
      const { result, unmount } = renderHook(
        () =>
          useEditor({
            definition: testEditableEditorDefinition,
            snapshot,
          }),
        { wrapper: StrictMode },
      );
      const editor = result.current as EditorImplementation;
      const dispose = vi.spyOn(result.current, "dispose");

      await flushMicrotasks();
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(editor.isDisposed()).toBe(false);
      expect(editor.selectionController).toBeDefined();

      unmount();
      await flushMicrotasks();
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(dispose).not.toHaveBeenCalled();
      expect(editor.isDisposed()).toBe(false);
      editor.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains one settled pending text activation on the committed Strict Mode instance", () => {
    const blockId = "editor-api-strict-isolation" as BlockId;
    const { result, unmount } = renderHook(
      () =>
        useEditor({
          definition: testEditableEditorDefinition,
          snapshot: createTestEditorSnapshot([
            { id: blockId, type: "textBlock", text: "strict isolation" },
          ]),
        }),
      { wrapper: StrictMode },
    );
    const committed = result.current as EditorImplementation;
    expect(committed.focusText(blockId, { offset: 2 })).toEqual({
      status: "pending",
    });
    expect(committed.selectionController.canonical.getSnapshot()).toMatchObject(
      {
        kind: "document",
        revision: 1,
        snapshot: {
          focus: { target: { blockId, textOffset: 2 } },
        },
      },
    );

    unmount();
    committed.dispose();
  });

  it("keeps an atomic request pending until its exact target mounts", () => {
    const blockId = "editor-api-pending-atomic-focus" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([{ id: blockId, type: "atomicBlock" }]),
    });

    expect(editor.focusBlock(blockId, { preventScroll: true })).toEqual({
      status: "pending",
    });
    expect(editor.selectionController.canonical.getSnapshot()).toMatchObject({
      kind: "none",
    });

    editor.dispose();
  });

  it("makes queued changes, focus actions, and settlement subscriptions inert after disposal", async () => {
    const blockId = "editor-api-disposed" as BlockId;
    const { result, unmount } = renderHook(() =>
      useEditor({
        definition: testEditableEditorDefinition,
        snapshot: createTestEditorSnapshot([
          { id: blockId, type: "textBlock", text: "disposed" },
        ]),
      }),
    );
    const implementation = result.current as EditorImplementation;
    const settlementListener = vi.fn();
    implementation.selectionController.subscribeStandaloneSettlements(
      settlementListener,
    );
    result.current.dispose();
    expect(result.current.focusBlock(blockId, { preventScroll: true })).toEqual(
      {
        status: "rejected",
        reason: "disposed",
      },
    );

    expect(
      result.current.applyRemoteTransaction({
        authorSelection: {
          kind: "author-selection",
          subject: remoteSubject,
          selectionRevision: 1,
          selectionAfter: { kind: "none" },
        },
        transaction: {
          transactionId: "disposed-ingress",
          historyAction: "command",
          graph: {
            affectedBlockIds: [blockId],
            upsertedBlocks: [],
          },
          metadata: null,
          content: [],
        },
      }),
    ).toMatchObject({
      status: "rejected",
      reason: "editor-disposed",
    });
    expect(result.current.getDiagnostics().blockGraphVersion).toBe(1);
    expect(settlementListener).not.toHaveBeenCalled();

    unmount();
    await flushMicrotasks();
  });

  it("supersedes a pending text activation without resettling canonical selection", async () => {
    const blockId = "editor-api-focus" as BlockId;
    const snapshot = createTestEditorSnapshot([
      { id: blockId, type: "textBlock", text: "focus" },
    ]);
    const { result, unmount } = renderHook(() =>
      useEditor({
        definition: testEditableEditorDefinition,
        snapshot,
      }),
    );
    const options = { offset: 2, preventScroll: true } as const;

    expect(result.current.focusText(blockId, options)).toEqual({
      status: "pending",
    });

    await flushMicrotasks();
    expect(result.current.focusText(blockId, options)).toEqual({
      status: "pending",
    });
    expect(
      result.current.selectionController.canonical.getSnapshot(),
    ).toMatchObject({
      kind: "document",
      revision: 1,
      snapshot: {
        focus: { target: { blockId, textOffset: 2 } },
      },
    });

    unmount();
    await flushMicrotasks();
  });

  it("does not publish or notify for a semantic no-op move", async () => {
    const firstId = "editor-api-noop-first" as BlockId;
    const movingId = "editor-api-noop-moving" as BlockId;
    const lastId = "editor-api-noop-last" as BlockId;
    const onChange = vi.fn();
    const definition: EditableEditorDefinition = {
      ...testEditableEditorDefinition,
      blocks: {
        ...testEditableEditorDefinition.blocks,
        wrapperBlock: {
          ...testEditableEditorDefinition.blocks.wrapperBlock!,
          content: {
            required: ["textBlock"],
            additional: "textBlock",
          },
        },
      },
    };
    const { result, unmount } = renderHook(() => {
      const editor = useEditor({
        definition,
        snapshot: createTestEditorSnapshot([
          { id: firstId, type: "textBlock", text: "first" },
          { id: movingId, type: "textBlock", text: "moving" },
          { id: lastId, type: "textBlock", text: "last" },
        ]),
        onChange,
      });
      return editor;
    });
    const editor = result.current as EditorImplementation;
    const roots = editor.getRootBlockIds();
    const moving = editor.getBlock(movingId);
    const rootListener = vi.fn();
    const movingListener = vi.fn();
    const releaseRoot = editor.subscribeRootBlockIds(rootListener);
    const releaseMoving = editor.subscribeBlock(movingId, movingListener);

    let transaction: ReturnType<
      EditorImplementation["executeStructuralTransaction"]
    > | null = null;
    act(() => {
      transaction = editor.executeStructuralTransaction({
        origin: "test:no-op-final-index",
        operations: [
          moveBlocks({
            blockIds: [movingId],
            sourcePlacement: { parentId: null, childIndex: 1 },
            destinationPlacement: { parentId: null, childIndex: 1 },
          }),
        ],
      });
    });

    expect(transaction).toMatchObject({
      ok: true,
      operationResult: { ok: true },
    });
    const completed = requireStructuralTransaction(transaction);
    expect(completed.operationResult.operation).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
    expect(rootListener).not.toHaveBeenCalled();
    expect(movingListener).not.toHaveBeenCalled();
    expect(editor.getRootBlockIds()).toBe(roots);
    expect(editor.getBlock(movingId)).toBe(moving);

    releaseRoot();
    releaseMoving();
    unmount();
    await flushMicrotasks();
  });

  it("notifies only the granular block subscriber affected by a change", async () => {
    const firstId = "editor-api-subscription-first" as BlockId;
    const secondId = "editor-api-subscription-second" as BlockId;
    const snapshot = createTestEditorSnapshot([
      { id: firstId, type: "textBlock", text: "first" },
      { id: secondId, type: "textBlock", text: "second" },
    ]);
    const { result, unmount } = renderHook(() =>
      useEditor({
        definition: testEditableEditorDefinition,
        snapshot,
      }),
    );
    const editor = result.current as EditorImplementation;
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const unsubscribeFirst = editor.subscribeBlock(firstId, firstListener);
    const unsubscribeSecond = editor.subscribeBlock(secondId, secondListener);

    act(() => {
      editor.updateBlockMetadata([
        { blockId: firstId, values: { "subscription-field": true } },
      ]);
    });
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();

    unsubscribeFirst();
    unsubscribeSecond();
    unmount();
    await flushMicrotasks();
  });

  it("publishes root, child, block, and selection graph changes only to affected subscribers", async () => {
    const firstWrapperId = "focused-graph-first-wrapper" as BlockId;
    const secondWrapperId = "focused-graph-second-wrapper" as BlockId;
    const firstChildId = "focused-graph-first-child" as BlockId;
    const secondChildId = "focused-graph-second-child" as BlockId;
    const unrelatedId = "focused-graph-unrelated" as BlockId;
    const flat = createTestEditorSnapshot([
      { id: firstWrapperId, type: "wrapperBlock" },
      { id: firstChildId, type: "textBlock", text: "first" },
      { id: secondWrapperId, type: "wrapperBlock" },
      { id: secondChildId, type: "textBlock", text: "second" },
      { id: unrelatedId, type: "textBlock", text: "unrelated" },
    ]);
    const snapshot = {
      ...flat,
      blocks: {
        ...flat.blocks,
        [firstChildId]: {
          ...flat.blocks[firstChildId]!,
          parentId: firstWrapperId,
        },
        [secondChildId]: {
          ...flat.blocks[secondChildId]!,
          parentId: secondWrapperId,
        },
      },
      rootBlockIds: [firstWrapperId, secondWrapperId, unrelatedId],
      childIdsByParentId: {
        [firstWrapperId]: [firstChildId],
        [secondWrapperId]: [secondChildId],
      },
    };
    const { result, unmount } = renderHook(() =>
      useEditor({
        definition: testEditableEditorDefinition,
        snapshot,
      }),
    );
    const editor = result.current as EditorImplementation;
    const rootBefore = editor.getRootBlockIds();
    const firstChildrenBefore = editor.getChildBlockIds(firstWrapperId);
    const unrelatedBefore = editor.getBlock(unrelatedId);
    const rootListener = vi.fn();
    const firstChildrenListener = vi.fn();
    const secondChildrenListener = vi.fn();
    const firstChildListener = vi.fn();
    const secondChildListener = vi.fn();
    const unrelatedListener = vi.fn();
    const releases = [
      editor.subscribeRootBlockIds(rootListener),
      editor.subscribeChildBlockIds(firstWrapperId, firstChildrenListener),
      editor.subscribeChildBlockIds(secondWrapperId, secondChildrenListener),
      editor.subscribeBlock(firstChildId, firstChildListener),
      editor.subscribeBlock(secondChildId, secondChildListener),
      editor.subscribeBlock(unrelatedId, unrelatedListener),
    ];
    const current = editor.getManifestData();

    act(() => {
      editor.reconcileEditorSnapshotForRecovery({
        origin: "external-snapshot",
        blockGraphVersion: editor.getEditorInfo().blockGraphVersion + 1,
        blocks: {
          ...current.blocks,
          [firstChildId]: {
            ...current.blocks[firstChildId]!,
            parentId: secondWrapperId,
          },
          [secondChildId]: {
            ...current.blocks[secondChildId]!,
            parentId: firstWrapperId,
          },
        },
        rootBlockIds: [unrelatedId, firstWrapperId, secondWrapperId],
        childIdsByParentId: {
          [firstWrapperId]: [secondChildId],
          [secondWrapperId]: [firstChildId],
        },
      });
    });

    expect(rootListener).toHaveBeenCalledOnce();
    expect(firstChildrenListener).toHaveBeenCalledOnce();
    expect(secondChildrenListener).toHaveBeenCalledOnce();
    expect(firstChildListener).toHaveBeenCalledOnce();
    expect(secondChildListener).toHaveBeenCalledOnce();
    expect(unrelatedListener).not.toHaveBeenCalled();
    expect(editor.getRootBlockIds()).not.toBe(rootBefore);
    expect(editor.getChildBlockIds(firstWrapperId)).not.toBe(
      firstChildrenBefore,
    );
    expect(editor.getBlock(unrelatedId)).toBe(unrelatedBefore);

    for (const release of releases) release();
    unmount();
    await flushMicrotasks();
  });

  it("keeps canonical graph snapshots stable across pending focus requests", async () => {
    const blockId = "focused-graph-stability" as BlockId;
    const snapshot = createTestEditorSnapshot([
      { id: blockId, type: "textBlock", text: "stable" },
    ]);
    const { result, unmount } = renderHook(() =>
      useEditor({
        definition: testEditableEditorDefinition,
        snapshot,
      }),
    );
    const editor = result.current as EditorImplementation;
    const roots = editor.getRootBlockIds();
    const block = editor.getBlock(blockId);
    const rootListener = vi.fn();
    const blockListener = vi.fn();
    const releases = [
      editor.subscribeRootBlockIds(rootListener),
      editor.subscribeBlock(blockId, blockListener),
    ];

    expect(editor.focusText(blockId, { offset: 1 })).toEqual({
      status: "pending",
    });

    expect(editor.getRootBlockIds()).toBe(roots);
    expect(editor.getBlock(blockId)).toBe(block);
    expect(rootListener).not.toHaveBeenCalled();
    expect(blockListener).not.toHaveBeenCalled();

    for (const release of releases) release();
    unmount();
    await flushMicrotasks();
  });

  it("reuses every equal graph reference during a newer no-op reconciliation", async () => {
    const blockId = "no-op-reconciliation" as BlockId;
    const snapshot = createTestEditorSnapshot([
      { id: blockId, type: "textBlock", text: "stable" },
    ]);
    const { result, unmount } = renderHook(() =>
      useEditor({
        definition: testEditableEditorDefinition,
        snapshot,
      }),
    );
    const editor = result.current as EditorImplementation;
    const before = editor.getManifestData();
    const rootListener = vi.fn();
    const blockListener = vi.fn();
    const releases = [
      editor.subscribeRootBlockIds(rootListener),
      editor.subscribeBlock(blockId, blockListener),
    ];

    act(() => {
      editor.reconcileEditorSnapshotForRecovery({
        origin: "external-snapshot",
        blockGraphVersion: editor.getEditorInfo().blockGraphVersion + 1,
        blocks: {
          [blockId]: { ...before.blocks[blockId]! },
        },
        rootBlockIds: [...before.rootBlockIds],
        childIdsByParentId: { ...before.childIdsByParentId },
      });
    });

    const after = editor.getManifestData();
    expect(after.blocks).toBe(before.blocks);
    expect(after.blocks[blockId]).toBe(before.blocks[blockId]);
    expect(after.rootBlockIds).toBe(before.rootBlockIds);
    expect(after.childIdsByParentId).toBe(before.childIdsByParentId);
    expect(rootListener).not.toHaveBeenCalled();
    expect(blockListener).not.toHaveBeenCalled();

    for (const release of releases) release();
    unmount();
    await flushMicrotasks();
  });
});

describe("EditorDocument", () => {
  it("passes the same concrete editor object to rendering", async () => {
    const snapshot = createTestEditorSnapshot([
      { type: "textBlock", text: "render" },
    ]);
    const hook = renderHook(() =>
      useEditor({
        definition: testEditableEditorDefinition,
        snapshot,
      }),
    );
    const editor: EditableEditor = hook.result.current;
    const view = render(<EditorDocument editor={editor} />);
    expect(renderProbe.editor).toBe(editor);
    expect(view.getByTestId("render-probe")).toBeTruthy();

    view.unmount();
    hook.unmount();
    await flushMicrotasks();
  });
});

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function commitTestTextSelection(
  editor: EditorImplementation,
  anchorBlockId: BlockId,
  anchorOffset: number,
  focusBlockId: BlockId,
  focusOffset: number,
): void {
  const capturePoint = (blockId: BlockId, offset: number) => {
    editor.focusText(blockId, { offset });
    const canonical = editor.selectionController.getCanonicalSnapshot();
    if (canonical.kind !== "document") {
      throw new Error("text focus did not create a document selection");
    }
    const point = canonical.snapshot.documentSelection.focus;
    if (!point?.textAnchor)
      throw new Error("text focus did not create an anchor");
    return point;
  };
  const anchor = capturePoint(anchorBlockId, anchorOffset);
  const focus = capturePoint(focusBlockId, focusOffset);
  const result = editor.selectionController.commitCanonicalSelection(
    { direction: "forward", anchor, focus },
    editor,
    editor.getSelectionGraphRevision(),
    {
      publication: { kind: "standalone-local" },
      cause: "programmatic-edit",
    },
    {
      resolveTextAnchor: (point) => editor.resolveSelectionTextAnchor(point),
    },
  );
  if (result.kind === "rejected") throw new Error("selection was rejected");
}

function commitTextAppend(
  editor: EditableEditorRuntimePort,
  blockId: BlockId,
  text: string,
): void {
  const blockType = "textBlock";
  const offset = editor.readBlockPlainText(blockId, blockType).length;
  const base = editor.contentRuntime.readContentBaseToken(
    blockId,
    blockType,
    editor.getSelectionGraphRevision(),
  );
  const content = [{ type: "text" as const, text }];
  const result = editor.acceptContentOperationProposal(
    {
      base,
      operations: [
        {
          kind: "insertInlineContent",
          blockId,
          blockType,
          target: { kind: "text" },
          position: { blockId, offset },
          content,
        },
      ],
      selectionAfter: null,
    },
    {
      origin: "prosemirror-proposal",
      selectionPresentation: "restore-native",
      provenance: null,
    },
  );
  expect(result.ok).toBe(true);
}

function createCleanupDefinition(
  events: string[],
  onCreate: () => void = () => undefined,
): EditableEditorDefinition {
  return {
    ...testEditableEditorDefinition,
    content: {
      createRuntime(source) {
        onCreate();
        const content = createEditorContentRuntime(source);
        return {
          ...content,
          destroy() {
            events.push("content-destroy");
            content.destroy();
          },
        };
      },
    },
  };
}

function requireStructuralTransaction(
  value: ReturnType<
    EditorImplementation["executeStructuralTransaction"]
  > | null,
): Extract<
  ReturnType<EditorImplementation["executeStructuralTransaction"]>,
  { readonly ok: true }
> {
  expect(value).not.toBeNull();
  if (!value || !value.ok) {
    throw new Error("expected a successful structural transaction");
  }
  return value;
}
