import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import type { BlockId } from "@repo/editor-core/kernel";
import { EditorDocument } from "@repo/editor-web/document-runtime";
import { compileCanonicalEditorDefinition } from "@repo/editor-web/editor-definition";
import {
  initializeEditableEditor,
  type EditableEditorDefinition,
} from "@repo/editor-web/editor";
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
import { createFirstDraftBootstrapFromSnapshot } from "./read-model/bootstrap.ts";
import { FirstDraftSelectionMenu } from "./selection-menu/index.ts";

const allocations = vi.hoisted(() => ({
  yDocs: 0,
}));

vi.mock("@repo/editor-yjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/editor-yjs")>();
  class InstrumentedDoc extends actual.Doc {
    constructor(options?: ConstructorParameters<typeof actual.Doc>[0]) {
      super(options);
      allocations.yDocs += 1;
    }
  }
  return { ...actual, Doc: InstrumentedDoc, YDoc: InstrumentedDoc };
});

const blockA = "fd-paragraph-intro" as BlockId;
const blockB = "fd-paragraph-byline" as BlockId;

describe("First Draft real pointer activation allocation contract", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
    const sharedEditorView = rendered.container.querySelector<HTMLElement>(
      ".ProseMirror",
    )!;
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

  it("reads current multi-block formatting from projections and hydrates only at captured-command execution", () => {
    const snapshot = createPointerSnapshot();
    const bootstrap = createFirstDraftBootstrapFromSnapshot({
      documentId: "selection-menu-runtime-document",
      revision: 0,
      snapshot,
    });
    allocations.yDocs = 0;
    const checkpointDecodes = vi.spyOn(globalThis, "atob");
    const acquisitions: Array<{ readonly blockId: BlockId; readonly reason: string }> = [];
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
    const implementation = editor as unknown as EditorImplementation;
    const holdA = runtime!.acquireBlockContent(blockA, "paragraph", "canonical-transaction");
    act(() => {
      const anchor = captureTextPoint(implementation, blockA, 1);
      const focus = captureTextPoint(implementation, blockB, 4);
      const settlement = implementation.selectionController.commitCanonicalSelection(
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
        throw new Error(`selection was rejected: ${settlement.reason}`);
    });
    holdA.release();

    const baseline = {
      yDocs: allocations.yDocs,
      checkpointDecodes: checkpointDecodes.mock.calls.length,
      acquisitions: acquisitions.length,
    };
    const projectionReads = vi.spyOn(
      implementation as unknown as {
        readBlockContent(blockId: BlockId, blockType: string): unknown;
      },
      "readBlockContent",
    );
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

    const viewBeforeUi = rendered.container.querySelector<HTMLElement>(".ProseMirror");
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
    if (canonical.kind !== "document") throw new Error("selection was not committed");
    acquisitions.length = 0;
    const docsBeforeCommand = allocations.yDocs;
    const sharedView = rendered.container.querySelector<HTMLElement>(".ProseMirror");
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
    expect(sharedView.querySelector("strong")?.textContent).toBe("Prep");
    rendered.unmount();
    expect(runtime!.getLiveBlockContentCount()).toBe(0);
    editor.dispose();
  });
});

function captureTextPoint(
  editor: EditorImplementation,
  blockId: BlockId,
  offset: number,
) {
  editor.focusText(blockId, { offset });
  const canonical = editor.selectionController.getCanonicalSnapshot();
  if (canonical.kind !== "document") throw new Error("text focus was rejected");
  const point = canonical.snapshot.documentSelection.focus;
  if (!point?.textAnchor) throw new Error("text focus did not create an anchor");
  return point;
}

function createPointerSnapshot(): EditorInstanceSnapshot {
  const source = createFirstDraftSnapshot();
  return {
    ...source,
    blocks: Object.freeze({
      [blockA]: source.blocks[blockA]!,
      [blockB]: source.blocks[blockB]!,
    }),
    rootBlockIds: Object.freeze([blockA, blockB]),
    childIdsByParentId: Object.freeze({}),
    content: Object.freeze({
      [blockA]: source.content[blockA]!,
      [blockB]: source.content[blockB]!,
    }),
    opaqueContentCheckpoints: Object.freeze({
      [blockA]: source.opaqueContentCheckpoints[blockA]!,
      [blockB]: source.opaqueContentCheckpoints[blockB]!,
    }),
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
    target.dispatchEvent(pointerEvent("pointerup", pointerId, atStart ? 0 : 10)),
  );
}

function pointerEvent(
  type: string,
  pointerId: number,
  clientY: number,
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 0,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event as PointerEvent;
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
  if (selection.kind !== "document") throw new Error("Missing document selection");
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
