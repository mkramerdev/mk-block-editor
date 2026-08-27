import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  RichTextDocumentNodeJson,
  RichTextInlineNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { VersionedBlock } from "@repo/editor-core/document";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import type { EditableEditorDefinition } from "../definition/contracts.ts";
import type { EditableEditorRuntimePort } from "./render-port.ts";
import { InlineAtomPortalHost } from "../content/inline-atom-portal-registry.tsx";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { initializeTestEditableEditor } from "../../tests/test-editor-initializers.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import {
  SharedTextEditor,
  type SharedTextEditorHost,
} from "./shared-text-editor.ts";
import {
  defaultTextDomPresentation,
  resolveTextDomPresentation,
  type TextDomPresentation,
} from "../../document/blocks/text-dom-presentation.ts";

const firstParagraphId = asBlockId("realm-first-textBlock");
const alternateTextId = asBlockId("realm-alternate-text");
const atomParagraphId = asBlockId("realm-atom-textBlock");
const finalParagraphId = asBlockId("realm-final-textBlock");

describe("the movable shared text EditorView", () => {
  it("consumes unhandled structural Enter without creating a private textBlock and leaves composition native-owned", () => {
    const editor = createRealmEditor();
    const shared = new SharedTextEditor(editor);
    const host = createHost(document, firstParagraphId);
    try {
      act(() => activate(shared, editor.getBlock(firstParagraphId), host));
      const view = requiredView(shared);
      expect(view.state.doc.childCount).toBe(1);

      const enter = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      act(() => view.dom.dispatchEvent(enter));
      expect(enter.defaultPrevented).toBe(true);
      expect(view.state.doc.childCount).toBe(1);
      expect(editor.getRootBlockIds()).toHaveLength(4);

      const composingEnter = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(composingEnter, "isComposing", { value: true });
      act(() => view.dom.dispatchEvent(composingEnter));
      expect(view.state.doc.childCount).toBe(1);
      expect(editor.getRootBlockIds()).toHaveLength(4);
    } finally {
      shared.destroy();
      editor.dispose();
      host.shell.remove();
    }
  });

  it("reuses one view while rebuilding node views in each active document realm", () => {
    const realmA = document;
    const realmB = document.implementation.createHTMLDocument("realm-b");
    const editor = createRealmEditor();
    const portals = render(
      <InlineAtomPortalHost
        registry={editor.contentResources.inlineAtomPortals}
      />,
    );
    const shared = new SharedTextEditor(editor);
    const hostA = createHost(realmA, firstParagraphId);
    const alternateHostB = createHost(realmB, alternateTextId);
    const atomHostB = createHost(realmB, atomParagraphId);
    const finalHostA = createHost(realmA, finalParagraphId);

    try {
      act(() => activate(shared, editor.getBlock(firstParagraphId), hostA));
      const view = requiredView(shared);
      assertActiveRealm(view, realmA, realmA, [realmA, realmB]);
      expect(hostA.projection.hidden).toBe(true);
      expect(shared.readPlainText()).toBe("First realm");

      act(() =>
        activate(shared, editor.getBlock(alternateTextId), alternateHostB),
      );
      expect(requiredView(shared)).toBe(view);
      assertActiveRealm(view, realmB, realmB, [realmA, realmB]);
      expect(hostA.projection.hidden).toBe(false);
      expect(alternateHostB.projection.hidden).toBe(true);
      const textNode = view.dom.querySelector("p");
      const hardBreak = view.dom.querySelector("br");
      expect(textNode?.ownerDocument).toBe(realmB);
      expect(hardBreak?.ownerDocument).toBe(realmB);
      expect(shared.readPlainText()).toBe("Alternate text\nline");

      act(() => activate(shared, editor.getBlock(atomParagraphId), atomHostB));
      expect(requiredView(shared)).toBe(view);
      assertActiveRealm(view, realmB, realmB, [realmA, realmB]);
      expect(alternateHostB.projection.hidden).toBe(false);
      expect(atomHostB.projection.hidden).toBe(true);
      const atom = view.dom.querySelector("[data-inline-atom-type='mention']");
      expect(atom?.ownerDocument).toBe(realmB);
      expect(atom?.textContent).toBe("mention:ada");
      expect(shared.readPlainText()).toBe("Hello \n!");

      act(() =>
        activate(shared, editor.getBlock(finalParagraphId), finalHostA),
      );
      expect(requiredView(shared)).toBe(view);
      assertActiveRealm(view, realmA, realmA, [realmA, realmB]);
      expect(atomHostB.projection.hidden).toBe(false);
      expect(finalHostA.projection.hidden).toBe(true);
      expect(shared.readPlainText()).toBe("Final realm");

      act(() => view.dispatch(view.state.tr.insertText("!", 1)));
      expect(shared.readPlainText()).toBe("!Final realm");
      expect(editor.readBlockPlainText(finalParagraphId, "textBlock")).toBe(
        "!Final realm",
      );
    } finally {
      act(() => shared.destroy());
      portals.unmount();
      editor.dispose();
      hostA.shell.remove();
      alternateHostB.shell.remove();
      atomHostB.shell.remove();
      finalHostA.shell.remove();
    }
  });

  it("updates the shared view root after moving into a shadow root", () => {
    const editor = createRealmEditor();
    const shared = new SharedTextEditor(editor);
    const documentHost = createHost(document, firstParagraphId);
    const shadowContainer = document.createElement("div");
    const shadowRoot = shadowContainer.attachShadow({ mode: "open" });
    document.body.append(shadowContainer);
    const shadowHost = createHost(document, alternateTextId, shadowRoot);

    try {
      act(() =>
        activate(shared, editor.getBlock(firstParagraphId), documentHost),
      );
      const view = requiredView(shared);
      expect(view.root).toBe(document);

      act(() =>
        activate(shared, editor.getBlock(alternateTextId), shadowHost),
      );
      expect(requiredView(shared)).toBe(view);
      expect(view.root).toBe(shadowRoot);
      expect(view.dom.ownerDocument).toBe(shadowRoot.ownerDocument);
      expect(view.dom.querySelector("p")?.ownerDocument).toBe(
        shadowRoot.ownerDocument,
      );
      expect(view.dom.querySelector("br")?.ownerDocument).toBe(
        shadowRoot.ownerDocument,
      );
      expect(shadowRoot.querySelectorAll(".ProseMirror")).toHaveLength(1);
    } finally {
      shared.destroy();
      editor.dispose();
      documentHost.shell.remove();
      shadowContainer.remove();
    }
  });

  it("uses host semantic DOM and updates it without replacing focus, selection, or the shared view", () => {
    const editor = createRealmEditor();
    const shared = new SharedTextEditor(editor);
    const host = createHost(document, alternateTextId, document.body, {
      element: "h2",
      attributes: { "data-neutral-presentation": "two" },
    });
    try {
      act(() => activate(shared, editor.getBlock(alternateTextId), host));
      const view = requiredView(shared);
      const viewDom = view.dom;
      const shell = host.shell;
      const slot = host.slot;
      expect(
        view.dom.querySelector(
          "h2[data-block-node='paragraph'][data-neutral-presentation='two']",
        ),
      ).not.toBeNull();
      expect(view.dom.querySelector("p[data-block-node]")).toBeNull();
      expect(view.dom.querySelector("h2 strong")?.textContent).toBe(
        "Alternate",
      );
      expect(view.dom.querySelector("h2 a")?.textContent).toBe(" text");
      expect(view.dom.querySelector("h2 br")).not.toBeNull();

      expect(shared.reconcileNativeSelectionRange(5, 5)).toBe(true);
      const nativeBefore = document.getSelection();
      expect(document.activeElement).toBe(view.dom);
      expect(shared.readSelectionOffset()).toBe(5);
      expect(nativeBefore?.isCollapsed).toBe(true);

      const updatedHost: SharedTextEditorHost = {
        ...host,
        textDomPresentation: resolveTextDomPresentation({
          element: "h3",
          attributes: { "data-neutral-presentation": "three" },
        }),
      };
      act(() => shared.updateHostOptions(updatedHost));

      expect(requiredView(shared)).toBe(view);
      expect(view.dom).toBe(viewDom);
      expect(host.shell).toBe(shell);
      expect(host.slot).toBe(slot);
      expect(document.activeElement).toBe(view.dom);
      expect(shared.readSelectionOffset()).toBe(5);
      expect(document.getSelection()?.focusNode?.parentElement?.closest("h3"))
        .not.toBeNull();
      expect(
        view.dom.querySelector(
          "h3[data-block-node='paragraph'][data-neutral-presentation='three']",
        ),
      ).not.toBeNull();
      expect(view.dom.querySelector("h2, p[data-block-node]")).toBeNull();

      shared.setCompositionPinned(true);
      act(() =>
        shared.updateHostOptions({
          ...updatedHost,
          textDomPresentation: resolveTextDomPresentation({
            element: "h1",
            attributes: { "data-neutral-presentation": "one" },
          }),
        }),
      );
      expect(view.dom.querySelector(":scope > h3")).not.toBeNull();
      expect(requiredView(shared)).toBe(view);
      shared.setCompositionPinned(false);
      expect(
        view.dom.querySelector(
          "h1[data-block-node='paragraph'][data-neutral-presentation='one']",
        ),
      ).not.toBeNull();
      expect(requiredView(shared)).toBe(view);
      expect(document.activeElement).toBe(view.dom);
      expect(shared.readSelectionOffset()).toBe(5);
    } finally {
      shared.destroy();
      editor.dispose();
      host.shell.remove();
    }
  });
});

function createRealmEditor(): EditableEditorRuntimePort {
  const definition: EditableEditorDefinition = {
    ...testEditableEditorDefinition,
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
    snapshot: createTestEditorSnapshot([
      { id: firstParagraphId, type: "textBlock", text: "First realm" },
      {
        id: alternateTextId,
        type: "alternateTextBlock",
        metadata: { level: 2 },
        content: documentContent([
          { type: "text", text: "Alternate", marks: [{ type: "strong" }] },
          {
            type: "text",
            text: " text",
            marks: [
              { type: "link", attrs: { href: "https://example.test" } },
            ],
          },
          { type: "hard_break" },
          { type: "text", text: "line" },
        ]),
      },
      {
        id: atomParagraphId,
        type: "textBlock",
        content: documentContent([
          { type: "text", text: "Hello " },
          { type: "mention", metadata: { id: "ada" } },
          { type: "text", text: "!" },
        ]),
      },
      { id: finalParagraphId, type: "textBlock", text: "Final realm" },
    ]),
  }) as unknown as EditableEditorRuntimePort;
}

function documentContent(
  content: readonly RichTextInlineNodeJson[],
): RichTextDocumentNodeJson {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [...content] }],
  };
}

function createHost(
  ownerDocument: Document,
  blockId: BlockId,
  root: HTMLElement | ShadowRoot = ownerDocument.body,
  textDomPresentation?: TextDomPresentation,
): SharedTextEditorHost {
  const shell = ownerDocument.createElement("div");
  const projection = ownerDocument.createElement("div");
  const slot = ownerDocument.createElement("div");
  projection.dataset.editorTextRoot = "true";
  projection.textContent = `projection:${blockId}`;
  shell.append(projection, slot);
  root.append(shell);
  return {
    blockId,
    shell,
    projection,
    slot,
    projectionIdentity: Symbol(`projection:${blockId}`),
    className: "realm-shared-editor",
    textDomPresentation: textDomPresentation
      ? resolveTextDomPresentation(textDomPresentation)
      : defaultTextDomPresentation,
  };
}

function activate(
  shared: SharedTextEditor,
  block: VersionedBlock | null,
  host: SharedTextEditorHost,
): void {
  if (!block) throw new Error(`Missing test block ${host.blockId}`);
  shared.activate(block, host, {
    blockId: block.id,
    canonicalSelectionRevision: 0,
    canonicalTextOffset: 0,
    affinity: null,
    preventScroll: true,
    identity: Symbol(`activation:${block.id}`),
    projectionIdentity: host.projectionIdentity,
    focusMode: "acquire",
  });
}

function requiredView(shared: SharedTextEditor) {
  const view = shared.readView();
  if (!view) throw new Error("Expected the shared EditorView");
  return view;
}

function assertActiveRealm(
  view: ReturnType<typeof requiredView>,
  ownerDocument: Document,
  root: Document | ShadowRoot,
  documents: readonly Document[],
): void {
  expect(view.dom.ownerDocument).toBe(ownerDocument);
  expect(view.root).toBe(root);
  expect(countAcrossDocuments(documents, ".ProseMirror")).toBe(1);
  expect(countAcrossDocuments(documents, '[contenteditable="true"]')).toBe(1);
  expect(
    countAcrossDocuments(documents, '[data-editor-input-owner="true"]'),
  ).toBe(1);
}

function countAcrossDocuments(
  documents: readonly Document[],
  selector: string,
): number {
  return documents.reduce(
    (count, candidate) => count + candidate.querySelectorAll(selector).length,
    0,
  );
}
