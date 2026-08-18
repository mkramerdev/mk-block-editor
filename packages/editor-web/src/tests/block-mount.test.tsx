import { act, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StrictMode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import { EditorView } from "@repo/editor-dom/prosemirror";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import { createSemanticDomTextLayout } from "../document/geometry/semantic-dom-coordinates.ts";
import type { EditableEditor } from "../runtime/document/contracts.ts";
import type { EditableEditorRuntimePort } from "../runtime/document/render-port.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import {
  testEditableEditorDefinition,
  testReadEditorDefinition,
} from "./test-editor-definition.ts";
import {
  initializeTestEditableEditor,
  initializeTestReadEditor,
} from "./test-editor-initializers.ts";

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
    expect((editor as EditableEditorRuntimePort).readActiveTextView()).toBeNull();
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
          type: "paragraph",
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
      expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
      expect(
        rendered.container.querySelectorAll('[contenteditable="true"]'),
      ).toHaveLength(1);
    }

    expect(blockIds.map((id) => blockShell(rendered.container, id))).toEqual(shells);
    expect(blockIds.map((id) => textHost(rendered.container, id))).toEqual(hosts);
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
      expect(runtime.readBlockPlainText(firstId, "paragraph")).toBe("fiXrst"),
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
      expect(runtime.readBlockPlainText(firstId, "paragraph")).toBe("fi!rst"),
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

  it("moves one semantic view through paragraphs and metadata-level headings", () => {
    const paragraphA = "semantic-paragraph-a" as BlockId;
    const headingOne = "semantic-heading-one" as BlockId;
    const headingTwo = "semantic-heading-two" as BlockId;
    const paragraphB = "semantic-paragraph-b" as BlockId;
    const entries = [
      { id: paragraphA, type: "paragraph", text: "Paragraph one", tag: "p" },
      {
        id: headingOne,
        type: "heading",
        text: "Heading one",
        metadata: { level: 1 },
        tag: "h1",
      },
      {
        id: headingTwo,
        type: "heading",
        text: "Heading two",
        metadata: { level: 2 },
        tag: "h2",
      },
      { id: paragraphB, type: "paragraph", text: "Paragraph two", tag: "p" },
    ] as const;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot(entries),
    });
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);

    for (const entry of entries) {
      const projection = textProjection(textHost(rendered.container, entry.id));
      expect(projection.querySelector(entry.tag)?.textContent).toBe(entry.text);
    }

    let sharedView: EditorView | null = null;
    let previousId: BlockId | null = null;
    for (const entry of entries) {
      activateText(editor, entry.id, 0);
      sharedView ??= runtime.readActiveTextView();
      expect(runtime.readActiveTextView()).toBe(sharedView);
      expect(sharedView?.state.doc.firstChild?.type.name).toBe(
        entry.type === "heading" ? "heading" : "paragraph",
      );
      expect(sharedView?.dom.querySelector(entry.tag)?.textContent).toBe(
        entry.text,
      );
      expect(
        sharedView?.dom.querySelector("p[data-block-node='paragraph']"),
      ).toBe(entry.type === "heading" ? null : sharedView?.dom.firstElementChild);
      expect(textProjection(textHost(rendered.container, entry.id)).hidden).toBe(
        true,
      );
      if (previousId) {
        expect(
          textProjection(textHost(rendered.container, previousId)).hidden,
        ).toBe(false);
      }
      expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
      expect(
        rendered.container.querySelectorAll('[contenteditable="true"]'),
      ).toHaveLength(1);
      expect(
        rendered.container.querySelectorAll('[data-editor-input-owner="true"]'),
      ).toHaveLength(1);
      expect(visibleTextRepresentations(textHost(rendered.container, entry.id))).toEqual([
        sharedView?.dom,
      ]);
      expect(sharedView?.state.doc.textContent).toBe(entry.text);
      previousId = entry.id;
    }

    activateText(editor, headingOne, 0);
    expect(runtime.readActiveTextView()).toBe(sharedView);
    act(() => {
      expect(
        editor.updateBlockMetadata([
          { blockId: headingOne, values: { level: 3 } },
        ]),
      ).toBe(true);
    });
    expect(runtime.readActiveTextView()).toBe(sharedView);
    expect(sharedView?.dom.querySelector("h3[data-block-node='heading']")?.textContent).toBe(
      "Heading one",
    );
    expect(sharedView?.dom.querySelector("h1[data-block-node='heading']")).toBeNull();
    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(1);

    editor.dispose();
  });

  it("inherits product typography identically in read and active semantic nodes", () => {
    const entries = [
      { id: "visual-paragraph" as BlockId, type: "paragraph", text: "Body", tag: "p", size: "16px", weight: "400" },
      { id: "visual-h1" as BlockId, type: "heading", text: "One", metadata: { level: 1 }, tag: "h1", size: "32px", weight: "750" },
      { id: "visual-h2" as BlockId, type: "heading", text: "Two", metadata: { level: 2 }, tag: "h2", size: "24px", weight: "720" },
      { id: "visual-h3" as BlockId, type: "heading", text: "Three", metadata: { level: 3 }, tag: "h3", size: "20px", weight: "680" },
    ] as const;
    const productStyles = document.createElement("style");
    productStyles.textContent = `${entries
      .map(
        (entry, index) =>
          `[data-editor-block-id="${entry.id}"] .editor-web-text { font-family: Product Sans; font-size: ${entry.size}; font-weight: ${entry.weight}; line-height: 1.${index + 2}; color: rgb(${20 + index}, ${30 + index}, ${40 + index}); letter-spacing: ${index + 1}px; }`,
      )
      .join("\n")}
      h1 { font: 64px serif; color: red; letter-spacing: 10px; margin: 40px; }
      p { font: 9px monospace; color: blue; letter-spacing: 8px; margin: 30px; }`;
    document.head.append(productStyles);
    // jsdom does not fully implement selector specificity for shorthands.
    // Put the production normalization last while still computing real CSS.
    document.head.append(editorStyles);
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot(entries),
    });
    const rendered = render(<EditorDocument editor={editor} />);

    try {
      for (const entry of entries) {
        const host = textHost(rendered.container, entry.id);
        const readNode = textProjection(host).querySelector<HTMLElement>(entry.tag)!;
        const readStyle = typographySnapshot(readNode);
        expect(readStyle).toMatchObject({
          marginTop: "0px",
          marginRight: "0px",
          marginBottom: "0px",
          marginLeft: "0px",
        });

        activateText(editor, entry.id, 0);
        const activeNode = (
          editor as EditableEditorRuntimePort
        ).readActiveTextView()!.dom.querySelector<HTMLElement>(entry.tag)!;
        expect(typographySnapshot(activeNode)).toEqual(readStyle);
      }
    } finally {
      editor.dispose();
      productStyles.remove();
    }
  });

  it("keeps heading metadata and neutral canonical content through edits, history, remote projection, and reload", async () => {
    const headingId = "persistent-semantic-heading" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        {
          id: headingId,
          type: "heading",
          text: "Title",
          metadata: { level: 2 },
        },
      ]),
    });
    const runtime = editor as EditableEditorRuntimePort;
    render(<EditorDocument editor={editor} />);
    activateText(editor, headingId, 5);
    const view = runtime.readActiveTextView()!;

    act(() => view.dispatch(view.state.tr.insertText("!")));
    await waitFor(() => expect(editor.readBlockPlainText(headingId, "heading")).toBe("Title!"));
    expect(editor.getBlock(headingId)).toMatchObject({
      type: "heading",
      metadata: { level: 2 },
    });
    expect(editor.readBlockContent(headingId, "heading")?.content[0]?.type).toBe(
      "paragraph",
    );

    act(() => expect(editor.undo()).toEqual({ status: "applied" }));
    await waitFor(() => expect(editor.readBlockPlainText(headingId, "heading")).toBe("Title"));
    act(() => expect(editor.redo()).toEqual({ status: "applied" }));
    await waitFor(() => expect(editor.readBlockPlainText(headingId, "heading")).toBe("Title!"));
    expect(editor.getBlock(headingId)?.metadata?.level).toBe(2);

    act(() => {
      runtime.contentRuntime.applyExternalContentUpdate({
        blockGraphVersion: runtime.getSelectionGraphRevision(),
        blockId: headingId,
        blockType: "heading",
        readProjection: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Remote title" }],
            },
          ],
        },
        origin: "semantic-heading-test",
      });
    });
    await waitFor(() => expect(view.state.doc.textContent).toBe("Remote title"));
    expect(view.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.readBlockContent(headingId, "heading")?.content[0]?.type).toBe(
      "paragraph",
    );

    const reloaded = initializeTestReadEditor({
      definition: testReadEditorDefinition,
      snapshot: editor.readSnapshot(),
    });
    const reloadRender = render(<EditorDocument editor={reloaded} />);
    expect(
      reloadRender.container.querySelector("h2[data-block-node='heading']")
        ?.textContent,
    ).toBe("Remote title");
    expect(reloaded.getBlock(headingId)?.metadata?.level).toBe(2);

    reloaded.dispose();
    editor.dispose();
  });

  it("rejects stale presentation without constructing a view", () => {
    const editor = createEditor();
    const runtime = editor as EditableEditorRuntimePort;
    render(<EditorDocument editor={editor} />);
    const revision = runtime.selectionController.getCanonicalSnapshot().revision;
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

  it("synchronizes geometry when pending presentation activates during initial host registration", async () => {
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: firstId, type: "paragraph", text: "first" },
      ]),
    });
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    activateText(editor, firstId, 5);
    const activeView = runtime.readActiveTextView();
    if (!activeView) throw new Error("missing active shared view");
    const updateMountedTextRoot = vi.spyOn(
      runtime.geometryRegistration,
      "updateMountedTextRoot",
    );
    act(() => activeView.dom.dispatchEvent(keyDown("Enter")));
    await waitFor(() => expect(editor.getRootBlockIds()).toHaveLength(2));
    const generatedId = editor.getRootBlockIds()[1];
    if (!generatedId) throw new Error("missing generated paragraph");
    const generatedHost = textHost(rendered.container, generatedId);
    const projection = textProjection(generatedHost);
    await waitFor(() =>
      expect(activeView.dom.parentElement).toBe(textSlot(generatedHost)),
    );
    expect(activeView.dom.parentElement).toBe(
      textSlot(generatedHost),
    );
    expect(projection.hidden).toBe(true);
    expect(updateMountedTextRoot).toHaveBeenCalledWith(
      generatedId,
      activeView.dom,
    );

    editor.dispose();
  });

  it("keeps an existing previous paragraph focused after deleting an empty paragraph", async () => {
    const previousId = "backspace-previous-paragraph" as BlockId;
    const emptyId = "backspace-empty-paragraph" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: previousId, type: "paragraph", text: "Alpha" },
        { id: emptyId, type: "paragraph", text: "" },
      ]),
    });
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    activateText(editor, emptyId, 0);
    const sharedView = runtime.readActiveTextView();
    if (!sharedView) throw new Error("missing active shared view");
    expectCanonicalCaret(runtime, emptyId, 0);

    act(() => sharedView.dom.dispatchEvent(keyDown("Backspace")));

    await waitFor(() => expect(editor.getRootBlockIds()).toEqual([previousId]));
    await waitFor(() =>
      expectSharedTextCaret(
        rendered.container,
        runtime,
        sharedView,
        previousId,
        5,
      ),
    );
    expect(blockShellOrNull(rendered.container, emptyId)).toBeNull();
    expect(
      textProjection(textHost(rendered.container, previousId)).hidden,
    ).toBe(true);
    expectSharedViewInvariants(rendered.container);

    act(() => sharedView.dispatch(sharedView.state.tr.insertText("!")));
    await waitFor(() =>
      expect(editor.readBlockPlainText(previousId, "paragraph")).toBe("Alpha!"),
    );
    editor.dispose();
  });

  it("keeps the original paragraph immediately editable after Enter then Backspace", async () => {
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: firstId, type: "paragraph", text: "Alpha" },
      ]),
    });
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    activateText(editor, firstId, 5);
    const sharedView = runtime.readActiveTextView();
    if (!sharedView) throw new Error("missing active shared view");

    act(() => sharedView.dom.dispatchEvent(keyDown("Enter")));
    await waitFor(() => expect(editor.getRootBlockIds()).toHaveLength(2));
    const generatedId = editor.getRootBlockIds()[1];
    if (!generatedId) throw new Error("missing generated paragraph");
    await waitFor(() =>
      expectSharedTextCaret(
        rendered.container,
        runtime,
        sharedView,
        generatedId,
        0,
      ),
    );

    act(() => sharedView.dom.dispatchEvent(keyDown("Backspace")));
    await waitFor(() => expect(editor.getRootBlockIds()).toEqual([firstId]));
    await waitFor(() =>
      expectSharedTextCaret(
        rendered.container,
        runtime,
        sharedView,
        firstId,
        5,
      ),
    );
    act(() => sharedView.dispatch(sharedView.state.tr.insertText("!")));
    await waitFor(() =>
      expect(editor.readBlockPlainText(firstId, "paragraph")).toBe("Alpha!"),
    );
    expect(blockShellOrNull(rendered.container, generatedId)).toBeNull();
    expectSharedViewInvariants(rendered.container);
    editor.dispose();
  });

  it("activates a previous heading at its end without losing heading semantics", async () => {
    const headingId = "backspace-heading" as BlockId;
    const emptyId = "backspace-after-heading" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        {
          id: headingId,
          type: "heading",
          text: "Title",
          metadata: { level: 2 },
        },
        { id: emptyId, type: "paragraph", text: "" },
      ]),
    });
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    activateText(editor, emptyId, 0);
    const sharedView = runtime.readActiveTextView();
    if (!sharedView) throw new Error("missing active shared view");

    act(() => sharedView.dom.dispatchEvent(keyDown("Backspace")));
    await waitFor(() => expect(editor.getRootBlockIds()).toEqual([headingId]));
    await waitFor(() =>
      expectSharedTextCaret(
        rendered.container,
        runtime,
        sharedView,
        headingId,
        5,
      ),
    );
    expect(editor.getBlock(headingId)).toMatchObject({
      type: "heading",
      metadata: { level: 2 },
    });
    expect(sharedView.dom.querySelector("h2")).not.toBeNull();
    expect(textProjection(textHost(rendered.container, headingId)).hidden).toBe(
      true,
    );
    expectSharedViewInvariants(rendered.container);
    editor.dispose();
  });

  it("resolves wrapper cleanup to the nearest surviving text block above", async () => {
    const previousId = "backspace-wrapper-previous" as BlockId;
    const wrapperId = "backspace-list-item-wrapper" as BlockId;
    const emptyId = "backspace-list-item-empty" as BlockId;
    const base = createTestEditorSnapshot([
      { id: previousId, type: "paragraph", text: "Above" },
      { id: wrapperId, type: "itemWrapper" },
      { id: emptyId, type: "childText", text: "" },
    ]);
    const snapshot = {
      ...base,
      blocks: {
        ...base.blocks,
        [wrapperId]: createBlockRecord({ id: wrapperId, type: "itemWrapper" }),
        [emptyId]: createBlockRecord({
          id: emptyId,
          type: "childText",
          parentId: wrapperId,
        }),
      },
      rootBlockIds: [previousId, wrapperId],
      childIdsByParentId: { [wrapperId]: [emptyId] },
    };
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
    });
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    activateText(editor, emptyId, 0);
    const sharedView = runtime.readActiveTextView();
    if (!sharedView) throw new Error("missing active shared view");

    act(() => sharedView.dom.dispatchEvent(keyDown("Backspace")));
    await waitFor(() => expect(editor.getRootBlockIds()).toEqual([previousId]));
    await waitFor(() =>
      expectSharedTextCaret(
        rendered.container,
        runtime,
        sharedView,
        previousId,
        5,
      ),
    );
    expect(blockShellOrNull(rendered.container, wrapperId)).toBeNull();
    expect(blockShellOrNull(rendered.container, emptyId)).toBeNull();
    expectSharedViewInvariants(rendered.container);
    editor.dispose();
  });

  it("falls forward to the following text start when no previous target exists", async () => {
    const emptyId = "backspace-first-empty" as BlockId;
    const followingId = "backspace-following" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: emptyId, type: "paragraph", text: "" },
        { id: followingId, type: "paragraph", text: "Beta" },
      ]),
    });
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    activateText(editor, emptyId, 0);
    const sharedView = runtime.readActiveTextView();
    if (!sharedView) throw new Error("missing active shared view");

    act(() => sharedView.dom.dispatchEvent(keyDown("Backspace")));
    await waitFor(() =>
      expect(editor.getRootBlockIds()).toEqual([followingId]),
    );
    await waitFor(() =>
      expectSharedTextCaret(
        rendered.container,
        runtime,
        sharedView,
        followingId,
        0,
      ),
    );
    expectSharedViewInvariants(rendered.container);
    editor.dispose();
  });

  it("restores deletion selection through undo and redo without duplicating the shared view", async () => {
    const previousId = "backspace-history-previous" as BlockId;
    const emptyId = "backspace-history-empty" as BlockId;
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: previousId, type: "paragraph", text: "Alpha" },
        { id: emptyId, type: "paragraph", text: "" },
      ]),
    });
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    activateText(editor, emptyId, 0);
    const sharedView = runtime.readActiveTextView();
    if (!sharedView) throw new Error("missing active shared view");

    act(() => sharedView.dom.dispatchEvent(keyDown("Backspace")));
    await waitFor(() => expect(editor.getRootBlockIds()).toEqual([previousId]));
    await waitFor(() =>
      expectSharedTextCaret(
        rendered.container,
        runtime,
        sharedView,
        previousId,
        5,
      ),
    );

    act(() => expect(editor.undo()).toEqual({ status: "applied" }));
    await waitFor(() =>
      expect(editor.getRootBlockIds()).toEqual([previousId, emptyId]),
    );
    await waitFor(() =>
      expectSharedTextCaret(
        rendered.container,
        runtime,
        sharedView,
        emptyId,
        0,
      ),
    );
    expectSharedViewInvariants(rendered.container);

    act(() => expect(editor.redo()).toEqual({ status: "applied" }));
    await waitFor(() => expect(editor.getRootBlockIds()).toEqual([previousId]));
    await waitFor(() =>
      expectSharedTextCaret(
        rendered.container,
        runtime,
        sharedView,
        previousId,
        5,
      ),
    );
    expect(blockShellOrNull(rendered.container, emptyId)).toBeNull();
    expectSharedViewInvariants(rendered.container);
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

  it("navigates vertically immediately after Enter activates a newly mounted paragraph", async () => {
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: firstId, type: "paragraph", text: "first" },
        { id: secondId, type: "paragraph", text: "second" },
      ]),
    });
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    const restoreGeometry = installDeterministicTextGeometry(() => {
      const roots = editor.getRootBlockIds();
      return roots.length === 3 ? roots[1] ?? null : null;
    });

    try {
      activateText(editor, firstId, 5);
      const sharedView = runtime.readActiveTextView();
      if (!sharedView) throw new Error("missing active shared view");
      act(() => sharedView.dom.dispatchEvent(keyDown("Enter")));

      await waitFor(() => expect(editor.getRootBlockIds()).toHaveLength(3));
      const generatedId = editor.getRootBlockIds()[1];
      if (!generatedId) throw new Error("missing generated paragraph");
      const generatedHost = textHost(rendered.container, generatedId);
      const generatedProjection = textProjection(generatedHost);
      await waitFor(() => {
        expect(runtime.readActiveTextView()).toBe(sharedView);
        expect(sharedView.dom.parentElement).toBe(textSlot(generatedHost));
      });

      expectCanonicalCaret(runtime, generatedId, 0);
      expect(runtime.readTextSelectionOffset(generatedId)).toBe(0);
      expect(generatedProjection.hidden).toBe(true);
      expect(visibleTextRepresentations(generatedHost)).toEqual([
        sharedView.dom,
      ]);
      expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(
        1,
      );
      expect(
        rendered.container.querySelectorAll('[contenteditable="true"]'),
      ).toHaveLength(1);
      expect(
        rendered.container.querySelectorAll(
          '[data-editor-input-owner="true"]',
        ),
      ).toHaveLength(1);

      const generatedProjectionHtml = generatedProjection.innerHTML;
      generatedProjection.textContent = "hidden-projection-only";
      expect(editor.geometry.readTextCanonicalLength(generatedId)).toBe(0);
      generatedProjection.innerHTML = generatedProjectionHtml;

      const arrowUp = keyDown("ArrowUp");
      act(() => sharedView.dom.dispatchEvent(arrowUp));
      expect(arrowUp.defaultPrevented).toBe(true);
      expectCanonicalCaretInBlock(runtime, firstId);
      expect(sharedView.dom.parentElement).toBe(
        textSlot(textHost(rendered.container, firstId)),
      );
      expect(document.activeElement).toBe(sharedView.dom);
      expect(runtime.readTextSelectionOffset(firstId)).toBe(
        readCanonicalCaretOffset(runtime, firstId),
      );

      const arrowDownToGenerated = keyDown("ArrowDown");
      act(() => sharedView.dom.dispatchEvent(arrowDownToGenerated));
      expect(arrowDownToGenerated.defaultPrevented).toBe(true);
      expectCanonicalCaret(runtime, generatedId, 0);

      const arrowDownToFollowing = keyDown("ArrowDown");
      act(() => sharedView.dom.dispatchEvent(arrowDownToFollowing));
      expect(arrowDownToFollowing.defaultPrevented).toBe(true);
      expectCanonicalCaretInBlock(runtime, secondId);

      const arrowLeft = keyDown("ArrowLeft");
      act(() => sharedView.dom.dispatchEvent(arrowLeft));
      expect(arrowLeft.defaultPrevented).toBe(true);
      expectCanonicalCaret(runtime, generatedId, 0);
      const arrowRight = keyDown("ArrowRight");
      act(() => sharedView.dom.dispatchEvent(arrowRight));
      expect(arrowRight.defaultPrevented).toBe(true);
      expectCanonicalCaretInBlock(runtime, secondId);
    } finally {
      restoreGeometry();
      editor.dispose();
    }
  });

  it("keeps read-only documents permanently free of views and editable roots", () => {
    const editor = initializeTestReadEditor({
      definition: testReadEditorDefinition,
      snapshot: snapshot(),
    });
    const rendered = render(<EditorDocument editor={editor} />);
    expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(0);
    expect(
      rendered.container.querySelectorAll('[contenteditable="true"]'),
    ).toHaveLength(0);
    expect(rendered.container.textContent).toContain("first");
    editor.dispose();
  });

  it("survives the Strict Mode host registration probe without duplicating the view", async () => {
    const editor = createEditor();
    expect(editor.focusText(firstId, { offset: 2 }).status).not.toBe("rejected");
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
    { id: firstId, type: "paragraph", text: "first" },
    { id: secondId, type: "paragraph", text: "second" },
    { id: thirdId, type: "paragraph", text: "third" },
  ]);
}

function activateText(editor: EditableEditor, blockId: BlockId, offset: number): void {
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

function blockShellOrNull(
  container: HTMLElement,
  blockId: BlockId,
): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-editor-block-shell="true"][data-editor-block-id="${blockId}"]`,
  );
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
  if (!element) throw new Error("missing read projection");
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

function expectSharedTextCaret(
  container: HTMLElement,
  editor: EditableEditorRuntimePort,
  view: EditorView,
  blockId: BlockId,
  offset: number,
): void {
  expectCanonicalCaret(editor, blockId, offset);
  expect(editor.isTextProjectionActive(blockId)).toBe(true);
  expect(editor.readActiveTextView()).toBe(view);
  expect(view.dom.parentElement).toBe(textSlot(textHost(container, blockId)));
  expect(document.activeElement).toBe(view.dom);
  expect(editor.readTextSelectionOffset(blockId)).toBe(offset);
  expectNativeCaretOffset(view, offset);
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

function expectSharedViewInvariants(container: HTMLElement): void {
  expect(container.querySelectorAll(".ProseMirror")).toHaveLength(1);
  expect(container.querySelectorAll('[contenteditable="true"]')).toHaveLength(
    1,
  );
  expect(
    container.querySelectorAll('[data-editor-input-owner="true"]'),
  ).toHaveLength(1);
}

function expectCanonicalCaret(
  editor: EditableEditorRuntimePort,
  blockId: BlockId,
  offset: number,
): void {
  const canonical = editor.selectionController.getCanonicalSnapshot();
  expect(canonical.kind).toBe("document");
  if (canonical.kind !== "document") return;
  expect(canonical.snapshot.documentSelection.anchor).toMatchObject({
    blockId,
    textOffset: offset,
  });
  expect(canonical.snapshot.documentSelection.focus).toMatchObject({
    blockId,
    textOffset: offset,
  });
}

function expectCanonicalCaretInBlock(
  editor: EditableEditorRuntimePort,
  blockId: BlockId,
): void {
  const canonical = editor.selectionController.getCanonicalSnapshot();
  expect(canonical.kind).toBe("document");
  if (canonical.kind !== "document") return;
  const { anchor, focus } = canonical.snapshot.documentSelection;
  expect(anchor?.blockId).toBe(blockId);
  expect(focus?.blockId).toBe(blockId);
  expect(anchor?.textOffset).toBe(focus?.textOffset);
}

function readCanonicalCaretOffset(
  editor: EditableEditorRuntimePort,
  blockId: BlockId,
): number | null {
  const canonical = editor.selectionController.getCanonicalSnapshot();
  if (canonical.kind !== "document") return null;
  const { anchor, focus } = canonical.snapshot.documentSelection;
  return anchor?.blockId === blockId &&
    focus?.blockId === blockId &&
    anchor.textOffset === focus.textOffset
    ? focus.textOffset
    : null;
}

function keyDown(key: string): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
}

function installDeterministicTextGeometry(
  readGeneratedId: () => BlockId | null,
): () => void {
  const originalElementRect = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "getBoundingClientRect",
  );
  const originalRangeRects = Object.getOwnPropertyDescriptor(
    Range.prototype,
    "getClientRects",
  );
  const originalRangeRect = Object.getOwnPropertyDescriptor(
    Range.prototype,
    "getBoundingClientRect",
  );
  const geometryRect = (left: number, top: number, width: number, height: number) =>
    ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
  const blockTop = (element: Element | null): number => {
    const blockId = element
      ?.closest<HTMLElement>('[data-editor-block-id]')
      ?.dataset.editorBlockId;
    if (blockId === firstId) return 100;
    if (blockId === readGeneratedId()) return 200;
    if (blockId === secondId) return 300;
    return 20;
  };
  const rangeRoot = (range: Range): HTMLElement | null => {
    const node = range.commonAncestorContainer;
    const element =
      node instanceof HTMLElement ? node : node.parentElement;
    return (
      element?.closest<HTMLElement>(
        '.ProseMirror, [data-editor-text-projection="true"]',
      ) ?? null
    );
  };
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function (this: HTMLElement) {
      if (this.hidden) return geometryRect(0, 0, 0, 0);
      return geometryRect(120, blockTop(this), 300, 20);
    },
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: function (this: Range) {
      const root = rangeRoot(this);
      if (!root || root.hidden) return [] as unknown as DOMRectList;
      return [
        geometryRect(120 + this.startOffset * 8, blockTop(root), 1, 18),
      ] as unknown as DOMRectList;
    },
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function (this: Range) {
      const root = rangeRoot(this);
      return !root || root.hidden
        ? geometryRect(0, 0, 0, 0)
        : geometryRect(
            120 + this.startOffset * 8,
            blockTop(root),
            1,
            18,
          );
    },
  });
  return () => {
    restoreDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect",
      originalElementRect,
    );
    restoreDescriptor(Range.prototype, "getClientRects", originalRangeRects);
    restoreDescriptor(
      Range.prototype,
      "getBoundingClientRect",
      originalRangeRect,
    );
  };
}

function restoreDescriptor(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) Object.defineProperty(target, property, descriptor);
  else Reflect.deleteProperty(target, property);
}

function typographySnapshot(element: HTMLElement) {
  const style = getComputedStyle(element);
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    color: style.color,
    letterSpacing: style.letterSpacing,
    marginTop: style.marginTop,
    marginRight: style.marginRight,
    marginBottom: style.marginBottom,
    marginLeft: style.marginLeft,
  };
}
