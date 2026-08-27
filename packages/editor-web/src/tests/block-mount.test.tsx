import { act, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StrictMode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { removeBlocks } from "@repo/editor-core/editing";
import { EditorView } from "@repo/editor-dom/prosemirror";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import { createSemanticDomTextLayout } from "../document/geometry/semantic-dom-coordinates.ts";
import type { EditableEditor } from "../runtime/document/contracts.ts";
import type { EditableEditorRuntimePort } from "../runtime/document/render-port.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";
import { initializeTestEditableEditor } from "./test-editor-initializers.ts";

const firstId = "shared-view-first" as BlockId;
const secondId = "shared-view-second" as BlockId;
const thirdId = "shared-view-third" as BlockId;
let editorStyles: HTMLStyleElement;

beforeAll(() => {
  editorStyles = document.createElement("style");
  editorStyles.textContent = readFileSync(
    join(process.cwd(), "src/styles/editor.css"),
    "utf8",
  );
  document.head.append(editorStyles);
});

afterAll(() => editorStyles.remove());

describe("shared document text editing runtime", () => {
  it("does not detach the active text host when sibling membership changes", async () => {
    const editor = createEditor();
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    activateText(editor, firstId, 2);
    await waitFor(() => expect(runtime.readActiveTextView()).not.toBeNull());
    const view = runtime.readActiveTextView()!;
    const activeDom = view.dom;
    const activeParent = activeDom.parentElement;

    act(() => {
      const result = runtime.executeStructuralTransaction({
        origin: "neutral-sibling-membership-change",
        operations: [
          removeBlocks({
            blockIds: [secondId],
            includeDescendants: true,
            expectedParents: { [secondId]: null },
          }),
        ],
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
    });

    expect(runtime.readActiveTextView()).toBe(view);
    expect(view.dom).toBe(activeDom);
    expect(activeDom.isConnected).toBe(true);
    expect(activeDom.parentElement).toBe(activeParent);
    expect(document.activeElement).toBe(activeDom);
    rendered.unmount();
    editor.dispose();
  });

  it("renders permanent projection and slot hosts without constructing a view", () => {
    const editor = createEditor();
    const rendered = render(<EditorDocument editor={editor} />);

    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(0);
    expect(
      rendered.container.querySelectorAll('[contenteditable="true"]'),
    ).toHaveLength(0);
    for (const blockId of [firstId, secondId, thirdId]) {
      const host = textHost(rendered.container, blockId);
      expect(textProjection(host).hidden).toBe(false);
      expect(textSlot(host).childNodes).toHaveLength(0);
    }
    expect(
      (editor as EditableEditorRuntimePort).readActiveTextView(),
    ).toBeNull();
    editor.dispose();
  });

  it("constructs one view on first activation and rehosts it through 100 blocks", async () => {
    const blockIds = Array.from(
      { length: 100 },
      (_, index) => `shared-view-${index}` as BlockId,
    );
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot(
        blockIds.map((id, index) => ({
          id,
          type: "textBlock",
          text: `block ${index}`,
        })),
      ),
    });
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    const shells = blockIds.map((id) => blockShell(rendered.container, id));
    const hosts = blockIds.map((id) => textHost(rendered.container, id));
    const projections = hosts.map(textProjection);
    const slots = hosts.map(textSlot);

    let sharedView: EditorView | null = null;
    for (let index = 0; index < blockIds.length; index += 1) {
      activateText(editor, blockIds[index]!, index % 3);
      await waitFor(() => expect(runtime.readActiveTextView()).not.toBeNull());
      sharedView ??= runtime.readActiveTextView();
      expect(runtime.readActiveTextView()).toBe(sharedView);
      expect(sharedView?.dom.parentElement).toBe(slots[index]);
      expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(
        1,
      );
      expect(
        rendered.container.querySelectorAll('[contenteditable="true"]'),
      ).toHaveLength(1);
    }

    expect(blockIds.map((id) => blockShell(rendered.container, id))).toEqual(
      shells,
    );
    expect(blockIds.map((id) => textHost(rendered.container, id))).toEqual(
      hosts,
    );
    expect(hosts.map(textProjection)).toEqual(projections);
    expect(hosts.map(textSlot)).toEqual(slots);
    editor.dispose();
    expect(sharedView?.isDestroyed).toBe(true);
  }, 10_000);

  it("moves the same DOM node and keeps inactive projections mounted and current", async () => {
    const editor = createEditor();
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    const firstHost = textHost(rendered.container, firstId);
    const secondHost = textHost(rendered.container, secondId);
    const firstProjection = textProjection(firstHost);
    const secondProjection = textProjection(secondHost);
    const firstSlot = textSlot(firstHost);
    const secondSlot = textSlot(secondHost);

    activateText(editor, firstId, 2);
    const view = runtime.readActiveTextView();
    expect(view).toBeInstanceOf(EditorView);
    expect(view?.dom.parentElement).toBe(firstSlot);
    expect(firstProjection.hidden).toBe(true);

    act(() => view?.dispatch(view.state.tr.insertText("X")));
    await waitFor(() =>
      expect(runtime.readBlockPlainText(firstId, "textBlock")).toBe("fiXrst"),
    );
    expect(firstProjection.textContent).toBe("fiXrst");

    activateText(editor, secondId, 1);
    expect(runtime.readActiveTextView()).toBe(view);
    expect(view?.dom.parentElement).toBe(secondSlot);
    expect(firstProjection.hidden).toBe(false);
    expect(secondProjection.hidden).toBe(true);
    expect(firstProjection.textContent).toBe("fiXrst");
    expect(firstSlot.childNodes).toHaveLength(0);
    editor.dispose();
  });

  it("uses the stylesheet to show exactly one text representation for the active block", () => {
    const editor = createEditor();
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    const firstHost = textHost(rendered.container, firstId);
    const secondHost = textHost(rendered.container, secondId);
    const firstProjection = textProjection(firstHost);
    const secondProjection = textProjection(secondHost);

    expect(getComputedStyle(firstProjection).display).toBe("block");
    expect(getComputedStyle(secondProjection).display).toBe("block");
    expect(visibleTextRepresentations(firstHost)).toHaveLength(1);
    expect(visibleTextRepresentations(secondHost)).toHaveLength(1);

    activateText(editor, firstId, 2);
    const view = runtime.readActiveTextView()!;
    expect(firstProjection.hidden).toBe(true);
    expect(getComputedStyle(firstProjection).display).toBe("none");
    expect(view.dom.hidden).toBe(false);
    expect(getComputedStyle(view.dom).display).not.toBe("none");
    expect(visibleTextRepresentations(firstHost)).toEqual([view.dom]);
    expect(visibleTextRepresentations(secondHost)).toEqual([secondProjection]);
    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(
      rendered.container.querySelectorAll('[contenteditable="true"]'),
    ).toHaveLength(1);

    activateText(editor, secondId, 1);
    expect(firstProjection.hidden).toBe(false);
    expect(getComputedStyle(firstProjection).display).toBe("block");
    expect(secondProjection.hidden).toBe(true);
    expect(getComputedStyle(secondProjection).display).toBe("none");
    expect(visibleTextRepresentations(firstHost)).toEqual([firstProjection]);
    expect(visibleTextRepresentations(secondHost)).toEqual([view.dom]);
    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(
      rendered.container.querySelectorAll('[contenteditable="true"]'),
    ).toHaveLength(1);
    editor.dispose();
  });

  it("notifies only the previous and next block activity subscribers", () => {
    const editor = createEditor();
    const runtime = editor as EditableEditorRuntimePort;
    render(<EditorDocument editor={editor} />);
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();
    const releases = [
      runtime.subscribeToTextBlockActivity(firstId, first),
      runtime.subscribeToTextBlockActivity(secondId, second),
      runtime.subscribeToTextBlockActivity(thirdId, third),
    ];

    activateText(editor, firstId, 0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(third).not.toHaveBeenCalled();
    first.mockClear();

    activateText(editor, secondId, 0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).not.toHaveBeenCalled();
    for (const release of releases) release();
    editor.dispose();
  });

  it("keeps a shared view stable across local content and metadata publications", async () => {
    const editor = createEditor();
    const runtime = editor as EditableEditorRuntimePort;
    render(<EditorDocument editor={editor} />);
    activateText(editor, firstId, 2);
    const view = runtime.readActiveTextView()!;
    const stateBeforeMetadata = view.state;

    act(() => view.dispatch(view.state.tr.insertText("!")));
    await waitFor(() =>
      expect(runtime.readBlockPlainText(firstId, "textBlock")).toBe("fi!rst"),
    );
    expect(runtime.readActiveTextView()).toBe(view);

    act(() => {
      expect(
        editor.updateBlockMetadata([
          { blockId: firstId, values: { stable: true } },
        ]),
      ).toBe(true);
    });
    expect(runtime.readActiveTextView()).toBe(view);
    expect(view.isDestroyed).toBe(false);
    expect(view.state).not.toBe(stateBeforeMetadata);
    editor.dispose();
  });

  it("rejects stale presentation without constructing a view", () => {
    const editor = createEditor();
    const runtime = editor as EditableEditorRuntimePort;
    render(<EditorDocument editor={editor} />);
    const revision =
      runtime.selectionController.getCanonicalSnapshot().revision;
    expect(
      runtime.requestTextPresentation(firstId, {
        offset: 0,
        canonicalSelectionRevision: revision - 1,
      }),
    ).toBe(false);
    expect(runtime.readActiveTextView()).toBeNull();
    editor.dispose();
  });

  it("rejects text hosted by a semantically hidden ancestor", () => {
    const editor = createEditor();
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    rendered.container.hidden = true;

    expect(editor.focusText(firstId, { offset: 0 }).status).toBe("rejected");

    expect(runtime.readActiveTextView()).toBeNull();
    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(0);
    editor.dispose();
  });

  it("rejects text beneath an arbitrary CSS-hidden ancestor and recovers when visible", () => {
    const style = document.createElement("style");
    style.textContent = ".hidden-by-product-css { display: none; }";
    document.head.append(style);
    const editor = createEditor();
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    const hiddenAncestor = document.createElement("div");
    hiddenAncestor.className = "hidden-by-product-css";
    const shell = blockShell(rendered.container, firstId);
    shell.before(hiddenAncestor);
    hiddenAncestor.append(shell);

    expect(getComputedStyle(hiddenAncestor).display).toBe("none");
    expect(editor.focusText(firstId, { offset: 0 }).status).toBe("rejected");
    expect(runtime.readActiveTextView()).toBeNull();

    hiddenAncestor.before(shell);
    expect(editor.focusText(firstId, { offset: 0 }).status).not.toBe("rejected");
    expect(runtime.readActiveTextView()).not.toBeNull();

    style.remove();
    editor.dispose();
  });

  it("treats an acknowledged same-revision text presentation as idempotent", () => {
    const editor = createEditor();
    const runtime = editor as EditableEditorRuntimePort;
    render(<EditorDocument editor={editor} />);
    activateText(editor, firstId, 2);
    const view = runtime.readActiveTextView();
    if (!view) throw new Error("missing active shared view");
    const native = document.getSelection();
    if (!native) throw new Error("missing browser selection");
    const setBaseAndExtent = vi.spyOn(native, "setBaseAndExtent");
    const canonical = runtime.selectionController.getCanonicalSnapshot();
    if (canonical.kind !== "document") {
      throw new Error("missing canonical text selection");
    }

    expect(
      runtime.requestTextPresentation(firstId, {
        offset: 2,
        canonicalSelectionRevision: canonical.revision,
      }),
    ).toBe(true);
    expect(setBaseAndExtent).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(view.dom);

    const start = createSemanticDomTextLayout(
      view.dom,
    ).pointFromCanonicalOffset(0);
    if (!start) throw new Error("missing native start point");
    native.setBaseAndExtent(start.node, start.offset, start.node, start.offset);
    setBaseAndExtent.mockClear();
    expect(
      runtime.requestTextPresentation(firstId, {
        offset: 2,
        canonicalSelectionRevision: canonical.revision,
      }),
    ).toBe(true);
    expect(setBaseAndExtent).toHaveBeenCalled();
    expectNativeCaretOffset(view, 2);
    editor.dispose();
  });

  it("keeps an inactive editable document free of views and editable roots", () => {
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: snapshot(),
    });
    const rendered = render(
      <EditorDocument editor={editor} interactionEnabled={false} />,
    );
    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(0);
    expect(
      rendered.container.querySelectorAll('[contenteditable="true"]'),
    ).toHaveLength(0);
    expect(rendered.container.textContent).toContain("first");
    editor.dispose();
  });

  it("survives the Strict Mode host registration probe without duplicating the view", async () => {
    const editor = createEditor();
    expect(editor.focusText(firstId, { offset: 2 }).status).not.toBe(
      "rejected",
    );
    const rendered = render(
      <StrictMode>
        <EditorDocument editor={editor} />
      </StrictMode>,
    );
    const runtime = editor as EditableEditorRuntimePort;
    await waitFor(() => expect(runtime.readActiveTextView()).not.toBeNull());
    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(
      rendered.container.querySelectorAll('[contenteditable="true"]'),
    ).toHaveLength(1);
    editor.dispose();
  });

  it("releases the active editing lease and destroys the view exactly once", () => {
    const editor = createEditor();
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    activateText(editor, firstId, 1);
    const view = runtime.readActiveTextView()!;
    const destroy = vi.spyOn(view, "destroy");
    rendered.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(view.isDestroyed).toBe(true);
    editor.dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

function createEditor(): EditableEditor {
  return initializeTestEditableEditor({
    definition: testEditableEditorDefinition,
    snapshot: snapshot(),
  });
}

function snapshot() {
  return createTestEditorSnapshot([
    { id: firstId, type: "textBlock", text: "first" },
    { id: secondId, type: "textBlock", text: "second" },
    { id: thirdId, type: "textBlock", text: "third" },
  ]);
}

function activateText(
  editor: EditableEditor,
  blockId: BlockId,
  offset: number,
): void {
  act(() => {
    expect(editor.focusText(blockId, { offset }).status).not.toBe("rejected");
  });
}

function blockShell(container: HTMLElement, blockId: BlockId): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-editor-block-shell="true"][data-editor-block-id="${blockId}"]`,
  );
  if (!element) throw new Error(`missing block shell ${blockId}`);
  return element;
}

function textHost(container: HTMLElement, blockId: BlockId): HTMLElement {
  const element = blockShell(container, blockId).querySelector<HTMLElement>(
    ":scope > [data-editor-text-shell='true']",
  );
  if (!element) throw new Error(`missing text host ${blockId}`);
  return element;
}

function textProjection(host: HTMLElement): HTMLElement {
  const element = host.querySelector<HTMLElement>(
    ":scope > [data-editor-text-projection='true']",
  );
  if (!element) throw new Error("missing canonical projection");
  return element;
}

function textSlot(host: HTMLElement): HTMLElement {
  const element = host.querySelector<HTMLElement>(
    ":scope > [data-editor-text-slot='true']",
  );
  if (!element) throw new Error("missing shared view slot");
  return element;
}

function visibleTextRepresentations(host: HTMLElement): HTMLElement[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>(
      ":scope > [data-editor-text-projection='true'], :scope > [data-editor-text-slot='true'] > .ProseMirror",
    ),
  ).filter((element) => getComputedStyle(element).display !== "none");
}

function expectNativeCaretOffset(view: EditorView, offset: number): void {
  const native = document.getSelection();
  expect(native?.isCollapsed).toBe(true);
  expect(native?.focusNode && view.dom.contains(native.focusNode)).toBe(true);
  if (native?.focusNode) {
    expect(
      createSemanticDomTextLayout(view.dom).canonicalOffsetFromPoint(
        native.focusNode,
        native.focusOffset,
      ),
    ).toBe(offset);
  }
}
