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

const firstParagraphId = asBlockId("realm-first-paragraph");
const headingId = asBlockId("realm-heading");
const atomParagraphId = asBlockId("realm-atom-paragraph");
const finalParagraphId = asBlockId("realm-final-paragraph");

describe("the movable shared text EditorView", () => {
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
    const headingHostB = createHost(realmB, headingId);
    const atomHostB = createHost(realmB, atomParagraphId);
    const finalHostA = createHost(realmA, finalParagraphId);

    try {
      act(() => activate(shared, editor.getBlock(firstParagraphId), hostA));
      const view = requiredView(shared);
      assertActiveRealm(view, realmA, realmA, [realmA, realmB]);
      expect(hostA.projection.hidden).toBe(true);
      expect(shared.readPlainText()).toBe("First realm");

      act(() => activate(shared, editor.getBlock(headingId), headingHostB));
      expect(requiredView(shared)).toBe(view);
      assertActiveRealm(view, realmB, realmB, [realmA, realmB]);
      expect(hostA.projection.hidden).toBe(false);
      expect(headingHostB.projection.hidden).toBe(true);
      const heading = view.dom.querySelector("h2");
      const hardBreak = view.dom.querySelector("br");
      expect(heading?.ownerDocument).toBe(realmB);
      expect(hardBreak?.ownerDocument).toBe(realmB);
      expect(shared.readPlainText()).toBe("Heading\nline");

      act(() => activate(shared, editor.getBlock(atomParagraphId), atomHostB));
      expect(requiredView(shared)).toBe(view);
      assertActiveRealm(view, realmB, realmB, [realmA, realmB]);
      expect(headingHostB.projection.hidden).toBe(false);
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
      expect(editor.readBlockPlainText(finalParagraphId, "paragraph")).toBe(
        "!Final realm",
      );
    } finally {
      act(() => shared.destroy());
      portals.unmount();
      editor.dispose();
      hostA.shell.remove();
      headingHostB.shell.remove();
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
    const shadowHost = createHost(document, headingId, shadowRoot);

    try {
      act(() =>
        activate(shared, editor.getBlock(firstParagraphId), documentHost),
      );
      const view = requiredView(shared);
      expect(view.root).toBe(document);

      act(() => activate(shared, editor.getBlock(headingId), shadowHost));
      expect(requiredView(shared)).toBe(view);
      expect(view.root).toBe(shadowRoot);
      expect(view.dom.ownerDocument).toBe(shadowRoot.ownerDocument);
      expect(view.dom.querySelector("h2")?.ownerDocument).toBe(
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
      { id: firstParagraphId, type: "paragraph", text: "First realm" },
      {
        id: headingId,
        type: "heading",
        metadata: { level: 2 },
        content: documentContent([
          { type: "text", text: "Heading" },
          { type: "hard_break" },
          { type: "text", text: "line" },
        ]),
      },
      {
        id: atomParagraphId,
        type: "paragraph",
        content: documentContent([
          { type: "text", text: "Hello " },
          { type: "mention", metadata: { id: "ada" } },
          { type: "text", text: "!" },
        ]),
      },
      { id: finalParagraphId, type: "paragraph", text: "Final realm" },
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
