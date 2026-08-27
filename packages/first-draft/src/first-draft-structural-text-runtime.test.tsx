import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  removeBlocks,
  replaceContent,
  type StructuralEditRange,
} from "@repo/editor-core/editing";
import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  richTextDocumentWithInlineContent,
} from "@repo/editor-core/content/rich-text";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import { EditorDocument } from "@repo/editor-web/document-runtime";
import { FirstDraftBlockHoverProvider } from "./block-controls/index.ts";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
} from "./blocks/view-state.tsx";
import {
  createFirstDraftTableActionMenuStore,
  FirstDraftTableActionMenuProvider,
} from "./table-action-menu/index.ts";
import { createFirstDraftEditorDefinition } from "./first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "./first-draft-fixture.ts";
import { initializeTestEditableEditor } from "./test-editor.ts";

const id = asBlockId;
const disposables: Array<{ dispose(): void }> = [];

afterEach(() => {
  cleanup();
  for (const editor of disposables.splice(0)) editor.dispose();
  vi.restoreAllMocks();
});

describe("First Draft structural text runtime", () => {
  it("splits an ordinary paragraph and a heading through one product transaction", () => {
    const fixture = renderFixture();
    const paragraphId = id("fd-paragraph-byline");
    const originalParagraph = fixture.editor.readBlockPlainText(
      paragraphId,
      "paragraph",
    );
    pressBoundaryKey(fixture, paragraphId, 2, "Enter");
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.structural.mock.results[0]?.value).toMatchObject({
      ok: true,
    });
    const paragraphRoots = fixture.editor.getRootBlockIds();
    const paragraphIndex = paragraphRoots.indexOf(paragraphId);
    const splitParagraphId = paragraphRoots[paragraphIndex + 1]!;
    expect(fixture.editor.getBlock(splitParagraphId)?.type).toBe("paragraph");
    expect(fixture.editor.readBlockPlainText(paragraphId, "paragraph")).toBe(
      originalParagraph.slice(0, 2),
    );
    expect(
      fixture.editor.readBlockPlainText(splitParagraphId, "paragraph"),
    ).toBe(originalParagraph.slice(2));
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.onChange).toHaveBeenCalledTimes(1);

    fixture.structural.mockClear();
    fixture.onChange.mockClear();
    const headingId = id("fd-heading-2");
    const originalHeading = fixture.editor.readBlockPlainText(
      headingId,
      "heading",
    );
    pressBoundaryKey(fixture, headingId, 3, "Enter");
    const headingRoots = fixture.editor.getRootBlockIds();
    const headingIndex = headingRoots.indexOf(headingId);
    const headingResultId = headingRoots[headingIndex + 1]!;
    expect(fixture.editor.getBlock(headingResultId)?.type).toBe("paragraph");
    expect(fixture.editor.readBlockPlainText(headingId, "heading")).toBe(
      originalHeading.slice(0, 3),
    );
    expect(
      fixture.editor.readBlockPlainText(headingResultId, "paragraph"),
    ).toBe(originalHeading.slice(3));
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.onChange).toHaveBeenCalledTimes(1);
  });

  it("exits an empty final callout paragraph atomically and preserves history", () => {
    const fixture = renderFixture();
    const calloutId = id("fd-callout");
    const sourceId = id("fd-callout-text");
    const originalRoots = fixture.editor.getRootBlockIds();
    const originalCallout = fixture.editor.getBlock(calloutId);
    const originalText = fixture.editor.readBlockPlainText(
      sourceId,
      "paragraph",
    );

    pressBoundaryKey(fixture, sourceId, originalText.length, "Enter");

    const splitChildren = fixture.editor.getChildBlockIds(calloutId);
    expect(splitChildren).toHaveLength(2);
    expect(splitChildren[0]).toBe(sourceId);
    const emptyChildId = splitChildren[1]!;
    expect(fixture.editor.getBlock(emptyChildId)).toMatchObject({
      type: "paragraph",
      parentId: calloutId,
    });
    expect(fixture.editor.readBlockPlainText(emptyChildId, "paragraph")).toBe(
      "",
    );
    expect(fixture.editor.getRootBlockIds()).toEqual(originalRoots);
    expect(fixture.editor.readBlockPlainText(sourceId, "paragraph")).toBe(
      originalText,
    );
    expect(fixture.structural).toHaveBeenCalledOnce();
    expect(fixture.structural.mock.calls[0]?.[0]).toMatchObject({
      origin: "first-draft-enter",
    });
    expect(fixture.onChange).toHaveBeenCalledOnce();

    fixture.structural.mockClear();
    fixture.onChange.mockClear();
    pressBoundaryKey(fixture, emptyChildId, 0, "Enter");

    const roots = fixture.editor.getRootBlockIds();
    const calloutIndex = roots.indexOf(calloutId);
    const exitedId = roots[calloutIndex + 1]!;
    expect(exitedId).not.toBe(emptyChildId);
    expect(roots).toEqual([
      ...originalRoots.slice(0, originalRoots.indexOf(calloutId) + 1),
      exitedId,
      ...originalRoots.slice(originalRoots.indexOf(calloutId) + 1),
    ]);
    expect(fixture.editor.getBlock(exitedId)).toMatchObject({
      type: "paragraph",
      parentId: null,
    });
    expect(fixture.editor.readBlockPlainText(exitedId, "paragraph")).toBe("");
    expect(fixture.editor.getChildBlockIds(calloutId)).toEqual([sourceId]);
    expect(fixture.editor.getBlock(calloutId)).toMatchObject({
      id: originalCallout?.id,
      type: originalCallout?.type,
      parentId: originalCallout?.parentId,
      metadata: originalCallout?.metadata,
    });
    expect(fixture.editor.readBlockPlainText(sourceId, "paragraph")).toBe(
      originalText,
    );
    expect(fixture.editor.getBlock(emptyChildId)).toBeNull();
    expect(
      Object.hasOwn(fixture.editor.readSnapshot().blocks, emptyChildId),
    ).toBe(false);
    expect(roots.filter((blockId) => blockId === exitedId)).toHaveLength(1);
    expect(
      fixture.container.querySelectorAll(
        `[data-editor-block-shell="true"][data-editor-block-id="${exitedId}"]`,
      ),
    ).toHaveLength(1);
    expect(fixture.structural).toHaveBeenCalledOnce();
    expect(fixture.structural.mock.calls[0]?.[0]).toMatchObject({
      origin: "first-draft-empty-callout-exit",
    });
    expect(fixture.onChange).toHaveBeenCalledOnce();
    expectDocumentCaret(fixture, exitedId, 0);
    expect(document.activeElement).toBe(textRoot(fixture.container, exitedId));

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getRootBlockIds()).toEqual(originalRoots);
    expect(fixture.editor.getChildBlockIds(calloutId)).toEqual([
      sourceId,
      emptyChildId,
    ]);
    expect(fixture.editor.getBlock(emptyChildId)).toMatchObject({
      type: "paragraph",
      parentId: calloutId,
    });
    expect(fixture.editor.getBlock(exitedId)).toBeNull();
    expect(fixture.onChange).toHaveBeenCalledTimes(2);

    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(calloutId)).toEqual([sourceId]);
    expect(fixture.editor.getBlock(emptyChildId)).toBeNull();
    expect(fixture.editor.getRootBlockIds()).toEqual(roots);
    expect(fixture.editor.getBlock(exitedId)).toMatchObject({
      type: "paragraph",
      parentId: null,
    });
    expect(fixture.onChange).toHaveBeenCalledTimes(3);
    expectDocumentCaret(fixture, exitedId, 0);
  });

  it("keeps an empty non-final callout child inside the callout", () => {
    const fixture = renderFixture();
    const calloutId = id("fd-callout");
    const sourceId = id("fd-callout-text");
    const originalRoots = fixture.editor.getRootBlockIds();
    const sourceLength = fixture.editor.readBlockPlainText(
      sourceId,
      "paragraph",
    ).length;
    pressBoundaryKey(fixture, sourceId, sourceLength, "Enter");
    const originalFinalId = fixture.editor.getChildBlockIds(calloutId)[1]!;
    eraseText(fixture, sourceId);
    fixture.structural.mockClear();
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, sourceId, 0, "Enter");

    const children = fixture.editor.getChildBlockIds(calloutId);
    expect(children).toHaveLength(3);
    expect(children[0]).toBe(sourceId);
    expect(children[2]).toBe(originalFinalId);
    expect(fixture.editor.getBlock(children[1]!)).toMatchObject({
      type: "paragraph",
      parentId: calloutId,
    });
    expect(fixture.editor.getRootBlockIds()).toEqual(originalRoots);
    expect(fixture.structural).toHaveBeenCalledOnce();
    expect(fixture.structural.mock.calls[0]?.[0]).toMatchObject({
      origin: "first-draft-enter",
    });
    expect(fixture.onChange).toHaveBeenCalledOnce();
  });

  it("exits an empty final callout heading as an ordinary paragraph", () => {
    const fixture = renderFixture();
    const calloutId = id("fd-callout");
    const sourceId = id("fd-callout-text");
    let insertion!: ReturnType<typeof fixture.editor.insertBlockAt>;
    act(() => {
      insertion = fixture.editor.insertBlockAt({
        placement: { parentId: calloutId, childIndex: 1 },
        blockType: "heading",
        selection: false,
      });
    });
    if (!insertion.ok) throw new Error("Failed to add callout heading");
    const headingId = fixture.editor.getChildBlockIds(calloutId)[1]!;
    fixture.structural.mockClear();
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, headingId, 0, "Enter");

    const roots = fixture.editor.getRootBlockIds();
    const exitedId = roots[roots.indexOf(calloutId) + 1]!;
    expect(fixture.editor.getChildBlockIds(calloutId)).toEqual([sourceId]);
    expect(fixture.editor.getBlock(headingId)).toBeNull();
    expect(fixture.editor.getBlock(exitedId)).toMatchObject({
      type: "paragraph",
      parentId: null,
    });
    expect(fixture.editor.readBlockPlainText(exitedId, "paragraph")).toBe("");
    expect(fixture.structural.mock.calls[0]?.[0]).toMatchObject({
      origin: "first-draft-empty-callout-exit",
    });
    expect(fixture.structural).toHaveBeenCalledOnce();
    expect(fixture.onChange).toHaveBeenCalledOnce();
    expectDocumentCaret(fixture, exitedId, 0);
    expect(document.activeElement).toBe(textRoot(fixture.container, exitedId));
  });

  it("replaces a sole empty callout with a valid root paragraph", () => {
    const fixture = renderFixture();
    const calloutId = id("fd-callout");
    const sourceId = id("fd-callout-text");
    eraseText(fixture, sourceId);
    const originalRoots = fixture.editor.getRootBlockIds();
    const calloutIndex = originalRoots.indexOf(calloutId);
    fixture.structural.mockClear();
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, sourceId, 0, "Enter");

    const roots = fixture.editor.getRootBlockIds();
    const exitedId = roots[calloutIndex]!;
    expect(roots).toEqual([
      ...originalRoots.slice(0, calloutIndex),
      exitedId,
      ...originalRoots.slice(calloutIndex + 1),
    ]);
    expect(fixture.editor.getBlock(calloutId)).toBeNull();
    expect(fixture.editor.getBlock(sourceId)).toBeNull();
    expect(fixture.editor.getBlock(exitedId)).toMatchObject({
      type: "paragraph",
      parentId: null,
    });
    expect(Object.hasOwn(fixture.editor.readSnapshot().blocks, calloutId)).toBe(
      false,
    );
    expect(Object.hasOwn(fixture.editor.readSnapshot().blocks, sourceId)).toBe(
      false,
    );
    expect(fixture.structural).toHaveBeenCalledOnce();
    expect(fixture.onChange).toHaveBeenCalledOnce();
    expectDocumentCaret(fixture, exitedId, 0);

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getRootBlockIds()).toEqual(originalRoots);
    expect(fixture.editor.getBlock(calloutId)?.type).toBe("callout");
    expect(fixture.editor.getChildBlockIds(calloutId)).toEqual([sourceId]);
    expect(fixture.editor.getBlock(sourceId)).toMatchObject({
      type: "paragraph",
      parentId: calloutId,
    });
    expect(fixture.editor.getBlock(exitedId)).toBeNull();

    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getBlock(calloutId)).toBeNull();
    expect(fixture.editor.getBlock(sourceId)).toBeNull();
    expect(fixture.editor.getRootBlockIds()).toEqual(roots);
    expect(fixture.editor.getBlock(exitedId)?.type).toBe("paragraph");
  });

  it("creates one complete collapsed toggle-list item and preserves the old hidden body", () => {
    const fixture = renderFixture();
    const toggleId = id("fd-toggle-list");
    const summaryId = id("fd-toggle-list-summary");
    const bodyId = id("fd-toggle-list-body");
    const summary = fixture.editor.readBlockPlainText(summaryId, "paragraph");
    const oldBodyChildren = fixture.editor.getChildBlockIds(bodyId);
    const toggleShell = shell(fixture.container, toggleId);
    const bodyShell = shell(fixture.container, bodyId);
    const oldBodyShells = oldBodyChildren.map((blockId) =>
      shell(fixture.container, blockId),
    );
    fixture.viewState.setBlockCollapsed(toggleId, true);
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, summaryId, 4, "Enter");
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.structural.mock.results[0]?.value).toMatchObject({
      ok: true,
    });

    const roots = fixture.editor.getRootBlockIds();
    const insertedId = roots[roots.indexOf(toggleId) + 1]!;
    expect(fixture.editor.getBlock(insertedId)?.type).toBe("toggleListItem");
    const insertedChildren = fixture.editor.getChildBlockIds(insertedId);
    expect(insertedChildren).toHaveLength(2);
    const insertedSummary = fixture.editor.getBlock(insertedChildren[0]!);
    const insertedBody = fixture.editor.getBlock(insertedChildren[1]!);
    expect(insertedSummary?.type).toBe("paragraph");
    expect(insertedBody?.type).toBe("toggleListItemBody");
    const insertedBodyChildren = fixture.editor.getChildBlockIds(
      insertedBody!.id,
    );
    expect(insertedBodyChildren).toEqual([]);
    expect(fixture.editor.readBlockPlainText(summaryId, "paragraph")).toBe(
      summary.slice(0, 4),
    );
    expect(
      fixture.editor.readBlockPlainText(insertedSummary!.id, "paragraph"),
    ).toBe(summary.slice(4));
    expect(fixture.editor.getChildBlockIds(bodyId)).toEqual(oldBodyChildren);
    expect(fixture.viewState.isBlockCollapsed(toggleId)).toBe(true);
    expect(fixture.viewState.isBlockCollapsed(insertedId)).toBe(true);
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.onChange).toHaveBeenCalledTimes(1);
    expectDocumentCaret(fixture, insertedSummary!.id, 0);
    expect(document.activeElement).toBe(
      textRoot(fixture.container, insertedSummary!.id),
    );
    expect(shell(fixture.container, toggleId)).toBe(toggleShell);
    expect(shell(fixture.container, bodyId)).toBe(bodyShell);
    oldBodyChildren.forEach((blockId, index) => {
      expect(shell(fixture.container, blockId)).toBe(oldBodyShells[index]);
    });

    act(() => expect(fixture.editor.undo().status).toBe("applied"));
    expect(fixture.editor.getBlock(insertedId)).toBeNull();
    expect(fixture.editor.readBlockPlainText(summaryId, "paragraph")).toBe(
      summary,
    );
    expect(fixture.editor.getChildBlockIds(bodyId)).toEqual(oldBodyChildren);
    expect(fixture.onChange).toHaveBeenCalledTimes(2);
    act(() => expect(fixture.editor.redo().status).toBe("applied"));
    expect(fixture.editor.getBlock(insertedId)?.type).toBe("toggleListItem");
    expect(fixture.editor.getChildBlockIds(insertedId)).toEqual(
      insertedChildren,
    );
    expect(fixture.editor.getChildBlockIds(insertedBody!.id)).toEqual(
      insertedBodyChildren,
    );
    expect(fixture.viewState.isBlockCollapsed(insertedId)).toBe(true);
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.onChange).toHaveBeenCalledTimes(3);
    expect(
      fixture.container.querySelectorAll(
        `[data-editor-block-shell="true"][data-editor-block-id="${insertedId}"]`,
      ),
    ).toHaveLength(1);
    expect(shell(fixture.container, toggleId)).toBe(toggleShell);
    expect(shell(fixture.container, bodyId)).toBe(bodyShell);
  });

  it("splits a collapsed toggle heading at the end into one external empty paragraph", () => {
    const fixture = renderFixture();
    const toggleId = id("fd-toggle-heading");
    const summaryId = id("fd-toggle-heading-summary");
    const bodyId = id("fd-toggle-heading-body");
    const originalRoots = fixture.editor.getRootBlockIds();
    const originalToggleCount = Object.values(
      fixture.editor.readSnapshot().blocks,
    ).filter((block) => block.type === "toggleHeading").length;
    const originalBodyChildren = fixture.editor.getChildBlockIds(bodyId);
    const originalSummary = fixture.editor.readBlockPlainText(
      summaryId,
      "heading",
    );
    const toggleShell = shell(fixture.container, toggleId);
    const summaryShell = shell(fixture.container, summaryId);
    const summaryTextRoot = textRoot(fixture.container, summaryId);
    const bodyShell = shell(fixture.container, bodyId);
    const bodyDescendantShells = originalBodyChildren.map((blockId) =>
      shell(fixture.container, blockId),
    );
    fixture.viewState.setBlockCollapsed(toggleId, true);
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, summaryId, originalSummary.length, "Enter");

    const roots = fixture.editor.getRootBlockIds();
    const insertedId = roots[roots.indexOf(toggleId) + 1]!;
    expect(roots).toEqual([
      ...originalRoots.slice(0, originalRoots.indexOf(toggleId) + 1),
      insertedId,
      ...originalRoots.slice(originalRoots.indexOf(toggleId) + 1),
    ]);
    expect(fixture.editor.getBlock(insertedId)?.type).toBe("paragraph");
    expect(fixture.editor.readBlockPlainText(insertedId, "paragraph")).toBe("");
    expect(fixture.editor.readBlockPlainText(summaryId, "heading")).toBe(
      originalSummary,
    );
    expect(
      Object.values(fixture.editor.readSnapshot().blocks).filter(
        (block) => block.type === "toggleHeading",
      ),
    ).toHaveLength(originalToggleCount);
    expect(fixture.editor.getBlock(toggleId)?.id).toBe(toggleId);
    expect(fixture.editor.getBlock(summaryId)?.id).toBe(summaryId);
    expect(fixture.editor.getBlock(bodyId)?.id).toBe(bodyId);
    expect(fixture.editor.getChildBlockIds(bodyId)).toEqual(
      originalBodyChildren,
    );
    expect(fixture.viewState.isBlockCollapsed(toggleId)).toBe(true);
    expect(fixture.viewState.isBlockCollapsed(insertedId)).toBe(false);
    expect([...fixture.viewState.getSnapshot().collapsed]).toEqual([toggleId]);
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.structural.mock.results[0]?.value).toMatchObject({
      ok: true,
    });
    expect(fixture.onChange).toHaveBeenCalledTimes(1);
    expectDocumentCaret(fixture, insertedId, 0);
    expect(document.activeElement).toBe(
      textRoot(fixture.container, insertedId),
    );
    expect(bodyShell.contains(document.activeElement)).toBe(false);
    expect(
      toggleShell.querySelector("button[aria-expanded='false']"),
    ).not.toBeNull();
    expect(shell(fixture.container, toggleId)).toBe(toggleShell);
    expect(shell(fixture.container, summaryId)).toBe(summaryShell);
    expect(textRoot(fixture.container, summaryId)).toBe(summaryTextRoot);
    expect(shell(fixture.container, bodyId)).toBe(bodyShell);
    originalBodyChildren.forEach((blockId, index) => {
      expect(shell(fixture.container, blockId)).toBe(
        bodyDescendantShells[index],
      );
    });
  });

  it("preserves rich text, metadata, hidden body, and history when splitting a collapsed toggle heading", () => {
    const summaryId = id("fd-toggle-heading-summary");
    const markedSummary = richTextDocumentWithInlineContent(
      "heading",
      createBlockRichTextContentFromPlainText("heading", ""),
      [
        { type: "text", text: "Sum", marks: [{ type: "strong" }] },
        {
          type: "text",
          text: "mary",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
      ],
    );
    const fixture = renderFixture();
    const initialSummary = fixture.editor.getBlock(summaryId)!;
    act(() => {
      expect(
        fixture.editor.executeStructuralTransaction({
          origin: "first-draft-test-marked-toggle-heading",
          operations: [
            replaceContent({
              blockId: summaryId,
              expectedContentVersion: initialSummary.contentVersion,
              value: {
                kind: "value",
                content: markedSummary,
                plainText: extractPlainTextFromRichTextDocument(markedSummary),
              },
            }),
          ],
        }).ok,
      ).toBe(true);
    });
    fixture.structural.mockClear();
    fixture.onChange.mockClear();
    const toggleId = id("fd-toggle-heading");
    const bodyId = id("fd-toggle-heading-body");
    const originalMetadata = fixture.editor.getBlock(summaryId)?.metadata;
    const originalBodyChildren = fixture.editor.getChildBlockIds(bodyId);
    const toggleShell = shell(fixture.container, toggleId);
    const summaryShell = shell(fixture.container, summaryId);
    const bodyShell = shell(fixture.container, bodyId);
    const bodyShells = originalBodyChildren.map((blockId) =>
      shell(fixture.container, blockId),
    );
    fixture.viewState.setBlockCollapsed(toggleId, true);
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, summaryId, 3, "Enter");

    const roots = fixture.editor.getRootBlockIds();
    const paragraphId = roots[roots.indexOf(toggleId) + 1]!;
    const paragraphShell = shell(fixture.container, paragraphId);
    expect(fixture.editor.getBlock(paragraphId)?.type).toBe("paragraph");
    expect(fixture.editor.readBlockPlainText(summaryId, "heading")).toBe("Sum");
    expect(fixture.editor.readBlockPlainText(paragraphId, "paragraph")).toBe(
      "mary",
    );
    expect(fixture.editor.getBlock(summaryId)?.metadata).toEqual(
      originalMetadata,
    );
    expect(
      JSON.stringify(fixture.editor.readBlockContent(summaryId, "heading")),
    ).toContain('"strong"');
    expect(
      JSON.stringify(fixture.editor.readBlockContent(paragraphId, "paragraph")),
    ).toContain('"link"');
    expect(fixture.editor.getChildBlockIds(bodyId)).toEqual(
      originalBodyChildren,
    );
    expect(fixture.viewState.isBlockCollapsed(toggleId)).toBe(true);
    expect(fixture.viewState.isBlockCollapsed(paragraphId)).toBe(false);
    expectDocumentCaret(fixture, paragraphId, 0);
    expect(document.activeElement).toBe(
      textRoot(fixture.container, paragraphId),
    );
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.onChange).toHaveBeenCalledTimes(1);

    act(() => expect(fixture.editor.undo().status).toBe("applied"));
    expect(fixture.editor.getBlock(paragraphId)).toBeNull();
    expect(fixture.editor.readBlockPlainText(summaryId, "heading")).toBe(
      "Summary",
    );
    expectDocumentCaret(fixture, summaryId, 3);
    expect(fixture.viewState.isBlockCollapsed(toggleId)).toBe(true);
    expect(fixture.onChange).toHaveBeenCalledTimes(2);
    expect(shell(fixture.container, toggleId)).toBe(toggleShell);
    expect(shell(fixture.container, summaryId)).toBe(summaryShell);
    expect(
      summaryShell.querySelectorAll("[data-editor-text-root='true']"),
    ).toHaveLength(1);
    expect(shell(fixture.container, bodyId)).toBe(bodyShell);

    act(() => expect(fixture.editor.redo().status).toBe("applied"));
    expect(fixture.editor.getBlock(paragraphId)?.type).toBe("paragraph");
    expect(fixture.editor.readBlockPlainText(summaryId, "heading")).toBe("Sum");
    expect(fixture.editor.readBlockPlainText(paragraphId, "paragraph")).toBe(
      "mary",
    );
    expectDocumentCaret(fixture, paragraphId, 0);
    expect(fixture.editor.getChildBlockIds(bodyId)).toEqual(
      originalBodyChildren,
    );
    expect(fixture.viewState.isBlockCollapsed(toggleId)).toBe(true);
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.onChange).toHaveBeenCalledTimes(3);
    expect(
      fixture.container.querySelectorAll(
        `[data-editor-block-shell="true"][data-editor-block-id="${paragraphId}"]`,
      ),
    ).toHaveLength(1);
    expect(shell(fixture.container, toggleId)).toBe(toggleShell);
    expect(shell(fixture.container, summaryId)).toBe(summaryShell);
    expect(
      summaryShell.querySelectorAll("[data-editor-text-root='true']"),
    ).toHaveLength(1);
    expect(shell(fixture.container, bodyId)).toBe(bodyShell);
    originalBodyChildren.forEach((blockId, index) => {
      expect(shell(fixture.container, blockId)).toBe(bodyShells[index]);
    });
    expect(paragraphShell.isConnected).toBe(false);
  });

  it.each([
    {
      kind: "toggle heading",
      toggleId: id("fd-toggle-heading"),
      summaryId: id("fd-toggle-heading-summary"),
      summaryType: "heading",
      bodyId: id("fd-toggle-heading-body"),
    },
    {
      kind: "toggle list item",
      toggleId: id("fd-toggle-list"),
      summaryId: id("fd-toggle-list-summary"),
      summaryType: "paragraph",
      bodyId: id("fd-toggle-list-body"),
    },
  ] as const)(
    "routes expanded $kind summary Enter into the existing body without remounting it",
    ({ toggleId, summaryId, summaryType, bodyId }) => {
      const fixture = renderFixture();
      const bodyShell = shell(fixture.container, bodyId);
      const oldBodyChildren = fixture.editor.getChildBlockIds(bodyId);
      const summary = fixture.editor.readBlockPlainText(summaryId, summaryType);

      pressBoundaryKey(fixture, summaryId, 5, "Enter");
      expect(fixture.structural).toHaveBeenCalledTimes(1);
      expect(fixture.structural.mock.results[0]?.value).toMatchObject({
        ok: true,
      });

      const bodyChildren = fixture.editor.getChildBlockIds(bodyId);
      expect(bodyChildren).toHaveLength(oldBodyChildren.length + 1);
      const insertedId = bodyChildren[0]!;
      expect(fixture.editor.getBlock(insertedId)?.type).toBe("paragraph");
      expect(fixture.editor.readBlockPlainText(insertedId, "paragraph")).toBe(
        summary.slice(5),
      );
      expect(bodyChildren.slice(1)).toEqual(oldBodyChildren);
      expect(shell(fixture.container, bodyId)).toBe(bodyShell);
      expect(fixture.viewState.isBlockCollapsed(toggleId)).toBe(false);
      expect(fixture.structural).toHaveBeenCalledTimes(1);
      expect(fixture.onChange).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(
        textRoot(fixture.container, insertedId),
      );
    },
  );

  it("joins ordinary boundaries and skips hidden toggle descendants", () => {
    const backspace = renderFixture();
    const leftId = id("fd-paragraph-outro");
    const rightId = id("fd-empty-final");
    const leftText = backspace.editor.readBlockPlainText(leftId, "paragraph");
    pressBoundaryKey(backspace, rightId, 0, "Backspace");
    expect(backspace.structural).toHaveBeenCalledTimes(1);
    const backspaceResult = backspace.structural.mock.results[0]?.value;
    if (!backspaceResult?.ok) {
      throw new Error(JSON.stringify(backspaceResult));
    }
    expect(backspace.editor.getBlock(rightId)).toBeNull();
    expect(backspace.editor.readBlockPlainText(leftId, "paragraph")).toBe(
      leftText,
    );
    expect(backspace.onChange).toHaveBeenCalledTimes(1);

    const collapsedDelete = renderFixture();
    const toggleId = id("fd-toggle-list");
    const summaryId = id("fd-toggle-list-summary");
    const bodyId = id("fd-toggle-list-body");
    const followingId = id("fd-paragraph-after-toggle-list");
    const hiddenBodyIds = collapsedDelete.editor.getChildBlockIds(bodyId);
    collapsedDelete.viewState.setBlockCollapsed(toggleId, true);
    const summaryLength = collapsedDelete.editor.readBlockPlainText(
      summaryId,
      "paragraph",
    ).length;
    collapsedDelete.onChange.mockClear();
    pressBoundaryKey(collapsedDelete, summaryId, summaryLength, "Delete");
    expect(collapsedDelete.structural).toHaveBeenCalledTimes(1);
    const collapsedDeleteResult =
      collapsedDelete.structural.mock.results[0]?.value;
    if (!collapsedDeleteResult?.ok) {
      throw new Error(JSON.stringify(collapsedDeleteResult));
    }
    expect(collapsedDelete.editor.getBlock(followingId)).toBeNull();
    expect(collapsedDelete.editor.getChildBlockIds(bodyId)).toEqual(
      hiddenBodyIds,
    );
    expect(collapsedDelete.onChange).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(
      textRoot(collapsedDelete.container, summaryId),
    );
  });

  it.each([
    { key: "Backspace" as const, focused: "right" as const },
    { key: "Delete" as const, focused: "left" as const },
  ])(
    "$key explicitly joins text siblings inside a column content boundary",
    ({ key, focused }) => {
      const fixture = renderFixture();
      const columnsId = id("fd-columns");
      const columnId = id("fd-column-left");
      const leftId = id("fd-column-left-heading");
      const rightId = id("fd-column-left-text");
      const leftText = fixture.editor.readBlockPlainText(leftId, "heading");
      const rightText = fixture.editor.readBlockPlainText(rightId, "paragraph");
      const columnShell = shell(fixture.container, columnId);
      fixture.structural.mockClear();
      fixture.onChange.mockClear();

      pressBoundaryKey(
        fixture,
        focused === "right" ? rightId : leftId,
        focused === "right" ? 0 : leftText.length,
        key,
      );

      expect(fixture.structural).toHaveBeenCalledOnce();
      expect(fixture.structural.mock.calls[0]?.[0]).toMatchObject({
        origin:
          key === "Backspace" ? "first-draft-backspace" : "first-draft-delete",
      });
      expect(fixture.structural.mock.calls[0]?.[0].operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "replaceContent", blockId: leftId }),
          expect.objectContaining({
            kind: "removeBlocks",
            blockIds: [rightId],
          }),
        ]),
      );
      expect(
        fixture.structural.mock.calls[0]?.[0].operations.some(
          (operation) => operation.kind === "joinTextBlocks",
        ),
      ).toBe(false);
      expect(fixture.editor.readBlockPlainText(leftId, "heading")).toBe(
        leftText + rightText,
      );
      expect(fixture.editor.getBlock(rightId)).toBeNull();
      expect(fixture.editor.getChildBlockIds(columnId)).toEqual([leftId]);
      expect(fixture.editor.getBlock(columnId)?.type).toBe("column");
      expect(fixture.editor.getBlock(columnsId)?.type).toBe("columns");
      expect(shell(fixture.container, columnId)).toBe(columnShell);
      expectDocumentCaret(fixture, leftId, leftText.length);
      expect(document.activeElement).toBe(textRoot(fixture.container, leftId));
      expect(fixture.onChange).toHaveBeenCalledOnce();
    },
  );

  it("removes an empty final column sibling without changing the survivor text", () => {
    const fixture = renderFixture();
    const columnId = id("fd-column-left");
    const leftId = id("fd-column-left-heading");
    const rightId = id("fd-column-left-text");
    const leftText = fixture.editor.readBlockPlainText(leftId, "heading");
    eraseText(fixture, rightId);
    fixture.structural.mockClear();
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, rightId, 0, "Backspace");

    expect(fixture.editor.readBlockPlainText(leftId, "heading")).toBe(leftText);
    expect(fixture.editor.getBlock(rightId)).toBeNull();
    expect(fixture.editor.getChildBlockIds(columnId)).toEqual([leftId]);
    expect(fixture.structural).toHaveBeenCalledOnce();
    expect(fixture.onChange).toHaveBeenCalledOnce();
    expectDocumentCaret(fixture, leftId, leftText.length);
  });

  it("preserves donor inline marks in an explicit column-boundary merge", () => {
    const fixture = renderFixture();
    const leftId = id("fd-column-left-heading");
    const rightId = id("fd-column-left-text");
    const leftText = fixture.editor.readBlockPlainText(leftId, "heading");
    const marked = richTextDocumentWithInlineContent(
      "paragraph",
      createBlockRichTextContentFromPlainText("paragraph", ""),
      [{ type: "text", text: "marked donor", marks: [{ type: "strong" }] }],
    );
    const right = fixture.editor.getBlock(rightId)!;
    act(() => {
      expect(
        fixture.editor.executeStructuralTransaction({
          origin: "first-draft-marked-column-donor-test-setup",
          operations: [
            replaceContent({
              blockId: rightId,
              expectedContentVersion: right.contentVersion,
              value: {
                kind: "value",
                content: marked,
                plainText: "marked donor",
              },
            }),
          ],
        }).ok,
      ).toBe(true);
    });
    fixture.structural.mockClear();
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, rightId, 0, "Backspace");

    expect(fixture.editor.readBlockPlainText(leftId, "heading")).toBe(
      `${leftText}marked donor`,
    );
    expect(
      JSON.stringify(fixture.editor.readBlockContent(leftId, "heading")),
    ).toContain('"strong"');
    expect(fixture.editor.getBlock(rightId)).toBeNull();
    expectDocumentCaret(fixture, leftId, leftText.length);
    expect(fixture.onChange).toHaveBeenCalledOnce();
  });

  it("retains a donor column when another direct block remains", () => {
    const fixture = renderFixture();
    const columnsId = id("fd-columns");
    const rightColumnId = id("fd-column-right");
    const rightHeadingId = id("fd-column-right-heading");
    const rightTextId = id("fd-column-right-text");
    const leftTextId = id("fd-column-left-text");
    const leftText = fixture.editor.readBlockPlainText(leftTextId, "paragraph");
    const rightHeading = fixture.editor.readBlockPlainText(
      rightHeadingId,
      "heading",
    );
    fixture.structural.mockClear();
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, rightHeadingId, 0, "Backspace");

    expect(fixture.editor.getBlock(columnsId)?.type).toBe("columns");
    expect(fixture.editor.getBlock(rightColumnId)?.type).toBe("column");
    expect(fixture.editor.getChildBlockIds(rightColumnId)).toEqual([
      rightTextId,
    ]);
    expect(fixture.editor.getBlock(rightHeadingId)).toBeNull();
    expect(fixture.editor.readBlockPlainText(leftTextId, "paragraph")).toBe(
      leftText + rightHeading,
    );
    expectDocumentCaret(fixture, leftTextId, leftText.length);
    expect(fixture.onChange).toHaveBeenCalledOnce();
  });

  it("unwraps a two-column layout when a sole later-lane block is consumed", () => {
    const fixture = renderFixture();
    const columnsId = id("fd-columns");
    const leftColumnId = id("fd-column-left");
    const rightColumnId = id("fd-column-right");
    const leftHeadingId = id("fd-column-left-heading");
    const leftTextId = id("fd-column-left-text");
    const rightHeadingId = id("fd-column-right-heading");
    const rightTextId = id("fd-column-right-text");
    removeForTest(fixture, [leftHeadingId, rightHeadingId]);
    const originalRoots = fixture.editor.getRootBlockIds();
    const columnsIndex = originalRoots.indexOf(columnsId);
    const leftText = fixture.editor.readBlockPlainText(leftTextId, "paragraph");
    const rightText = fixture.editor.readBlockPlainText(
      rightTextId,
      "paragraph",
    );
    const leftMetadata = fixture.editor.getBlock(leftColumnId)?.metadata;
    const rightMetadata = fixture.editor.getBlock(rightColumnId)?.metadata;
    fixture.structural.mockClear();
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, rightTextId, 0, "Backspace");

    expect(fixture.editor.getBlock(columnsId)).toBeNull();
    expect(fixture.editor.getBlock(leftColumnId)).toBeNull();
    expect(fixture.editor.getBlock(rightColumnId)).toBeNull();
    expect(fixture.editor.getBlock(rightTextId)).toBeNull();
    expect(fixture.editor.getRootBlockIds()[columnsIndex]).toBe(leftTextId);
    expect(fixture.editor.readBlockPlainText(leftTextId, "paragraph")).toBe(
      leftText + rightText,
    );
    expectDocumentCaret(fixture, leftTextId, leftText.length);
    expect(document.activeElement).toBe(
      textRoot(fixture.container, leftTextId),
    );
    expect(fixture.structural).toHaveBeenCalledOnce();
    expect(fixture.onChange).toHaveBeenCalledOnce();

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getRootBlockIds()).toEqual(originalRoots);
    expect(fixture.editor.getChildBlockIds(columnsId)).toEqual([
      leftColumnId,
      rightColumnId,
    ]);
    expect(fixture.editor.getChildBlockIds(leftColumnId)).toEqual([leftTextId]);
    expect(fixture.editor.getChildBlockIds(rightColumnId)).toEqual([
      rightTextId,
    ]);
    expect(fixture.editor.getBlock(leftColumnId)?.metadata).toEqual(
      leftMetadata,
    );
    expect(fixture.editor.getBlock(rightColumnId)?.metadata).toEqual(
      rightMetadata,
    );
    expect(fixture.editor.readBlockPlainText(leftTextId, "paragraph")).toBe(
      leftText,
    );
    expect(fixture.editor.readBlockPlainText(rightTextId, "paragraph")).toBe(
      rightText,
    );

    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getBlock(columnsId)).toBeNull();
    expect(fixture.editor.getRootBlockIds()[columnsIndex]).toBe(leftTextId);
  });

  it("resolves the surviving lane when Delete consumes the sole first-column block", () => {
    const fixture = renderFixture();
    const columnsId = id("fd-columns");
    const leftColumnId = id("fd-column-left");
    const rightColumnId = id("fd-column-right");
    const leftHeadingId = id("fd-column-left-heading");
    const leftTextId = id("fd-column-left-text");
    const rightChildren = fixture.editor.getChildBlockIds(rightColumnId);
    const beforeId = id("fd-paragraph-layouts");
    removeForTest(fixture, [leftHeadingId]);
    const beforeText = fixture.editor.readBlockPlainText(beforeId, "paragraph");
    const donorText = fixture.editor.readBlockPlainText(
      leftTextId,
      "paragraph",
    );
    const columnsIndex = fixture.editor.getRootBlockIds().indexOf(columnsId);
    fixture.structural.mockClear();
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, beforeId, beforeText.length, "Delete");

    expect(fixture.editor.getBlock(columnsId)).toBeNull();
    expect(fixture.editor.getBlock(leftColumnId)).toBeNull();
    expect(fixture.editor.getBlock(rightColumnId)).toBeNull();
    expect(fixture.editor.getBlock(leftTextId)).toBeNull();
    expect(fixture.editor.readBlockPlainText(beforeId, "paragraph")).toBe(
      beforeText + donorText,
    );
    expect(
      fixture.editor
        .getRootBlockIds()
        .slice(columnsIndex, columnsIndex + rightChildren.length),
    ).toEqual(rightChildren);
    expectDocumentCaret(fixture, beforeId, beforeText.length);
    expect(fixture.structural).toHaveBeenCalledOnce();
    expect(fixture.onChange).toHaveBeenCalledOnce();
  });

  it("removes only an emptied lane from a three-column layout", () => {
    const fixture = renderFixture();
    const columnsId = id("fd-columns");
    const leftColumnId = id("fd-column-left");
    const rightColumnId = id("fd-column-right");
    const rightHeadingId = id("fd-column-right-heading");
    const rightTextId = id("fd-column-right-text");
    let insertion!: ReturnType<typeof fixture.editor.insertBlockAt>;
    act(() => {
      insertion = fixture.editor.insertBlockAt({
        placement: { parentId: columnsId, childIndex: 2 },
        blockType: "column",
        selection: false,
      });
    });
    if (!insertion.ok) throw new Error("Failed to add third column");
    const thirdColumnId = fixture.editor.getChildBlockIds(columnsId)[2]!;
    const thirdChildren = fixture.editor.getChildBlockIds(thirdColumnId);
    const leftMetadata = fixture.editor.getBlock(leftColumnId)?.metadata;
    const thirdMetadata = fixture.editor.getBlock(thirdColumnId)?.metadata;
    removeForTest(fixture, [rightHeadingId]);
    fixture.structural.mockClear();
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, rightTextId, 0, "Backspace");

    expect(fixture.editor.getBlock(columnsId)?.type).toBe("columns");
    expect(fixture.editor.getChildBlockIds(columnsId)).toEqual([
      leftColumnId,
      thirdColumnId,
    ]);
    expect(fixture.editor.getBlock(rightColumnId)).toBeNull();
    expect(fixture.editor.getBlock(rightTextId)).toBeNull();
    expect(fixture.editor.getBlock(leftColumnId)?.metadata).toEqual(
      leftMetadata,
    );
    expect(fixture.editor.getBlock(thirdColumnId)?.metadata).toEqual(
      thirdMetadata,
    );
    expect(fixture.editor.getChildBlockIds(thirdColumnId)).toEqual(
      thirdChildren,
    );
    expect(fixture.structural).toHaveBeenCalledOnce();
    expect(fixture.onChange).toHaveBeenCalledOnce();

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(columnsId)).toEqual([
      leftColumnId,
      rightColumnId,
      thirdColumnId,
    ]);
    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(columnsId)).toEqual([
      leftColumnId,
      thirdColumnId,
    ]);
  });

  it("applies the same empty-column cleanup when the final direct root is a wrapper", () => {
    const fixture = renderFixture();
    const columnsId = id("fd-columns");
    const rightColumnId = id("fd-column-right");
    const rightHeadingId = id("fd-column-right-heading");
    const rightTextId = id("fd-column-right-text");
    const leftTextId = id("fd-column-left-text");
    let insertion!: ReturnType<typeof fixture.editor.insertBlockAt>;
    act(() => {
      insertion = fixture.editor.insertBlockAt({
        placement: { parentId: rightColumnId, childIndex: 2 },
        blockType: "callout",
        selection: false,
      });
    });
    if (!insertion.ok) throw new Error("Failed to add callout donor");
    const calloutId = fixture.editor.getChildBlockIds(rightColumnId)[2]!;
    const calloutTextId = fixture.editor.getChildBlockIds(calloutId)[0]!;
    removeForTest(fixture, [rightHeadingId, rightTextId]);
    expect(fixture.editor.getChildBlockIds(rightColumnId)).toEqual([calloutId]);
    fixture.structural.mockClear();
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, calloutTextId, 0, "Backspace");

    expect(fixture.editor.getBlock(calloutTextId)).toBeNull();
    expect(fixture.editor.getBlock(calloutId)).toBeNull();
    expect(fixture.editor.getBlock(rightColumnId)).toBeNull();
    expect(fixture.editor.getBlock(columnsId)).toBeNull();
    expect(fixture.editor.getBlock(leftTextId)).toMatchObject({
      type: "paragraph",
      parentId: null,
    });
    expect(fixture.structural).toHaveBeenCalledOnce();
    expect(fixture.onChange).toHaveBeenCalledOnce();
  });

  it("joins the first expanded toggle-body block into its summary and leaves an empty body", () => {
    const fixture = renderFixture();
    const summaryId = id("fd-toggle-heading-summary");
    const bodyId = id("fd-toggle-heading-body");
    const firstBodyId = id("fd-toggle-heading-body-text");
    const remainingBodyId = id("fd-toggle-heading-body-detail");
    const summaryText = fixture.editor.readBlockPlainText(summaryId, "heading");
    const bodyText = fixture.editor.readBlockPlainText(
      firstBodyId,
      "paragraph",
    );

    pressBoundaryKey(fixture, firstBodyId, 0, "Backspace");

    expect(fixture.editor.getBlock(firstBodyId)).toBeNull();
    expect(fixture.editor.getChildBlockIds(bodyId)).toEqual([remainingBodyId]);
    expect(fixture.editor.readBlockPlainText(summaryId, "heading")).toBe(
      summaryText + bodyText,
    );
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.onChange).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(textRoot(fixture.container, summaryId));
  });

  it("joins the sole toggle-list body paragraph into its summary and keeps the body empty", () => {
    const fixture = renderFixture();
    const summaryId = id("fd-toggle-list-summary");
    const bodyId = id("fd-toggle-list-body");
    const bodyTextId = id("fd-toggle-list-body-text");
    const summaryText = fixture.editor.readBlockPlainText(
      summaryId,
      "paragraph",
    );
    const bodyText = fixture.editor.readBlockPlainText(bodyTextId, "paragraph");

    pressBoundaryKey(fixture, bodyTextId, 0, "Backspace");

    expect(fixture.editor.getChildBlockIds(bodyId)).toEqual([]);
    expect(fixture.editor.getBlock(bodyTextId)).toBeNull();
    expect(fixture.editor.readBlockPlainText(summaryId, "paragraph")).toBe(
      summaryText + bodyText,
    );
    expect(fixture.onChange).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(textRoot(fixture.container, summaryId));
    expect(
      shell(fixture.container, bodyId).querySelector(
        ".empty-wrapper-add-text-button",
      ),
    ).not.toBeNull();

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(bodyId)).toEqual([bodyTextId]);
    expect(
      shell(fixture.container, bodyId).querySelector(
        ".empty-wrapper-add-text-button",
      ),
    ).toBeNull();
    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(bodyId)).toEqual([]);
  });

  it.each([
    {
      name: "Backspace in the empty active-pane block",
      focusedId: id("fd-tab-overview-text"),
      key: "Backspace" as const,
      focusOffset: 0,
      settledId: id("fd-paragraph-tabs"),
      settledOffset: "end" as const,
    },
    {
      name: "Delete from the block before tabs",
      focusedId: id("fd-paragraph-tabs"),
      key: "Delete" as const,
      focusOffset: "end" as const,
      settledId: id("fd-paragraph-tabs"),
      settledOffset: "end" as const,
    },
    {
      name: "Delete in the empty active-pane block",
      focusedId: id("fd-tab-overview-text"),
      key: "Delete" as const,
      focusOffset: 0,
      settledId: id("fd-paragraph-after-tabs"),
      settledOffset: 0,
    },
    {
      name: "Backspace from the block after tabs",
      focusedId: id("fd-paragraph-after-tabs"),
      key: "Backspace" as const,
      focusOffset: 0,
      settledId: id("fd-paragraph-after-tabs"),
      settledOffset: 0,
    },
  ])(
    "$name removes only the final empty pane child",
    ({ focusedId, key, focusOffset, settledId, settledOffset }) => {
      const fixture = renderFixture();
      const tabsId = id("fd-tabs");
      const paneId = id("fd-tab-overview");
      const contentId = id("fd-tab-overview-text");
      const paneIds = fixture.editor.getChildBlockIds(tabsId);
      const paneMetadata = paneIds.map(
        (candidateId) => fixture.editor.getBlock(candidateId)?.metadata,
      );
      const inactiveContents = paneIds
        .slice(1)
        .map((candidateId) => fixture.editor.getChildBlockIds(candidateId));
      eraseText(fixture, contentId);
      fixture.structural.mockClear();
      fixture.onChange.mockClear();
      const tabsShell = shell(fixture.container, tabsId);
      const paneShell = shell(fixture.container, paneId);
      const resolvedFocusOffset =
        focusOffset === "end"
          ? fixture.editor.readBlockPlainText(focusedId, "paragraph").length
          : focusOffset;

      pressBoundaryKey(fixture, focusedId, resolvedFocusOffset, key);

      expect(fixture.editor.getBlock(tabsId)?.type).toBe("tabs");
      expect(fixture.editor.getChildBlockIds(tabsId)).toEqual(paneIds);
      expect(fixture.editor.getChildBlockIds(paneId)).toEqual([]);
      expect(fixture.editor.getBlock(contentId)).toBeNull();
      expect(
        paneIds.map(
          (candidateId) => fixture.editor.getBlock(candidateId)?.metadata,
        ),
      ).toEqual(paneMetadata);
      expect(
        paneIds
          .slice(1)
          .map((candidateId) => fixture.editor.getChildBlockIds(candidateId)),
      ).toEqual(inactiveContents);
      expect(shell(fixture.container, tabsId)).toBe(tabsShell);
      expect(shell(fixture.container, paneId)).toBe(paneShell);
      expect(
        paneShell.querySelector(".empty-wrapper-add-text-button"),
      ).not.toBeNull();
      expect(fixture.structural).toHaveBeenCalledOnce();
      expect(fixture.onChange).toHaveBeenCalledOnce();
      const resolvedSettledOffset =
        settledOffset === "end"
          ? fixture.editor.readBlockPlainText(settledId, "paragraph").length
          : settledOffset;
      expectDocumentCaret(fixture, settledId, resolvedSettledOffset);
      expect(document.activeElement).toBe(
        textRoot(fixture.container, settledId),
      );

      act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
      expect(fixture.editor.getChildBlockIds(paneId)).toEqual([contentId]);
      expect(fixture.editor.getBlock(contentId)?.parentId).toBe(paneId);
      act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
      expect(fixture.editor.getChildBlockIds(paneId)).toEqual([]);
      expect(fixture.editor.getChildBlockIds(tabsId)).toEqual(paneIds);
    },
  );

  it("guards both nonempty outer tabs boundaries without a transaction", () => {
    const fixture = renderFixture();
    const tabsId = id("fd-tabs");
    const paneIds = fixture.editor.getChildBlockIds(tabsId);
    const activeChildren = fixture.editor.getChildBlockIds(
      id("fd-tab-overview"),
    );
    fixture.structural.mockClear();
    fixture.onChange.mockClear();

    const beforeId = id("fd-paragraph-tabs");
    pressBoundaryKey(
      fixture,
      beforeId,
      fixture.editor.readBlockPlainText(beforeId, "paragraph").length,
      "Delete",
    );
    const afterId = id("fd-paragraph-after-tabs");
    pressBoundaryKey(fixture, afterId, 0, "Backspace");

    expect(fixture.structural).not.toHaveBeenCalled();
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(fixture.editor.getChildBlockIds(tabsId)).toEqual(paneIds);
    expect(fixture.editor.getChildBlockIds(id("fd-tab-overview"))).toEqual(
      activeChildren,
    );
  });

  it("removes multiple active-pane children independently and preserves their order", () => {
    const fixture = renderFixture();
    const tabsId = id("fd-tabs");
    const paneId = id("fd-tab-overview");
    const originalId = id("fd-tab-overview-text");
    let insertion!: ReturnType<typeof fixture.editor.insertBlockAt>;
    act(() => {
      insertion = fixture.editor.insertBlockAt({
        placement: { parentId: paneId, childIndex: 1 },
        blockType: "paragraph",
        selection: false,
      });
    });
    if (!insertion.ok) {
      throw new Error("Failed to add second pane paragraph");
    }
    const secondId = fixture.editor.getChildBlockIds(paneId)[1]!;
    expect(fixture.editor.getChildBlockIds(paneId)).toEqual([
      originalId,
      secondId,
    ]);
    fixture.structural.mockClear();
    fixture.onChange.mockClear();

    pressBoundaryKey(fixture, secondId, 0, "Delete");

    expect(fixture.editor.getChildBlockIds(paneId)).toEqual([originalId]);
    expect(fixture.editor.getBlock(secondId)).toBeNull();
    expect(fixture.editor.getBlock(tabsId)?.type).toBe("tabs");
    expect(fixture.onChange).toHaveBeenCalledOnce();

    eraseText(fixture, originalId);
    fixture.structural.mockClear();
    fixture.onChange.mockClear();
    pressBoundaryKey(fixture, originalId, 0, "Backspace");
    expect(fixture.editor.getChildBlockIds(paneId)).toEqual([]);
    expect(
      shell(fixture.container, paneId).querySelector(
        ".empty-wrapper-add-text-button",
      ),
    ).not.toBeNull();
    expect(fixture.onChange).toHaveBeenCalledOnce();
  });

  it("deletes a whole-block selection from a pane without deleting its structure", () => {
    const fixture = renderFixture();
    const tabsId = id("fd-tabs");
    const paneId = id("fd-tab-overview");
    const contentId = id("fd-tab-overview-text");
    const content = fixture.editor.getBlock(contentId);
    if (!content) throw new Error("Missing active-pane content");
    const range: StructuralEditRange = {
      graphRevision: fixture.editor.getSelectionGraphRevision(),
      selectionRevision: 0,
      blocks: [
        {
          kind: "block",
          blockId: content.id,
          blockType: content.type,
          parentId: paneId,
        },
      ],
      start: { kind: "block", blockId: content.id },
      end: { kind: "block", blockId: content.id },
    };
    fixture.onChange.mockClear();
    let deletion: ReturnType<
      typeof fixture.editor.executeStructuralRangeDeletion
    > | null = null;

    act(() => {
      deletion = fixture.editor.executeStructuralRangeDeletion(range, {
        intent: "delete",
        provenance: null,
        selectionPresentation: "native-final-selection",
      });
    });

    expect(deletion).toMatchObject({ ok: true });
    expect(fixture.editor.getBlock(tabsId)?.type).toBe("tabs");
    expect(fixture.editor.getBlock(paneId)?.type).toBe("tabPane");
    expect(fixture.editor.getChildBlockIds(paneId)).toEqual([]);
    expect(fixture.editor.getBlock(contentId)).toBeNull();
    expect(
      shell(fixture.container, paneId).querySelector(
        ".empty-wrapper-add-text-button",
      ),
    ).not.toBeNull();
    expect(fixture.onChange).toHaveBeenCalledOnce();

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(paneId)).toEqual([contentId]);
    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(paneId)).toEqual([]);
    expect(fixture.editor.getBlock(tabsId)?.type).toBe("tabs");
  });

  it("still permits deliberate deletion of the complete outer tabs block", () => {
    const fixture = renderFixture();
    const tabsId = id("fd-tabs");
    const paneIds = fixture.editor.getChildBlockIds(tabsId);
    fixture.onChange.mockClear();

    const deletion = fixture.editor.deleteBlock({ blockId: tabsId });

    expect(deletion.ok).toBe(true);
    expect(fixture.editor.getBlock(tabsId)).toBeNull();
    paneIds.forEach((paneId) => {
      expect(fixture.editor.getBlock(paneId)).toBeNull();
    });
    expect(fixture.onChange).toHaveBeenCalledOnce();
  });

  it("isolates active-pane deletion across multiple editor instances", () => {
    const left = renderFixture();
    const right = renderFixture();
    const paneId = id("fd-tab-overview");
    const contentId = id("fd-tab-overview-text");
    const rightChildren = right.editor.getChildBlockIds(paneId);
    const rightTabs = right.editor.getChildBlockIds(id("fd-tabs"));

    eraseText(left, contentId);
    left.onChange.mockClear();
    right.onChange.mockClear();
    pressBoundaryKey(left, contentId, 0, "Backspace");

    expect(left.editor.getChildBlockIds(paneId)).toEqual([]);
    expect(right.editor.getChildBlockIds(paneId)).toEqual(rightChildren);
    expect(right.editor.getChildBlockIds(id("fd-tabs"))).toEqual(rightTabs);
    expect(right.editor.getBlock(contentId)?.parentId).toBe(paneId);
    expect(left.onChange).toHaveBeenCalledOnce();
    expect(right.onChange).not.toHaveBeenCalled();
  });

  it.each([
    {
      summaryId: id("fd-toggle-heading-summary"),
      summaryType: "heading" as const,
      bodyId: id("fd-toggle-heading-body"),
    },
    {
      summaryId: id("fd-toggle-list-summary"),
      summaryType: "paragraph" as const,
      bodyId: id("fd-toggle-list-body"),
    },
  ])(
    "enters from an expanded $summaryType summary into an empty body in one transaction",
    ({ summaryId, summaryType, bodyId }) => {
      const fixture = renderFixture();
      const oldChildren = fixture.editor.getChildBlockIds(bodyId);
      act(() => {
        expect(
          fixture.editor.transaction(() => {
            fixture.editor.deleteBlocks({
              blockIds: oldChildren,
              includeDescendants: true,
              expectedParents: Object.fromEntries(
                oldChildren.map((blockId) => [blockId, bodyId]),
              ),
            });
            fixture.editor.setTransactionSelection({ kind: "clear" });
          }).ok,
        ).toBe(true);
      });
      fixture.structural.mockClear();
      fixture.onChange.mockClear();
      const offset = Math.min(
        3,
        fixture.editor.readBlockPlainText(summaryId, summaryType).length,
      );

      pressBoundaryKey(fixture, summaryId, offset, "Enter");

      const children = fixture.editor.getChildBlockIds(bodyId);
      expect(children).toHaveLength(1);
      const paragraphId = children[0]!;
      expect(fixture.editor.getBlock(paragraphId)?.type).toBe("paragraph");
      expect(fixture.structural).toHaveBeenCalledOnce();
      expect(fixture.onChange).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(
        textRoot(fixture.container, paragraphId),
      );
      act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
      expect(fixture.editor.getChildBlockIds(bodyId)).toEqual([]);
      act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
      expect(fixture.editor.getChildBlockIds(bodyId)).toEqual([paragraphId]);
    },
  );

  it("splits, indents, outdents, and exits First Draft list items atomically", () => {
    const fixture = renderFixture();
    const listId = id("fd-bullet-list");
    const firstItemId = id("fd-bullet-1");
    const secondItemId = id("fd-bullet-2");
    const secondTextId = id("fd-bullet-2-text");
    const secondText = fixture.editor.readBlockPlainText(
      secondTextId,
      "paragraph",
    );

    pressBoundaryKey(fixture, secondTextId, 6, "Enter");
    let listChildren = fixture.editor.getChildBlockIds(listId);
    const splitItemId = listChildren[listChildren.indexOf(secondItemId) + 1]!;
    expect(fixture.editor.getBlock(splitItemId)?.type).toBe("bulletListItem");
    const splitTextId = fixture.editor.getChildBlockIds(splitItemId)[0]!;
    expect(fixture.editor.readBlockPlainText(secondTextId, "paragraph")).toBe(
      secondText.slice(0, 6),
    );
    expect(fixture.editor.readBlockPlainText(splitTextId, "paragraph")).toBe(
      secondText.slice(6),
    );
    expect(fixture.structural).toHaveBeenCalledTimes(1);

    fixture.structural.mockClear();
    fixture.onChange.mockClear();
    pressBoundaryKey(fixture, secondTextId, 0, "Tab");
    const nestedListId = fixture.editor
      .getChildBlockIds(firstItemId)
      .find(
        (blockId) => fixture.editor.getBlock(blockId)?.type === "bulletList",
      );
    expect(nestedListId).toBeDefined();
    expect(fixture.editor.getChildBlockIds(nestedListId!)).toEqual([
      secondItemId,
    ]);
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.onChange).toHaveBeenCalledTimes(1);

    fixture.structural.mockClear();
    fixture.onChange.mockClear();
    pressBoundaryKey(fixture, secondTextId, 0, "Shift-Tab");
    expect(fixture.editor.getBlock(nestedListId!)).toBeNull();
    listChildren = fixture.editor.getChildBlockIds(listId);
    expect(listChildren.indexOf(secondItemId)).toBe(
      listChildren.indexOf(firstItemId) + 1,
    );
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.onChange).toHaveBeenCalledTimes(1);

    fixture.editor.transaction(() => {
      expect(
        fixture.editor.deleteText({
          blockId: splitTextId,
          range: {
            from: 0,
            to: fixture.editor.readBlockPlainText(splitTextId, "paragraph")
              .length,
          },
        }),
      ).toBe(true);
      fixture.editor.setTransactionSelection({ kind: "preserve" });
    });
    fixture.structural.mockClear();
    fixture.onChange.mockClear();
    pressBoundaryKey(fixture, splitTextId, 0, "Enter");
    expect(fixture.editor.getBlock(splitItemId)).toBeNull();
    expect(fixture.editor.getBlock(splitTextId)).toMatchObject({
      type: "paragraph",
      parentId: null,
    });
    expect(fixture.editor.getRootBlockIds()).toContain(splitTextId);
    expect(fixture.structural).toHaveBeenCalledTimes(1);
    expect(fixture.onChange).toHaveBeenCalledTimes(1);
  });

  it("exits empty list items at the beginning, middle, and end without losing either partition", () => {
    const cases = [
      {
        itemId: id("fd-bullet-1"),
        textId: id("fd-bullet-1-text"),
        leading: [] as BlockId[],
        trailing: [id("fd-bullet-2"), id("fd-bullet-nested")],
      },
      {
        itemId: id("fd-bullet-2"),
        textId: id("fd-bullet-2-text"),
        leading: [id("fd-bullet-1")],
        trailing: [id("fd-bullet-nested")],
      },
      {
        itemId: id("fd-bullet-nested"),
        textId: id("fd-bullet-nested-text"),
        leading: [id("fd-bullet-1"), id("fd-bullet-2")],
        trailing: [] as BlockId[],
      },
    ];

    for (const testCase of cases) {
      const fixture = renderFixture();
      const listId = id("fd-bullet-list");
      const originalRootIndex = fixture.editor
        .getRootBlockIds()
        .indexOf(listId);
      eraseText(fixture, testCase.textId);
      fixture.structural.mockClear();
      fixture.onChange.mockClear();

      pressBoundaryKey(fixture, testCase.textId, 0, "Enter");

      expect(fixture.editor.getBlock(testCase.itemId)).toBeNull();
      expect(fixture.editor.getBlock(testCase.textId)).toMatchObject({
        type: "paragraph",
        parentId: null,
      });
      expect(fixture.structural).toHaveBeenCalledTimes(1);
      expect(fixture.onChange).toHaveBeenCalledTimes(1);
      const roots = fixture.editor.getRootBlockIds();
      const exitedIndex = roots.indexOf(testCase.textId);
      if (testCase.leading.length === 0) {
        expect(exitedIndex).toBe(originalRootIndex);
        expect(fixture.editor.getChildBlockIds(listId)).toEqual(
          testCase.trailing,
        );
      } else {
        expect(fixture.editor.getChildBlockIds(listId)).toEqual(
          testCase.leading,
        );
        expect(exitedIndex).toBe(originalRootIndex + 1);
      }
      if (testCase.trailing.length > 0 && testCase.leading.length > 0) {
        const trailingListId = roots[exitedIndex + 1]!;
        expect(fixture.editor.getBlock(trailingListId)?.type).toBe(
          "bulletList",
        );
        expect(fixture.editor.getChildBlockIds(trailingListId)).toEqual(
          testCase.trailing,
        );
      }
      expect(fixture.editor.undo().status).toBe("applied");
      expect(fixture.editor.getChildBlockIds(listId)).toEqual([
        id("fd-bullet-1"),
        id("fd-bullet-2"),
        id("fd-bullet-nested"),
      ]);
      fixture.unmount();
      fixture.editor.dispose();
    }
  });
});

function renderFixture() {
  const onChange = vi.fn();
  const viewState = createFirstDraftViewStateStore();
  const editor = addEditorBlockOperations(
    initializeTestEditableEditor({
      definition: createFirstDraftEditorDefinition(viewState),
      snapshot: createFirstDraftSnapshot(),
      onChange,
    }),
  );
  disposables.push(editor);
  const structural = vi.spyOn(editor, "executeStructuralTransaction");
  const rendered = render(
    <FirstDraftViewStateProvider store={viewState}>
      <FirstDraftTableActionMenuProvider
        store={createFirstDraftTableActionMenuStore()}
      >
        <FirstDraftBlockHoverProvider enabled={editor.editable}>
          <EditorDocument editor={editor} />
        </FirstDraftBlockHoverProvider>
      </FirstDraftTableActionMenuProvider>
    </FirstDraftViewStateProvider>,
  );
  return {
    ...rendered,
    editor,
    onChange,
    structural,
    viewState,
  };
}

function expectDocumentCaret(
  fixture: ReturnType<typeof renderFixture>,
  blockId: BlockId,
  offset: number,
): void {
  const selection = fixture.editor.selection.getSnapshot();
  expect(selection.kind).toBe("document");
  if (selection.kind !== "document")
    throw new Error("Missing document selection");
  expect(selection.snapshot.documentSelection.normalizedStart).toMatchObject({
    blockId,
    textOffset: offset,
  });
  expect(selection.snapshot.documentSelection.normalizedEnd).toMatchObject({
    blockId,
    textOffset: offset,
  });
}

function pressBoundaryKey(
  fixture: ReturnType<typeof renderFixture>,
  blockId: BlockId,
  offset: number,
  key: "Enter" | "Backspace" | "Delete" | "Tab" | "Shift-Tab",
): void {
  act(() => {
    expect(
      fixture.editor.focusText(blockId, { offset, preventScroll: true }).status,
    ).toBe("focused");
  });
  expect(
    fireEvent.keyDown(textRoot(fixture.container, blockId), {
      key: key === "Shift-Tab" ? "Tab" : key,
      shiftKey: key === "Shift-Tab",
    }),
  ).toBe(false);
}

function eraseText(
  fixture: ReturnType<typeof renderFixture>,
  blockId: BlockId,
): void {
  const size = fixture.editor.readBlockPlainText(blockId, "paragraph").length;
  act(() => {
    fixture.editor.transaction(() => {
      expect(
        fixture.editor.deleteText({ blockId, range: { from: 0, to: size } }),
      ).toBe(true);
      fixture.editor.setTransactionSelection({ kind: "preserve" });
    });
  });
}

function removeForTest(
  fixture: ReturnType<typeof renderFixture>,
  blockIds: readonly BlockId[],
): void {
  const expectedParents = Object.fromEntries(
    blockIds.map((blockId) => [
      blockId,
      fixture.editor.getBlock(blockId)?.parentId,
    ]),
  );
  act(() => {
    const result = fixture.editor.executeStructuralTransaction({
      origin: "first-draft-boundary-column-test-setup",
      operations: [
        removeBlocks({
          blockIds,
          includeDescendants: true,
          expectedParents,
        }),
      ],
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
  });
}

function shell(container: ParentNode, blockId: BlockId): HTMLElement {
  const result = container.querySelector<HTMLElement>(
    `[data-editor-block-shell='true'][data-editor-block-id='${blockId}']`,
  );
  if (!result) throw new Error(`Missing shell ${blockId}`);
  return result;
}

function textRoot(container: ParentNode, blockId: BlockId): HTMLElement {
  const result = shell(container, blockId).querySelector<HTMLElement>(
    "[data-editor-text-root='true']",
  );
  if (!result) throw new Error(`Missing text root ${blockId}`);
  return result;
}
