import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import type { BlockId } from "@repo/editor-core/kernel";
import { EditorDocument } from "@repo/editor-web/document-runtime";
import { compileCanonicalEditorDefinition } from "@repo/editor-web/editor-definition";
import { type EditableEditorDefinition } from "@repo/editor-web/editor";
import type { EditorImplementation } from "@repo/editor-react/editor";
import {
  createYjsBlockContentRuntime,
  type YjsBlockContentRuntime,
} from "@repo/editor-yjs-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
} from "./blocks/view-state.tsx";
import { FirstDraftBlockHoverProvider } from "./block-controls/index.ts";
import { createFirstDraftEditorDefinition } from "./first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "./first-draft-fixture.ts";
import { createFirstDraftBootstrapFromSnapshot } from "./bootstrap/bootstrap.ts";
import { FirstDraftSelectionMenu } from "./selection-menu/index.ts";
import { initializeCompiledTestEditableEditor as initializeEditableEditor } from "./test-editor.ts";

const allocations = vi.hoisted(() => ({
  yDocs: 0,
  plannerEvents: [] as string[],
}));

vi.mock("@repo/editor-yjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/editor-yjs")>();
  const planOwners = new WeakMap<object, string>();
  class InstrumentedDoc extends actual.Doc {
    constructor(options?: ConstructorParameters<typeof actual.Doc>[0]) {
      super(options);
      allocations.yDocs += 1;
    }
  }
  return {
    ...actual,
    Doc: InstrumentedDoc,
    YDoc: InstrumentedDoc,
    planCanonicalYjsContentMutation(
      input: Parameters<typeof actual.planCanonicalYjsContentMutation>[0],
    ) {
      const blockId = String(input.operation.blockId);
      allocations.plannerEvents.push(`plan:${blockId}`);
      const plan = actual.planCanonicalYjsContentMutation(input);
      if (plan) planOwners.set(plan, blockId);
      return plan;
    },
    applyPlannedCanonicalYjsContentMutation(
      plan: Parameters<
        typeof actual.applyPlannedCanonicalYjsContentMutation
      >[0],
    ) {
      allocations.plannerEvents.push(`apply:${planOwners.get(plan) ?? "unknown"}`);
      return actual.applyPlannedCanonicalYjsContentMutation(plan);
    },
  };
});

const blockA = "fd-paragraph-intro" as BlockId;
const blockB = "fd-paragraph-byline" as BlockId;
const beforeList = "fd-paragraph-outro" as BlockId;
const bulletList = "fd-bullet-list" as BlockId;
const bulletItemA = "fd-bullet-1" as BlockId;
const bulletTextA = "fd-bullet-1-text" as BlockId;
const bulletItemB = "fd-bullet-2" as BlockId;
const bulletTextB = "fd-bullet-2-text" as BlockId;
const afterList = "fd-paragraph-after-table" as BlockId;

describe("First Draft real pointer activation allocation contract", () => {
  afterEach(() => {
    allocations.plannerEvents = [];
    cleanup();
    vi.restoreAllMocks();
  });

  it("plans one real local transition once for command, undo, redo, and repeated history", () => {
    const bootstrap = createFirstDraftBootstrapFromSnapshot({
      documentId: "single-pass-history-document",
      revision: 0,
      snapshot: createPointerSnapshot(),
    });
    const changes = vi.fn();
    const viewState = createFirstDraftViewStateStore();
    const definition = createFirstDraftEditorDefinition(viewState);
    const editor = initializeEditableEditor({
      compiledDefinition: compileCanonicalEditorDefinition(definition),
      snapshot: bootstrap.snapshot,
      validatedSnapshot: bootstrap,
      onChange: changes,
      onChangeError: (error) => {
        throw error;
      },
      createTransactionId: () => crypto.randomUUID(),
    });

    allocations.plannerEvents = [];
    expect(editor.insertText({ blockId: blockA, offset: 0, text: "x" })).toBe(
      true,
    );
    expectSinglePlannerBatch(blockA);
    expect(changes).toHaveBeenCalledTimes(1);

    allocations.plannerEvents = [];
    expect(editor.undo()).toEqual({ status: "applied" });
    expectSinglePlannerBatch(blockA);
    expect(changes).toHaveBeenCalledTimes(2);

    allocations.plannerEvents = [];
    expect(editor.redo()).toEqual({ status: "applied" });
    expectSinglePlannerBatch(blockA);
    expect(changes).toHaveBeenCalledTimes(3);

    allocations.plannerEvents = [];
    expect(editor.undo()).toEqual({ status: "applied" });
    expectSinglePlannerBatch(blockA);
    allocations.plannerEvents = [];
    expect(editor.redo()).toEqual({ status: "applied" });
    expectSinglePlannerBatch(blockA);
    expect(changes).toHaveBeenCalledTimes(5);
    expect(editor.readBlockPlainText(blockA, "paragraph")).toContain("x");

    allocations.plannerEvents = [];
    const multi = editor.transaction(() => {
      expect(
        editor.insertText({ blockId: blockA, offset: 1, text: "a" }),
      ).toBe(true);
      expect(
        editor.insertText({ blockId: blockB, offset: 1, text: "b" }),
      ).toBe(true);
    });
    expect(multi.ok).toBe(true);
    expectPlannerBatch([blockA, blockB]);
    expect(changes).toHaveBeenCalledTimes(6);

    allocations.plannerEvents = [];
    expect(editor.undo()).toEqual({ status: "applied" });
    expectPlannerBatch([blockB, blockA]);
    allocations.plannerEvents = [];
    expect(editor.redo()).toEqual({ status: "applied" });
    expectPlannerBatch([blockA, blockB]);
    expect(changes).toHaveBeenCalledTimes(8);
    editor.dispose();
  });

  it("hydrates once at settlement and hands that same live context to editing", () => {
    const snapshot = createPointerSnapshot();
    const bootstrap = createFirstDraftBootstrapFromSnapshot({
      documentId: "pointer-runtime-document",
      revision: 0,
      snapshot,
    });
    allocations.yDocs = 0;
    const checkpointDecodes = vi.spyOn(globalThis, "atob");
    const acquisitions: Array<{
      readonly blockId: BlockId;
      readonly reason: string;
      readonly context: object;
    }> = [];
    let anchorCreations = 0;
    let runtime: YjsBlockContentRuntime | null = null;
    const viewState = createFirstDraftViewStateStore();
    const definition = {
      ...createFirstDraftEditorDefinition(viewState),
      content: {
        createRuntime: (source) => {
          const real = createYjsBlockContentRuntime(source);
          const instrumented: YjsBlockContentRuntime = {
            ...real,
            acquireBlockContent(blockId, blockType, reason) {
              const lease = real.acquireBlockContent(
                blockId,
                blockType,
                reason,
              );
              acquisitions.push({
                blockId,
                reason,
                context: lease.context,
              });
              return lease;
            },
            createTextAnchorInContext(lease, input) {
              anchorCreations += 1;
              return real.createTextAnchorInContext(lease, input);
            },
          };
          runtime = instrumented;
          return instrumented;
        },
      },
    } satisfies EditableEditorDefinition;
    const editor = initializeEditableEditor({
      compiledDefinition: compileCanonicalEditorDefinition(definition),
      snapshot: bootstrap.snapshot,
      validatedSnapshot: bootstrap,
      onChange: vi.fn(),
      onChangeError: (error) => {
        throw error;
      },
      createTransactionId: () => crypto.randomUUID(),
    });
    const settlements = vi.fn();
    editor.subscribeStandaloneSelectionSettlements(settlements);
    const rendered = render(
      <FirstDraftViewStateProvider store={viewState}>
        <div data-editor-interaction-scope="true">
          <FirstDraftBlockHoverProvider enabled>
            <EditorDocument
              editor={editor}
              renderDocumentLayers={() => (
                <FirstDraftSelectionMenu editor={editor} />
              )}
            />
          </FirstDraftBlockHoverProvider>
        </div>
      </FirstDraftViewStateProvider>,
    );

    const downA = dispatchPointerDown(rendered.container, blockA, 1);
    expect(downA.defaultPrevented).toBe(true);
    expect(checkpointDecodes).not.toHaveBeenCalled();
    expect(allocations.yDocs).toBe(0);
    expect(acquisitions).toHaveLength(0);
    expect(anchorCreations).toBe(0);
    expect(settlements).not.toHaveBeenCalled();
    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(0);
    expect(document.activeElement?.classList.contains("ProseMirror")).toBe(
      false,
    );

    dispatchPointerUp(rendered.container, blockA, 1);
    expect({
      checkpointDecodes: checkpointDecodes.mock.calls.length,
      yDocs: allocations.yDocs,
      anchorCreations,
      settlements: settlements.mock.calls.length,
      editorViews: rendered.container.querySelectorAll(".ProseMirror").length,
      acquisitions: acquisitions.length,
    }).toEqual({
      checkpointDecodes: 1,
      yDocs: 1,
      anchorCreations: 1,
      settlements: 1,
      editorViews: 1,
      acquisitions: 2,
    });
    expect(acquisitions.map(({ reason }) => reason)).toEqual([
      "canonical-transaction",
      "active-editing",
    ]);
    expect(acquisitions[0]!.context).toBe(acquisitions[1]!.context);
    expect(runtime!.getLiveBlockContentCount()).toBe(1);
    const sharedEditorView =
      rendered.container.querySelector<HTMLElement>(".ProseMirror")!;
    expectNativeCaret(editor, sharedEditorView, blockA);

    const firstAContext = acquisitions[1]!.context;
    dispatchPointerClick(rendered.container, blockA, 2, true);
    expect(checkpointDecodes).toHaveBeenCalledTimes(1);
    expect(allocations.yDocs).toBe(1);
    expect(anchorCreations).toBe(2);
    expect(settlements).toHaveBeenCalledTimes(2);
    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(rendered.container.querySelector(".ProseMirror")).toBe(
      sharedEditorView,
    );
    expect(acquisitions).toHaveLength(3);
    expect(acquisitions[2]).toMatchObject({
      blockId: blockA,
      reason: "canonical-transaction",
    });
    expect(acquisitions[2]!.context).toBe(firstAContext);

    dispatchPointerClick(rendered.container, blockB, 3);
    expect(checkpointDecodes).toHaveBeenCalledTimes(2);
    expect(allocations.yDocs).toBe(2);
    expect(anchorCreations).toBe(3);
    expect(settlements).toHaveBeenCalledTimes(3);
    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(rendered.container.querySelector(".ProseMirror")).toBe(
      sharedEditorView,
    );
    expect(acquisitions).toHaveLength(5);
    expect(acquisitions[3]).toMatchObject({
      blockId: blockB,
      reason: "canonical-transaction",
    });
    expect(acquisitions[4]).toMatchObject({
      blockId: blockB,
      reason: "active-editing",
    });
    expect(acquisitions[3]!.context).toBe(acquisitions[4]!.context);
    expect(runtime!.getLiveBlockContentCount()).toBe(1);
    expectNativeCaret(editor, sharedEditorView, blockB);

    dispatchPointerClick(rendered.container, blockA, 4);
    expect(checkpointDecodes).toHaveBeenCalledTimes(3);
    expect(allocations.yDocs).toBe(3);
    expect(anchorCreations).toBe(4);
    expect(settlements).toHaveBeenCalledTimes(4);
    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(rendered.container.querySelector(".ProseMirror")).toBe(
      sharedEditorView,
    );
    expect(acquisitions).toHaveLength(7);
    expect(acquisitions[5]).toMatchObject({
      blockId: blockA,
      reason: "canonical-transaction",
    });
    expect(acquisitions[6]).toMatchObject({
      blockId: blockA,
      reason: "active-editing",
    });
    expect(acquisitions[5]!.context).toBe(acquisitions[6]!.context);
    expect(acquisitions[6]!.context).not.toBe(firstAContext);
    expect(runtime!.getLiveBlockContentCount()).toBe(1);
    expectNativeCaret(editor, sharedEditorView, blockA);

    rendered.unmount();
    expect(runtime!.getLiveBlockContentCount()).toBe(0);
    editor.dispose();
  });

  it.each([
    {
      label: "forward",
      anchorBlockId: blockA,
      focusBlockId: blockB,
      pointerId: 11,
    },
    {
      label: "backward",
      anchorBlockId: blockB,
      focusBlockId: blockA,
      pointerId: 12,
    },
  ])(
    "keeps a $label cross-block pointer range after repeated projected-caret selectionchange events",
    ({ anchorBlockId, focusBlockId, pointerId }) => {
      const bootstrap = createFirstDraftBootstrapFromSnapshot({
        documentId: `projected-caret-${pointerId}`,
        revision: 0,
        snapshot: createPointerSnapshot(),
      });
      const changes = vi.fn();
      const viewState = createFirstDraftViewStateStore();
      const editor = initializeEditableEditor({
        compiledDefinition: compileCanonicalEditorDefinition(
          createFirstDraftEditorDefinition(viewState),
        ),
        snapshot: bootstrap.snapshot,
        validatedSnapshot: bootstrap,
        onChange: changes,
        onChangeError: (error) => {
          throw error;
        },
        createTransactionId: () => crypto.randomUUID(),
      });
      const settlements = vi.fn();
      editor.subscribeStandaloneSelectionSettlements(settlements);
      const rendered = render(
        <FirstDraftViewStateProvider store={viewState}>
          <div data-editor-interaction-scope="true">
            <FirstDraftBlockHoverProvider enabled>
              <EditorDocument editor={editor} />
            </FirstDraftBlockHoverProvider>
          </div>
        </FirstDraftViewStateProvider>,
      );
      const list = rendered.container.querySelector<HTMLElement>(
        '[data-editor-block-list-root="true"]',
      );
      if (!list) throw new Error("Missing editor block list");
      Object.defineProperties(list, {
        setPointerCapture: { configurable: true, value: vi.fn() },
        hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
        releasePointerCapture: { configurable: true, value: vi.fn() },
      });
      const focusTextRoot = blockElement(
        rendered.container,
        focusBlockId,
      ).querySelector<HTMLElement>('[data-editor-text-root="true"]');
      if (!focusTextRoot) throw new Error("Missing focus text root");
      installTestRect(focusTextRoot);
      const originalClientRects = Object.getOwnPropertyDescriptor(
        Range.prototype,
        "getClientRects",
      );
      Object.defineProperty(Range.prototype, "getClientRects", {
        configurable: true,
        value: vi.fn(() => [selectionRectangle(0, 10, 100, 20)]),
      });

      try {
        dispatchPointerDown(rendered.container, anchorBlockId, pointerId, true);
        dispatchPointerMoveToElement(focusTextRoot, pointerId, 12, 12);
        expect(
          rendered.container.querySelector("[data-editor-selection-paint]"),
        ).not.toBeNull();

        dispatchPointerUp(rendered.container, focusBlockId, pointerId);

        const authoritative = editor.selectionController.getCanonicalSnapshot();
        expect(authoritative).toMatchObject({
          kind: "document",
          snapshot: {
            documentSelection: {
              anchor: { blockId: anchorBlockId },
              focus: { blockId: focusBlockId },
            },
          },
        });
        const settlement =
          editor.selectionController.getPresentationSnapshot().settlement;
        expect(settlement).not.toBeNull();
        expect(editor.selectionController.localPaint.getSnapshot()).toMatchObject(
          { kind: "range", sourceRevision: authoritative.revision },
        );
        expect(editor.selectionController.endpoint.getSnapshot().phase).toBe(
          "committed",
        );
        expect(list.dataset.editorNativeCaretPointerPending).toBeUndefined();
        const activeView =
          rendered.container.querySelector<HTMLElement>(".ProseMirror");
        if (!activeView) throw new Error("Missing active text projection");
        expectNativeCaret(editor, activeView, focusBlockId);
        expect(settlements).toHaveBeenCalledOnce();
        expect(changes).not.toHaveBeenCalled();

        for (let eventIndex = 0; eventIndex < 2; eventIndex += 1) {
          act(() => document.dispatchEvent(new Event("selectionchange")));
          expect(editor.selectionController.getCanonicalSnapshot()).toBe(
            authoritative,
          );
          expect(
            editor.selectionController.getCanonicalSnapshot().revision,
          ).toBe(authoritative.revision);
          expect(
            editor.selectionController.getPresentationSnapshot().settlement,
          ).toBe(settlement);
          expect(
            editor.selectionController.localPaint.getSnapshot(),
          ).toMatchObject({
            kind: "range",
            sourceRevision: authoritative.revision,
          });
          expect(
            rendered.container.querySelector("[data-editor-selection-paint]"),
          ).not.toBeNull();
          expectNativeCaret(editor, activeView, focusBlockId);
          expect(settlements).toHaveBeenCalledOnce();
          expect(changes).not.toHaveBeenCalled();
        }
        const canonicalFocus =
          authoritative.kind === "document"
            ? authoritative.snapshot.documentSelection.focus
            : null;
        const native = document.getSelection();
        if (!canonicalFocus || !native?.focusNode) {
          throw new Error("Missing projected canonical focus caret");
        }
        const runtimePort = editor as typeof editor & {
          acknowledgeTextActivation(
            blockId: BlockId,
            root: HTMLElement,
            canonicalOffset: number,
            nativeNode: Node,
            nativeOffset: number,
          ): boolean;
        };
        expect(
          runtimePort.acknowledgeTextActivation(
            focusBlockId,
            activeView,
            canonicalFocus.textOffset,
            native.focusNode,
            native.focusOffset,
          ),
        ).toBe(true);
        expect(list.dataset.editorNativeSelectionPaintMode).toBe(
          "hidden-for-global-selection",
        );
        expect(activeView.isConnected).toBe(true);
        expect(activeView.getAttribute("contenteditable")).toBe("true");
      } finally {
        if (originalClientRects) {
          Object.defineProperty(
            Range.prototype,
            "getClientRects",
            originalClientRects,
          );
        } else {
          Reflect.deleteProperty(Range.prototype, "getClientRects");
        }
        rendered.unmount();
        editor.dispose();
      }
    },
  );

  it("drags continuously through list wrappers without whole-block paint or extra input owners", () => {
    const snapshot = createListPointerSnapshot();
    const bootstrap = createFirstDraftBootstrapFromSnapshot({
      documentId: "list-pointer-runtime-document",
      revision: 0,
      snapshot,
    });
    const viewState = createFirstDraftViewStateStore();
    const editor = initializeEditableEditor({
      compiledDefinition: compileCanonicalEditorDefinition(
        createFirstDraftEditorDefinition(viewState),
      ),
      snapshot: bootstrap.snapshot,
      validatedSnapshot: bootstrap,
      onChange: vi.fn(),
      onChangeError: (error) => {
        throw error;
      },
      createTransactionId: () => crypto.randomUUID(),
    });
    const rendered = render(
      <FirstDraftViewStateProvider store={viewState}>
        <div data-editor-interaction-scope="true">
          <FirstDraftBlockHoverProvider enabled>
            <EditorDocument editor={editor} />
          </FirstDraftBlockHoverProvider>
        </div>
      </FirstDraftViewStateProvider>,
    );
    const list = rendered.container.querySelector<HTMLElement>(
      '[data-editor-block-list-root="true"]',
    );
    if (!list) throw new Error("Missing editor block list");
    Object.defineProperties(list, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    installListSelectionGeometry(rendered.container);
    const originalClientRects = Object.getOwnPropertyDescriptor(
      Range.prototype,
      "getClientRects",
    );
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: vi.fn(() => [selectionRectangle(40, 0, 120, 18)]),
    });

    try {
      const pointerId = 21;
      dispatchPointerDown(rendered.container, beforeList, pointerId, true);
      expectUniqueInputOwner(rendered.container, 0);

      dispatchPointerMoveTo(rendered.container, bulletItemA, pointerId, 10, 48);
      expect(list.dataset.editorNativeSelectionPaintMode).toBe(
        "hidden-for-global-selection",
      );
      expectNoListItemSurfacePaint(rendered.container);
      expectUniqueInputOwner(rendered.container, 0);

      dispatchPointerMoveTo(rendered.container, bulletTextA, pointerId, 50, 55);
      dispatchPointerMoveToElement(
        blockElement(rendered.container, bulletList),
        pointerId,
        10,
        82,
      );
      dispatchPointerMoveTo(
        rendered.container,
        bulletItemB,
        pointerId,
        10,
        100,
      );
      dispatchPointerMoveTo(
        rendered.container,
        bulletTextB,
        pointerId,
        50,
        108,
      );

      expect(list.dataset.editorNativeSelectionPaintMode).toBe(
        "hidden-for-global-selection",
      );
      expectNoListItemSurfacePaint(rendered.container);
      expectUniqueInputOwner(rendered.container, 0);

      dispatchPointerUpAt(rendered.container, afterList, pointerId, 50, 155);

      const committed = editor.selectionController.getCommittedSnapshot();
      expect(committed?.kind).toBe("document");
      expect(committed?.endpoints.anchor?.blockId).toBe(beforeList);
      expect(committed?.endpoints.head?.blockId).toBe(afterList);
      expect(
        [bulletList, bulletItemA, bulletItemB].includes(
          committed!.endpoints.anchor!.blockId,
        ),
      ).toBe(false);
      expect(
        [bulletList, bulletItemA, bulletItemB].includes(
          committed!.endpoints.head!.blockId,
        ),
      ).toBe(false);

      for (const wrapperId of [bulletList, bulletItemA, bulletItemB]) {
        expect(editor.readBlockSelectionModel(wrapperId)).toMatchObject({
          id: "wrapper",
          coverage: { selected: "none" },
          projection: { canStartSelection: false, selectable: false },
        });
        expect(
          committed?.blocks.find(({ blockId }) => blockId === wrapperId),
        ).toMatchObject({
          category: "wrapper",
          selectable: false,
          coverageResult: { modelId: "wrapper" },
        });
      }
      expect(
        committed?.blocks
          .filter(({ coverageResult }) => isContentPaint(coverageResult.paint))
          .map(({ blockId }) => blockId),
      ).toEqual([beforeList, bulletTextA, bulletTextB, afterList]);
      expectNoListItemSurfacePaint(rendered.container);
      expect(
        rendered.container.querySelector(
          `[data-editor-selection-paint="text-fragment"][data-editor-selection-paint-block-id="${bulletTextA}"]`,
        ),
      ).not.toBeNull();
      expect(
        rendered.container.querySelector(
          `[data-editor-selection-paint="text-fragment"][data-editor-selection-paint-block-id="${bulletTextB}"]`,
        ),
      ).not.toBeNull();
      expectUniqueInputOwner(rendered.container, 1);
      expect(
        rendered.container
          .querySelector<HTMLElement>('[data-editor-input-owner="true"]')
          ?.closest("[data-editor-block-id]")
          ?.getAttribute("data-editor-block-id"),
      ).toBe(afterList);

      const wrapperPadding = blockElement(rendered.container, bulletList);
      act(() =>
        wrapperPadding.dispatchEvent(pointerEvent("pointerdown", 22, 82, 10)),
      );
      expect(editor.selectionController.getCanonicalSnapshot()).toMatchObject({
        kind: "none",
      });
      expectNoListItemSurfacePaint(rendered.container);
      expect(editor.readBlockSelectionModel(bulletList)).toMatchObject({
        id: "wrapper",
        coverage: { selected: "none" },
        projection: { canStartSelection: false, selectable: false },
      });
    } finally {
      if (originalClientRects) {
        Object.defineProperty(
          Range.prototype,
          "getClientRects",
          originalClientRects,
        );
      } else {
        Reflect.deleteProperty(Range.prototype, "getClientRects");
      }
      rendered.unmount();
      editor.dispose();
    }
  });

  it("deletes a settled pointer range across list items without gesture content leases", () => {
    const bootstrap = createFirstDraftBootstrapFromSnapshot({
      documentId: "list-pointer-delete-document",
      revision: 0,
      snapshot: createListPointerSnapshot(),
    });
    const changes = vi.fn();
    const viewState = createFirstDraftViewStateStore();
    let runtime: YjsBlockContentRuntime | null = null;
    const definition = {
      ...createFirstDraftEditorDefinition(viewState),
      content: {
        createRuntime: (source) => {
          runtime = createYjsBlockContentRuntime(source);
          return runtime;
        },
      },
    } satisfies EditableEditorDefinition;
    const editor = initializeEditableEditor({
      compiledDefinition: compileCanonicalEditorDefinition(definition),
      snapshot: bootstrap.snapshot,
      validatedSnapshot: bootstrap,
      onChange: changes,
      onChangeError: (error) => {
        throw error;
      },
      createTransactionId: () => crypto.randomUUID(),
    });
    const rendered = render(
      <FirstDraftViewStateProvider store={viewState}>
        <div data-editor-interaction-scope="true">
          <FirstDraftBlockHoverProvider enabled>
            <EditorDocument editor={editor} />
          </FirstDraftBlockHoverProvider>
        </div>
      </FirstDraftViewStateProvider>,
    );
    const list = rendered.container.querySelector<HTMLElement>(
      '[data-editor-block-list-root="true"]',
    );
    if (!list) throw new Error("Missing pointer deletion runtime");
    const mountedRuntime = requireContentRuntime(runtime);
    Object.defineProperties(list, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    installListSelectionGeometry(rendered.container);
    const originalClientRects = Object.getOwnPropertyDescriptor(
      Range.prototype,
      "getClientRects",
    );
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: vi.fn(() => [selectionRectangle(40, 0, 120, 18)]),
    });

    try {
      const pointerId = 41;
      dispatchPointerDown(rendered.container, bulletTextA, pointerId, true);
      dispatchPointerMoveTo(
        rendered.container,
        bulletTextB,
        pointerId,
        70,
        108,
      );
      dispatchPointerUpAt(rendered.container, bulletTextB, pointerId, 70, 108);

      const committed = editor.selectionController.getCommittedSnapshot();
      expect(committed?.kind).toBe("document");
      expect(committed?.endpoints.anchor?.blockId).toBe(bulletTextA);
      expect(committed?.endpoints.head?.blockId).toBe(bulletTextB);
      expect(committed?.endpoints.anchor?.blockId).not.toBe(
        committed?.endpoints.head?.blockId,
      );
      expect(mountedRuntime.getLiveBlockContentCount()).toBe(1);
      const activeView =
        rendered.container.querySelector<HTMLElement>(".ProseMirror");
      if (!activeView) throw new Error("Missing active text projection");
      const deleteEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Delete",
      });

      allocations.plannerEvents = [];
      act(() => activeView.dispatchEvent(deleteEvent));

      expect(deleteEvent.defaultPrevented).toBe(true);
      expectCompletePlannerBatch();
      expect(editor.getBlock(bulletItemA)).toBeNull();
      expect(editor.getBlock(bulletTextA)).toBeNull();
      expect(editor.getChildBlockIds(bulletList)).toEqual([bulletItemB]);
      expect(changes).toHaveBeenCalledOnce();
      allocations.plannerEvents = [];
      expect(editor.undo()).toEqual({ status: "applied" });
      expectCompletePlannerBatch();
      expect(editor.getChildBlockIds(bulletList)).toEqual([
        bulletItemA,
        bulletItemB,
      ]);
      expect(editor.getBlock(bulletTextA)).not.toBeNull();
      allocations.plannerEvents = [];
      expect(editor.redo()).toEqual({ status: "applied" });
      expectCompletePlannerBatch();
      expect(editor.getChildBlockIds(bulletList)).toEqual([bulletItemB]);
    } finally {
      if (originalClientRects) {
        Object.defineProperty(
          Range.prototype,
          "getClientRects",
          originalClientRects,
        );
      } else {
        Reflect.deleteProperty(Range.prototype, "getClientRects");
      }
      rendered.unmount();
      editor.dispose();
    }
  });

  it("clears a cross-block canonical range and its paint from unclaimed editor whitespace exactly once", () => {
    const bootstrap = createFirstDraftBootstrapFromSnapshot({
      documentId: "unclaimed-pointer-clear-document",
      revision: 0,
      snapshot: createPointerSnapshot(),
    });
    const changes = vi.fn();
    const viewState = createFirstDraftViewStateStore();
    const editor = initializeEditableEditor({
      compiledDefinition: compileCanonicalEditorDefinition(
        createFirstDraftEditorDefinition(viewState),
      ),
      snapshot: bootstrap.snapshot,
      validatedSnapshot: bootstrap,
      onChange: changes,
      onChangeError: (error) => {
        throw error;
      },
      createTransactionId: () => crypto.randomUUID(),
    });
    const rendered = render(
      <FirstDraftViewStateProvider store={viewState}>
        <section data-editor-interaction-scope="true">
          <div data-testid="editor-whitespace" />
          <FirstDraftBlockHoverProvider enabled>
            <EditorDocument editor={editor} />
          </FirstDraftBlockHoverProvider>
        </section>
      </FirstDraftViewStateProvider>,
    );
    const implementation = editor;
    const list = rendered.container.querySelector<HTMLElement>(
      '[data-editor-block-list-root="true"]',
    );
    if (!list) throw new Error("Missing editor block list");
    Object.defineProperties(list, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    const blockBText = blockElement(
      rendered.container,
      blockB,
    ).querySelector<HTMLElement>('[data-editor-text-root="true"]');
    if (!blockBText) throw new Error("Missing second text root");
    installTestRect(blockBText);
    dispatchPointerDown(rendered.container, blockA, 30, true);
    dispatchPointerMoveToElement(blockBText, 30, 12, 12);
    dispatchPointerUp(rendered.container, blockB, 30);
    expect(
      implementation.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({ kind: "document" });
    expect(
      implementation.selectionController.localPaint.getSnapshot(),
    ).toMatchObject({ kind: "range" });
    const textRoot = blockElement(rendered.container, blockA).querySelector(
      '[data-editor-text-root="true"]',
    );
    if (!textRoot) throw new Error("Missing text root for native range");
    const nativeRange = document.createRange();
    nativeRange.selectNodeContents(textRoot);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(nativeRange);
    const publications = vi.fn();
    implementation.selectionController.subscribeStandaloneSettlements(
      publications,
    );
    const whitespace = rendered.getByTestId("editor-whitespace");

    act(() => {
      whitespace.dispatchEvent(pointerEvent("pointerdown", 31, 1));
      whitespace.dispatchEvent(pointerEvent("pointerdown", 32, 1));
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(
      implementation.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({ kind: "none" });
    expect(implementation.selectionController.localPaint.getSnapshot()).toEqual(
      {
        kind: "none",
      },
    );
    expect(
      rendered.container.querySelector("[data-editor-selection-paint]"),
    ).toBeNull();
    expect(document.getSelection()?.rangeCount).toBe(0);
    expect(publications).toHaveBeenCalledOnce();
    expect(changes).not.toHaveBeenCalled();
    rendered.unmount();
    editor.dispose();
  });

  it("reads current multi-block formatting from projections and hydrates only at captured-command execution", () => {
    const snapshot = createPointerSnapshot();
    const bootstrap = createFirstDraftBootstrapFromSnapshot({
      documentId: "selection-menu-runtime-document",
      revision: 0,
      snapshot,
    });
    allocations.yDocs = 0;
    const checkpointDecodes = vi.spyOn(globalThis, "atob");
    const acquisitions: Array<{
      readonly blockId: BlockId;
      readonly reason: string;
    }> = [];
    let runtime: YjsBlockContentRuntime | null = null;
    const changes = vi.fn();
    const viewState = createFirstDraftViewStateStore();
    const definition = {
      ...createFirstDraftEditorDefinition(viewState),
      content: {
        createRuntime: (source) => {
          const real = createYjsBlockContentRuntime(source);
          const instrumented: YjsBlockContentRuntime = {
            ...real,
            acquireBlockContent(blockId, blockType, reason) {
              acquisitions.push({ blockId, reason });
              return real.acquireBlockContent(blockId, blockType, reason);
            },
          };
          runtime = instrumented;
          return instrumented;
        },
      },
    } satisfies EditableEditorDefinition;
    const editor = initializeEditableEditor({
      compiledDefinition: compileCanonicalEditorDefinition(definition),
      snapshot: bootstrap.snapshot,
      validatedSnapshot: bootstrap,
      onChange: changes,
      onChangeError: (error) => {
        throw error;
      },
      createTransactionId: () => crypto.randomUUID(),
    });
    const rendered = render(
      <FirstDraftViewStateProvider store={viewState}>
        <div data-editor-interaction-scope="true">
          <FirstDraftBlockHoverProvider enabled>
            <EditorDocument
              editor={editor}
              renderDocumentLayers={() => (
                <FirstDraftSelectionMenu editor={editor} />
              )}
            />
          </FirstDraftBlockHoverProvider>
        </div>
      </FirstDraftViewStateProvider>,
    );
    const implementation = editor;
    const holdA = requireContentRuntime(runtime).acquireBlockContent(
      blockA,
      "paragraph",
      "canonical-transaction",
    );
    act(() => {
      const anchor = captureTextPoint(implementation, blockA, 1);
      const focus = captureTextPoint(implementation, blockB, 4);
      const settlement =
        implementation.selectionController.commitCanonicalSelection(
          { direction: "forward", anchor, focus },
          implementation,
          implementation.getSelectionGraphRevision(),
          {
            publication: { kind: "standalone-local" },
            cause: "programmatic-edit",
          },
          {
            resolveTextAnchor: (point) =>
              implementation.resolveSelectionTextAnchor(point),
          },
        );
      if (settlement.kind === "rejected")
        throw new Error("selection was rejected");
    });
    holdA.release();

    const baseline = {
      yDocs: allocations.yDocs,
      checkpointDecodes: checkpointDecodes.mock.calls.length,
      acquisitions: acquisitions.length,
    };
    const projectionReads = vi.spyOn(implementation, "readBlockContent");
    const firstRead = editor.readCurrentSelectionInlineMarkFormatStates({
      marks: ["strong", "em", "link"],
    });
    expect(projectionReads.mock.calls.map(([blockId]) => blockId)).toEqual([
      blockA,
      blockB,
    ]);
    projectionReads.mockClear();
    const secondRead = editor.readCurrentSelectionInlineMarkFormatStates({
      marks: ["strong", "em", "link"],
    });
    expect(projectionReads.mock.calls.map(([blockId]) => blockId)).toEqual([
      blockA,
      blockB,
    ]);
    expect(firstRead).toMatchObject({ ok: true, blockIds: [blockA, blockB] });
    expect(secondRead).toMatchObject({ ok: true, blockIds: [blockA, blockB] });
    expect({
      yDocs: allocations.yDocs,
      checkpointDecodes: checkpointDecodes.mock.calls.length,
      acquisitions: acquisitions.length,
    }).toEqual(baseline);
    expect(runtime!.getLiveBlockContentCount()).toBe(1);

    const viewBeforeUi =
      rendered.container.querySelector<HTMLElement>(".ProseMirror");
    const uiBaseline = {
      yDocs: allocations.yDocs,
      checkpointDecodes: checkpointDecodes.mock.calls.length,
      acquisitions: acquisitions.length,
    };
    fireEvent.click(rendered.getByLabelText("Link"));
    const url = rendered.getByLabelText("URL") as HTMLInputElement;
    expect(document.activeElement).toBe(url);
    fireEvent.change(url, { target: { value: "https://focus.example" } });
    expect(url.value).toBe("https://focus.example");
    const title = rendered.getByLabelText("Title (optional)");
    title.focus();
    fireEvent.change(title, {
      target: { value: "Focused" },
    });
    expect(document.activeElement).toBe(title);
    const target = rendered.getByLabelText("Target");
    target.focus();
    fireEvent.change(target, {
      target: { value: "_blank" },
    });
    expect(document.activeElement).toBe(target);
    fireEvent.click(rendered.getByText("Cancel"));
    expect(rendered.queryByLabelText("Edit link")).toBeNull();
    expect(rendered.container.querySelector(".ProseMirror")).toBe(viewBeforeUi);
    expect(runtime!.getLiveBlockContentCount()).toBe(1);
    expect({
      yDocs: allocations.yDocs,
      checkpointDecodes: checkpointDecodes.mock.calls.length,
      acquisitions: acquisitions.length,
    }).toEqual(uiBaseline);

    const canonical = editor.selection.getSnapshot();
    if (canonical.kind !== "document")
      throw new Error("selection was not committed");
    acquisitions.length = 0;
    const docsBeforeCommand = allocations.yDocs;
    const sharedView =
      rendered.container.querySelector<HTMLElement>(".ProseMirror");
    if (!sharedView) throw new Error("active EditorView was not mounted");
    expect(
      editor.formatSelectionInlineMark({
        selection: canonical.snapshot,
        markName: "strong",
        action: "add",
      }),
    ).toMatchObject({ ok: true, changed: true });
    expect(acquisitions).toEqual([
      { blockId: blockA, reason: "canonical-transaction" },
      { blockId: blockB, reason: "canonical-transaction" },
    ]);
    expect(allocations.yDocs - docsBeforeCommand).toBe(1);
    expect(changes).toHaveBeenCalledOnce();
    expect(runtime!.getLiveBlockContentCount()).toBe(1);
    expect(rendered.container.querySelector(".ProseMirror")).toBe(sharedView);
    expect(sharedView.querySelector("strong")?.textContent).toBe("Or t");
    rendered.unmount();
    expect(runtime!.getLiveBlockContentCount()).toBe(0);
    editor.dispose();
  });
});

function expectSinglePlannerBatch(blockId: BlockId): void {
  expectPlannerBatch([blockId]);
}

function expectPlannerBatch(blockIds: readonly BlockId[]): void {
  expect(allocations.plannerEvents).toEqual([
    ...blockIds.map((blockId) => `plan:${blockId}`),
    ...blockIds.map((blockId) => `apply:${blockId}`),
  ]);
}

function expectCompletePlannerBatch(): void {
  const plans = allocations.plannerEvents.filter((event) =>
    event.startsWith("plan:"),
  );
  const applies = allocations.plannerEvents.filter((event) =>
    event.startsWith("apply:"),
  );
  expect(applies).toEqual(
    plans.map((event) => event.replace(/^plan:/u, "apply:")),
  );
  expect(
    allocations.plannerEvents.findIndex((event) => event.startsWith("apply:")),
  ).toBe(plans.length === 0 ? -1 : plans.length);
}

function captureTextPoint(
  editor: EditorImplementation,
  blockId: BlockId,
  offset: number,
) {
  editor.focusText(blockId, { offset });
  const canonical = editor.selectionController.getCanonicalSnapshot();
  if (canonical.kind !== "document") throw new Error("text focus was rejected");
  const point = canonical.snapshot.documentSelection.focus;
  if (!point?.textAnchor)
    throw new Error("text focus did not create an anchor");
  return point;
}

function createPointerSnapshot(): EditorInstanceSnapshot {
  const source = createFirstDraftSnapshot();
  return {
    ...source,
    blocks: {
      [blockA]: source.blocks[blockA]!,
      [blockB]: source.blocks[blockB]!,
    },
    rootBlockIds: [blockA, blockB],
    childIdsByParentId: {},
    content: {
      [blockA]: source.content[blockA]!,
      [blockB]: source.content[blockB]!,
    },
    opaqueContentCheckpoints: {
      [blockA]: source.opaqueContentCheckpoints[blockA]!,
      [blockB]: source.opaqueContentCheckpoints[blockB]!,
    },
  };
}

function createListPointerSnapshot(): EditorInstanceSnapshot {
  const source = createFirstDraftSnapshot();
  const blocks = {
    [beforeList]: source.blocks[beforeList]!,
    [bulletList]: source.blocks[bulletList]!,
    [bulletItemA]: source.blocks[bulletItemA]!,
    [bulletTextA]: source.blocks[bulletTextA]!,
    [bulletItemB]: source.blocks[bulletItemB]!,
    [bulletTextB]: source.blocks[bulletTextB]!,
    [afterList]: source.blocks[afterList]!,
  };
  return {
    ...source,
    blocks,
    rootBlockIds: [beforeList, bulletList, afterList],
    childIdsByParentId: {
      [bulletList]: [bulletItemA, bulletItemB],
      [bulletItemA]: [bulletTextA],
      [bulletItemB]: [bulletTextB],
    },
    content: {
      [beforeList]: source.content[beforeList]!,
      [bulletTextA]: source.content[bulletTextA]!,
      [bulletTextB]: source.content[bulletTextB]!,
      [afterList]: source.content[afterList]!,
    },
    opaqueContentCheckpoints: {
      [beforeList]: source.opaqueContentCheckpoints[beforeList]!,
      [bulletTextA]: source.opaqueContentCheckpoints[bulletTextA]!,
      [bulletTextB]: source.opaqueContentCheckpoints[bulletTextB]!,
      [afterList]: source.opaqueContentCheckpoints[afterList]!,
    },
  };
}

function dispatchPointerClick(
  container: HTMLElement,
  blockId: BlockId,
  pointerId: number,
  atStart = false,
): void {
  dispatchPointerDown(container, blockId, pointerId, atStart);
  dispatchPointerUp(container, blockId, pointerId, atStart);
}

function dispatchPointerDown(
  container: HTMLElement,
  blockId: BlockId,
  pointerId: number,
  atStart = false,
): PointerEvent {
  const shell = container.querySelector<HTMLElement>(
    `[data-editor-block-shell="true"][data-editor-block-id="${blockId}"]`,
  );
  if (!shell) throw new Error(`Missing block shell ${blockId}`);
  const target =
    shell.querySelector<HTMLElement>('[data-editor-text-root="true"]') ?? shell;
  if (atStart) installTestRect(target);
  const event = pointerEvent("pointerdown", pointerId, atStart ? 0 : 10);
  act(() => target.dispatchEvent(event));
  return event;
}

function dispatchPointerUp(
  container: HTMLElement,
  blockId: BlockId,
  pointerId: number,
  atStart = false,
): void {
  const shell = container.querySelector<HTMLElement>(
    `[data-editor-block-shell="true"][data-editor-block-id="${blockId}"]`,
  );
  if (!shell) throw new Error(`Missing block shell ${blockId}`);
  const target =
    shell.querySelector<HTMLElement>('[data-editor-text-root="true"]') ?? shell;
  if (atStart) installTestRect(target);
  act(() =>
    target.dispatchEvent(
      pointerEvent("pointerup", pointerId, atStart ? 0 : 10),
    ),
  );
}

function dispatchPointerMoveTo(
  container: HTMLElement,
  blockId: BlockId,
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  dispatchPointerMoveToElement(
    blockElement(container, blockId),
    pointerId,
    clientX,
    clientY,
  );
}

function dispatchPointerMoveToElement(
  target: HTMLElement,
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  act(() =>
    target.dispatchEvent(
      pointerEvent("pointermove", pointerId, clientY, clientX),
    ),
  );
}

function dispatchPointerUpAt(
  container: HTMLElement,
  blockId: BlockId,
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  const shell = blockElement(container, blockId);
  const target =
    shell.querySelector<HTMLElement>('[data-editor-text-root="true"]') ?? shell;
  act(() =>
    target.dispatchEvent(
      pointerEvent("pointerup", pointerId, clientY, clientX),
    ),
  );
}

function blockElement(container: HTMLElement, blockId: BlockId): HTMLElement {
  const shell = container.querySelector<HTMLElement>(
    `[data-editor-block-shell="true"][data-editor-block-id="${blockId}"]`,
  );
  if (!shell) throw new Error(`Missing block shell ${blockId}`);
  return shell;
}

function pointerEvent(
  type: string,
  pointerId: number,
  clientY: number,
  clientX = 0,
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event as PointerEvent;
}

function installListSelectionGeometry(container: HTMLElement): void {
  const geometry = new Map<BlockId, DOMRect>([
    [beforeList, selectionRectangle(0, 0, 220, 20)],
    [bulletList, selectionRectangle(0, 30, 220, 110)],
    [bulletItemA, selectionRectangle(0, 35, 220, 40)],
    [bulletTextA, selectionRectangle(30, 42, 180, 22)],
    [bulletItemB, selectionRectangle(0, 90, 220, 40)],
    [bulletTextB, selectionRectangle(30, 97, 180, 22)],
    [afterList, selectionRectangle(0, 145, 220, 20)],
  ]);
  for (const [blockId, rect] of geometry) {
    const shell = blockElement(container, blockId);
    shell.getBoundingClientRect = () => rect;
    const textRoot = shell.querySelector<HTMLElement>(
      ':scope > [data-editor-text-root="true"], :scope > * [data-editor-text-root="true"]',
    );
    if (textRoot) textRoot.getBoundingClientRect = () => rect;
  }
  const list = container.querySelector<HTMLElement>(
    '[data-editor-block-list-root="true"]',
  );
  if (list)
    list.getBoundingClientRect = () => selectionRectangle(0, 0, 220, 170);
}

function selectionRectangle(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function expectNoListItemSurfacePaint(container: HTMLElement): void {
  for (const blockId of [bulletItemA, bulletItemB]) {
    expect(
      container.querySelector(
        `[data-editor-selection-paint="atomic-surface"][data-editor-selection-paint-block-id="${blockId}"]`,
      ),
    ).toBeNull();
  }
}

function expectUniqueInputOwner(
  container: HTMLElement,
  expectedCount: 0 | 1,
): void {
  expect(container.querySelectorAll(".ProseMirror")).toHaveLength(
    expectedCount,
  );
  expect(container.querySelectorAll('[contenteditable="true"]')).toHaveLength(
    expectedCount,
  );
  expect(
    container.querySelectorAll('[data-editor-input-owner="true"]'),
  ).toHaveLength(expectedCount);
}

function installTestRect(element: HTMLElement): void {
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 10,
    top: 10,
    right: 100,
    bottom: 30,
    left: 0,
    width: 100,
    height: 20,
    toJSON: () => ({}),
  });
}

function expectNativeCaret(
  editor: ReturnType<typeof initializeEditableEditor>,
  view: HTMLElement,
  blockId: BlockId,
): void {
  const selection = editor.selection.getSnapshot();
  expect(selection.kind).toBe("document");
  if (selection.kind !== "document")
    throw new Error("Missing document selection");
  const point = selection.snapshot.endpoints.head;
  expect(point?.blockId).toBe(blockId);
  expect(point?.textAnchor).not.toBeNull();
  expect(document.activeElement).toBe(view);
  const native = document.getSelection();
  expect(native?.isCollapsed).toBe(true);
  expect(native?.anchorNode && view.contains(native.anchorNode)).toBe(true);
  const prefix = document.createRange();
  prefix.setStart(view, 0);
  prefix.setEnd(native!.anchorNode!, native!.anchorOffset);
  expect(prefix.toString().length).toBe(point?.textOffset);
}

function requireContentRuntime(
  runtime: YjsBlockContentRuntime | null,
): YjsBlockContentRuntime {
  if (!runtime) throw new Error("Missing block content runtime");
  return runtime;
}

function isContentPaint(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "content"
  );
}
