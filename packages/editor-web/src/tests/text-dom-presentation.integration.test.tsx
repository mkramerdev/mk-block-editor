import { act, render, waitFor } from "@testing-library/react";
import { createElement, useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RichTextDocumentNodeJson,
  RichTextInlineNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { BlockId } from "@repo/editor-core/kernel";
import { blockTextCoordinateCodec } from "@repo/editor-dom/caret";
import { EditorView } from "@repo/editor-dom/prosemirror";
import type { BlockRendererProps } from "../document/blocks/block-renderer.tsx";
import { EditableTextBlockPrimitive } from "../document/blocks/editable-text-block-primitive.tsx";
import type { TextDomPresentation } from "../document/blocks/text-dom-presentation.ts";
import { createSemanticDomTextLayout } from "../document/geometry/semantic-dom-coordinates.ts";
import type { EditableEditor } from "../runtime/document/contracts.ts";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import type { EditableEditorRuntimePort } from "../runtime/document/render-port.ts";
import type { EditableEditorDefinition } from "../runtime/definition/contracts.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";
import {
  initializeTestEditableEditor,
  type TestEditableEditor,
} from "./test-editor-initializers.ts";

const semanticId = "semantic-alternate" as BlockId;
const paragraphId = "semantic-paragraph" as BlockId;

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

describe("renderer-owned text DOM presentation through the mounted runtime", () => {
  it("keeps inactive and active semantics, inline content, shells, and the one shared view in parity", async () => {
    const store = new PresentationStore({
      element: "h2",
      attributes: { "data-neutral-presentation": "two" },
    });
    const onChange = vi.fn();
    const editor = createSemanticEditor(store, onChange);
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    const shell = blockShell(rendered.container, semanticId);
    const host = textHost(rendered.container, semanticId);
    const projection = textProjection(host);
    const inactiveSemantic = requiredSemantic(projection, "h2");

    expectRichInlineContent(inactiveSemantic);
    expect(projection.hidden).toBe(false);
    expect(visibleTextRoots(host)).toEqual([projection]);
    expect(
      requiredSemantic(
        textProjection(textHost(rendered.container, paragraphId)),
        "p",
      ).getAttribute("data-block-node"),
    ).toBe("paragraph");

    activate(editor, semanticId, 4);
    await waitFor(() => expect(runtime.readActiveTextView()).not.toBeNull());
    const view = requiredView(runtime);
    const viewDom = view.dom;
    const activeSemantic = requiredSemantic(viewDom, "h2");
    expect(view.dom.parentElement).toBe(textSlot(host));
    expect(projection.hidden).toBe(true);
    expect(projection.getAttribute("aria-hidden")).toBe("true");
    expect(projection.hasAttribute("data-editor-text-root")).toBe(false);
    expect(visibleTextRoots(host)).toEqual([view.dom]);
    expectRichInlineContent(activeSemantic);
    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(rendered.container.querySelectorAll("[data-inline-atom-type='mention']"))
      .toHaveLength(2);

    const setProps = vi.spyOn(view, "setProps");
    const settlements = vi.fn();
    const unsubscribe = editor.selectionController.subscribeStandaloneSettlements(
      settlements,
    );
    onChange.mockClear();
    act(() =>
      store.set({
        element: "h2",
        attributes: { "data-neutral-presentation": "two" },
      }),
    );
    expect(requiredView(runtime)).toBe(view);
    expect(view.dom).toBe(viewDom);
    expect(requiredSemantic(view.dom, "h2")).toBe(activeSemantic);
    expect(setProps).not.toHaveBeenCalled();
    expect(settlements).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    act(() =>
      store.set({
        element: "h3",
        attributes: { "data-neutral-presentation": "three" },
      }),
    );
    expect(requiredView(runtime)).toBe(view);
    expect(view.dom).toBe(viewDom);
    expect(blockShell(rendered.container, semanticId)).toBe(shell);
    expect(textHost(rendered.container, semanticId)).toBe(host);
    expect(textProjection(host)).toBe(projection);
    const activeH3 = requiredSemantic(view.dom, "h3");
    expectRichInlineContent(activeH3);
    expect(view.dom.querySelector(":scope > h2, :scope > p[data-block-node]"))
      .toBeNull();
    expect(rendered.container.querySelectorAll("[data-inline-atom-type='mention']"))
      .toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
    expect(settlements).not.toHaveBeenCalled();

    activate(editor, paragraphId, 2);
    expect(requiredView(runtime)).toBe(view);
    expect(view.dom).toBe(viewDom);
    expect(view.dom.parentElement).toBe(textSlot(textHost(rendered.container, paragraphId)));
    expect(projection.hidden).toBe(false);
    expect(projection.getAttribute("aria-hidden")).toBeNull();
    expect(projection.dataset.editorTextRoot).toBe("true");
    expect(
      requiredSemantic(projection, "h3").getAttribute(
        "data-neutral-presentation",
      ),
    ).toBe("three");
    expect(visibleTextRoots(host)).toEqual([projection]);
    expect(blockShell(rendered.container, semanticId)).toBe(shell);
    expect(textHost(rendered.container, semanticId)).toBe(host);
    expect(textProjection(host)).toBe(projection);
    unsubscribe();
    rendered.unmount();
    editor.dispose();
  });

  it.each([
    { label: "forward", anchor: 2, head: 13 },
    { label: "backward", anchor: 13, head: 2 },
  ] as const)(
    "preserves a $label non-collapsed canonical and native range during a semantic update",
    ({ anchor, head }) => {
      const store = new PresentationStore({ element: "h2" });
      const onChange = vi.fn();
      const editor = createSemanticEditor(store, onChange);
      const runtime = editor as EditableEditorRuntimePort;
      const rendered = render(<EditorDocument editor={editor} />);
      activate(editor, semanticId, anchor);
      const view = requiredView(runtime);
      const viewDom = view.dom;
      act(() => {
        settleCanonicalRange(runtime, anchor, head);
        expect(runtime.projectActiveTextSelection(semanticId, anchor, head)).toBe(
          true,
        );
        expect(
          runtime.nativeSelectionSynchronization.reconcileTextSelection(
            semanticId,
            anchor,
            head,
          ),
        ).toBe(true);
      });
      const strong = view.state.schema.marks.strong?.create();
      expect(strong).toBeDefined();
      view.updateState(view.state.apply(view.state.tr.setStoredMarks([strong!])))
      const canonicalBefore = editor.selectionController.getCanonicalSnapshot();
      const storedMarksBefore = view.state.storedMarks?.map((mark) => mark.toJSON());
      expect(readProseMirrorRange(view)).toEqual({ anchor, head });
      expect(readNativeRange(view.dom)).toEqual({ anchor, head });
      expect(view.hasFocus()).toBe(true);
      const settlements = vi.fn();
      const unsubscribe = editor.selectionController.subscribeStandaloneSettlements(
        settlements,
      );
      onChange.mockClear();

      act(() => store.set({ element: "h3" }));

      expect(requiredView(runtime)).toBe(view);
      expect(view.dom).toBe(viewDom);
      expect(view.hasFocus()).toBe(true);
      expect(document.activeElement).toBe(view.dom);
      expect(readProseMirrorRange(view)).toEqual({ anchor, head });
      expect(readNativeRange(view.dom)).toEqual({ anchor, head });
      expect(editor.selectionController.getCanonicalSnapshot()).toEqual(
        canonicalBefore,
      );
      expect(view.state.storedMarks?.map((mark) => mark.toJSON())).toEqual(
        storedMarksBefore,
      );
      expect(settlements).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      expect(requiredSemantic(view.dom, "h3")).not.toBeNull();
      unsubscribe();
      rendered.unmount();
      editor.dispose();
    },
  );

  it("defers a mounted composition-event presentation update until composition settlement", async () => {
    const store = new PresentationStore({ element: "h2" });
    const onChange = vi.fn();
    const editor = createSemanticEditor(store, onChange);
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    activate(editor, semanticId, 7);
    const view = requiredView(runtime);
    const viewDom = view.dom;
    const h2 = requiredSemantic(view.dom, "h2");
    const setProps = vi.spyOn(view, "setProps");
    const canonicalBefore = editor.selectionController.getCanonicalSnapshot();
    const textBefore = runtime.readBlockPlainText(semanticId, "alternateTextBlock");

    act(() =>
      view.dom.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
      ),
    );
    expect(view.dom.dataset.editorCompositionPinned).toBe("true");
    act(() => store.set({ element: "h3" }));
    expect(requiredSemantic(view.dom, "h2")).toBe(h2);
    expect(view.dom.querySelector(":scope > h3")).toBeNull();
    expect(setProps).not.toHaveBeenCalled();

    await act(async () => {
      view.dom.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "" }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requiredView(runtime)).toBe(view);
    expect(view.dom).toBe(viewDom);
    expect(view.hasFocus()).toBe(true);
    expect(runtime.readBlockPlainText(semanticId, "alternateTextBlock")).toBe(
      textBefore,
    );
    expect(editor.selectionController.getCanonicalSnapshot()).toEqual(
      canonicalBefore,
    );
    expect(readProseMirrorRange(view)).toEqual({ anchor: 7, head: 7 });
    expect(readNativeRange(view.dom)).toEqual({ anchor: 7, head: 7 });
    expect(requiredSemantic(view.dom, "h3")).not.toBeNull();
    expect(setProps).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    rendered.unmount();
    editor.dispose();
  });

  it("isolates renderer presentations, registrations, focus, and selections across sibling editors", () => {
    const semanticA = "semantic-alternate-a" as BlockId;
    const paragraphA = "semantic-paragraph-a" as BlockId;
    const semanticB = "semantic-alternate-b" as BlockId;
    const paragraphB = "semantic-paragraph-b" as BlockId;
    const storeA = new PresentationStore({
      element: "h2",
      attributes: { "data-editor-instance": "a" },
    });
    const storeB = new PresentationStore({
      element: "blockquote",
      attributes: { "data-editor-instance": "b" },
    });
    const editorA = createSemanticEditor(
      storeA,
      vi.fn(),
      semanticA,
      paragraphA,
    );
    const editorB = createSemanticEditor(
      storeB,
      vi.fn(),
      semanticB,
      paragraphB,
    );
    const runtimeA = editorA as EditableEditorRuntimePort;
    const runtimeB = editorB as EditableEditorRuntimePort;
    const rendered = render(
      <div>
        <section data-testid="editor-a"><EditorDocument editor={editorA} /></section>
        <section data-testid="editor-b"><EditorDocument editor={editorB} /></section>
      </div>,
    );
    const rootA = rendered.getByTestId("editor-a");
    const rootB = rendered.getByTestId("editor-b");
    activate(editorA, semanticA, 3);
    const viewA = requiredView(runtimeA);
    const viewADom = viewA.dom;
    const inactiveSemanticB = requiredSemantic(
      textProjection(textHost(rootB, semanticB)),
      "blockquote",
    );
    expect(rootA.contains(viewA.dom)).toBe(true);
    act(() =>
      storeA.set({
        element: "h3",
        attributes: { "data-editor-instance": "a2" },
      }),
    );
    expect(requiredView(runtimeA)).toBe(viewA);
    expect(viewA.dom).toBe(viewADom);
    expect(requiredSemantic(viewA.dom, "h3").getAttribute("data-editor-instance"))
      .toBe("a2");
    expect(
      requiredSemantic(
        textProjection(textHost(rootB, semanticB)),
        "blockquote",
      ),
    ).toBe(inactiveSemanticB);

    activate(editorB, semanticB, 9);
    const viewB = requiredView(runtimeB);
    const viewBDom = viewB.dom;
    const semanticNodeB = requiredSemantic(viewB.dom, "blockquote");
    const selectionB = readProseMirrorRange(viewB);
    expect(viewA).not.toBe(viewB);
    expect(rootB.contains(viewB.dom)).toBe(true);
    expect(rootB.contains(viewA.dom)).toBe(false);
    expect(runtimeA.readActiveTextView()).toBeNull();
    expect(document.activeElement).toBe(viewB.dom);

    act(() => storeA.set({ element: "pre", attributes: { "data-editor-instance": "a3" } }));
    expect(
      requiredSemantic(
        textProjection(textHost(rootA, semanticA)),
        "pre",
      ).getAttribute("data-editor-instance"),
    ).toBe("a3");
    expect(requiredView(runtimeB)).toBe(viewB);
    expect(viewB.dom).toBe(viewBDom);
    expect(requiredSemantic(viewB.dom, "blockquote")).toBe(semanticNodeB);
    expect(
      requiredSemantic(viewB.dom, "blockquote").getAttribute(
        "data-editor-instance",
      ),
    ).toBe("b");
    expect(readProseMirrorRange(viewB)).toEqual(selectionB);
    expect(document.activeElement).toBe(viewB.dom);
    expect(rootA.querySelectorAll(".ProseMirror")).toHaveLength(0);
    expect(rootB.querySelectorAll(".ProseMirror")).toHaveLength(1);

    act(() =>
      storeB.set({
        element: "h3",
        attributes: { "data-editor-instance": "b2" },
      }),
    );
    expect(requiredView(runtimeB)).toBe(viewB);
    expect(viewB.dom).toBe(viewBDom);
    expect(requiredSemantic(viewB.dom, "h3").getAttribute("data-editor-instance"))
      .toBe("b2");
    expect(
      requiredSemantic(textProjection(textHost(rootA, semanticA)), "pre")
        .getAttribute("data-editor-instance"),
    ).toBe("a3");

    rendered.unmount();
    editorA.dispose();
    editorB.dispose();
  });
});

class PresentationStore {
  private listeners = new Set<() => void>();

  constructor(private value: TextDomPresentation) {}

  readonly getSnapshot = () => this.value;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(value: TextDomPresentation): void {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

function createSemanticEditor(
  store: PresentationStore,
  onChange = vi.fn(),
  semanticBlockId = semanticId,
  paragraphBlockId = paragraphId,
): TestEditableEditor {
  const definition: EditableEditorDefinition = {
    ...testEditableEditorDefinition,
    blocks: {
      ...testEditableEditorDefinition.blocks,
      alternateTextBlock: {
        ...testEditableEditorDefinition.blocks.alternateTextBlock!,
        renderer: createSemanticRenderer(store),
      },
    },
    inlineAtoms: [
      {
        type: "mention",
        metadata: { id: { type: "string", required: true } },
        render: (metadata) => <span>mention:{String(metadata.id)}</span>,
      },
    ],
  };
  return initializeTestEditableEditor({
    definition,
    onChange,
    snapshot: createTestEditorSnapshot([
      {
        id: semanticBlockId,
        type: "alternateTextBlock",
        content: documentContent([
          { type: "text", text: "Bold", marks: [{ type: "strong" }] },
          { type: "text", text: " and " },
          {
            type: "text",
            text: "linked",
            marks: [
              { type: "link", attrs: { href: "https://example.test" } },
            ],
          },
          { type: "hard_break" },
          { type: "mention", metadata: { id: "ada" } },
          { type: "text", text: " tail" },
        ]),
      },
      { id: paragraphBlockId, type: "textBlock", text: "ordinary paragraph" },
    ]),
  });
}

function createSemanticRenderer(store: PresentationStore) {
  return function SemanticRenderer({
    block,
    editor,
  }: BlockRendererProps<EditableEditor>) {
    const presentation = useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    );
    return createElement(EditableTextBlockPrimitive, {
      block,
      editor,
      placeholder: { text: "Neutral placeholder", visibility: "active" },
      textDomPresentation: presentation,
    });
  };
}

function documentContent(
  content: readonly RichTextInlineNodeJson[],
): RichTextDocumentNodeJson {
  return { type: "doc", content: [{ type: "paragraph", content: [...content] }] };
}

function activate(
  editor: EditableEditor,
  blockId: BlockId,
  offset: number,
): void {
  act(() => {
    expect(editor.focusText(blockId, { offset, preventScroll: true }).status)
      .not.toBe("rejected");
  });
}

function settleCanonicalRange(
  editor: EditableEditorRuntimePort,
  anchorOffset: number,
  focusOffset: number,
): void {
  const anchor = editor.createSelectionTextPoint(semanticId, anchorOffset);
  const focus = editor.createSelectionTextPoint(semanticId, focusOffset);
  if (!anchor || !focus) throw new Error("Expected live semantic selection points");
  const settled = editor.selectionController.extendSelection(
    anchor,
    focus,
    editor,
    editor.getSelectionGraphRevision(),
    { publication: { kind: "standalone-local" }, cause: "programmatic-edit" },
  );
  if (!settled) throw new Error("Expected the semantic range to settle");
}

function requiredView(runtime: EditableEditorRuntimePort): EditorView {
  const view = runtime.readActiveTextView();
  if (!view) throw new Error("Expected a mounted shared EditorView");
  return view;
}

function blockShell(container: HTMLElement, blockId: BlockId): HTMLElement {
  const shell = container.querySelector<HTMLElement>(
    `[data-editor-block-shell='true'][data-editor-block-id='${blockId}']`,
  );
  if (!shell) throw new Error(`Missing block shell ${blockId}`);
  return shell;
}

function textHost(container: HTMLElement, blockId: BlockId): HTMLElement {
  const host = blockShell(container, blockId).querySelector<HTMLElement>(
    ":scope > [data-editor-text-shell='true']",
  );
  if (!host) throw new Error(`Missing text host ${blockId}`);
  return host;
}

function textProjection(host: HTMLElement): HTMLElement {
  const projection = host.querySelector<HTMLElement>(
    ":scope > [data-editor-text-projection='true']",
  );
  if (!projection) throw new Error("Missing permanent projection");
  return projection;
}

function textSlot(host: HTMLElement): HTMLElement {
  const slot = host.querySelector<HTMLElement>(
    ":scope > [data-editor-text-slot='true']",
  );
  if (!slot) throw new Error("Missing text slot");
  return slot;
}

function requiredSemantic(root: HTMLElement, tagName: string): HTMLElement {
  const semantic = root.querySelector<HTMLElement>(
    `:scope > ${tagName}[data-block-node='paragraph']`,
  );
  if (!semantic) throw new Error(`Missing ${tagName} semantic text node`);
  return semantic;
}

function expectRichInlineContent(semantic: HTMLElement): void {
  expect(semantic.querySelector("strong")?.textContent).toBe("Bold");
  expect(semantic.querySelector("a[href='https://example.test']")?.textContent)
    .toBe("linked");
  expect(semantic.querySelector("br")).not.toBeNull();
  expect(semantic.querySelector("[data-inline-atom-type='mention']")?.textContent)
    .toBe("mention:ada");
}

function visibleTextRoots(host: HTMLElement): HTMLElement[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>(
      ":scope > [data-editor-text-projection='true'], :scope > [data-editor-text-slot='true'] > .ProseMirror",
    ),
  ).filter((element) => getComputedStyle(element).display !== "none");
}

function readProseMirrorRange(view: EditorView): {
  readonly anchor: number;
  readonly head: number;
} {
  return {
    anchor: blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
      view.state.selection.anchor,
      view.state,
    ),
    head: blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
      view.state.selection.head,
      view.state,
    ),
  };
}

function readNativeRange(root: HTMLElement): {
  readonly anchor: number;
  readonly head: number;
} {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) {
    throw new Error("Expected a native range inside the shared view");
  }
  const layout = createSemanticDomTextLayout(root);
  const anchor = layout.canonicalOffsetFromPoint(
      selection.anchorNode,
      selection.anchorOffset,
    );
  const head = layout.canonicalOffsetFromPoint(
      selection.focusNode,
      selection.focusOffset,
    );
  if (anchor === null || head === null) {
    throw new Error("Expected native range points to map to canonical text");
  }
  return { anchor, head };
}
