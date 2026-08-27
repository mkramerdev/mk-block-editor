import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import { richTextDocumentContentSize } from "@repo/editor-core/content/rich-text";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorImplementation } from "@repo/editor-react/editor";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import { EditorDocument } from "@repo/editor-web/document-runtime";
import { compileCanonicalEditorDefinition } from "@repo/editor-web/editor-definition";
import { initializeCompiledTestEditableEditor as initializeEditableEditor } from "./test-editor.ts";
import type { EditableEditorDefinition } from "@repo/editor-web/editor";
import {
  createYjsBlockContentRuntime,
  type YjsBlockContentRuntime,
} from "@repo/editor-yjs-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirstDraftBlockHoverProvider } from "./block-controls/index.ts";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
} from "./blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "./first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "./first-draft-fixture.ts";
import { createFirstDraftBootstrapFromSnapshot } from "./bootstrap/bootstrap.ts";

interface ListCase {
  readonly name: string;
  readonly containerId: BlockId;
  readonly itemIds: readonly [BlockId, BlockId, BlockId];
  readonly textIds: readonly [BlockId, BlockId, BlockId];
  readonly extraTextId: BlockId;
  readonly renderedItemSelector: string;
  readonly htmlListTag: "ol" | "ul";
}

const listCases: readonly ListCase[] = [
  {
    name: "ordered list",
    containerId: id("fd-ordered-list"),
    itemIds: [id("fd-ordered-1"), id("fd-ordered-2"), id("fd-ordered-3")],
    textIds: [
      id("fd-ordered-1-text"),
      id("fd-ordered-2-text"),
      id("fd-ordered-3-text"),
    ],
    extraTextId: id("fd-paragraph-outro"),
    renderedItemSelector: ".list-item-block__item",
    htmlListTag: "ol",
  },
  {
    name: "bullet list",
    containerId: id("fd-bullet-list"),
    itemIds: [id("fd-bullet-1"), id("fd-bullet-2"), id("fd-bullet-nested")],
    textIds: [
      id("fd-bullet-1-text"),
      id("fd-bullet-2-text"),
      id("fd-bullet-nested-text"),
    ],
    extraTextId: id("fd-paragraph-after-goals"),
    renderedItemSelector: ".list-item-block__item",
    htmlListTag: "ul",
  },
  {
    name: "checklist",
    containerId: id("fd-checklist"),
    itemIds: [
      id("fd-check-unchecked"),
      id("fd-check-checked"),
      id("fd-check-copy"),
    ],
    textIds: [
      id("fd-check-unchecked-text"),
      id("fd-check-checked-text"),
      id("fd-check-copy-text"),
    ],
    extraTextId: id("fd-paragraph-outro"),
    renderedItemSelector: ".checklist-block__item",
    htmlListTag: "ul",
  },
];

describe("First Draft canonical list-item range deletion", () => {
  afterEach(cleanup);

  it("projects four ordered markers as DOM text and renumbers immediately after leading deletion", () => {
    const listCase = listCases[0]!;
    const fourItemIds = [...listCase.itemIds, id("fd-ordered-4")] as const;
    const fourTextIds = [...listCase.textIds, listCase.extraTextId] as const;
    const fixture = renderListFixture(
      listCase,
      createFourItemOrderedListSnapshot(),
    );
    const survivingText = fourTextIds
      .slice(2)
      .map((textId) => fixture.editor.readBlockPlainText(textId, "paragraph"));
    const survivingMetadata = fourItemIds
      .slice(2)
      .map((itemId) => fixture.editor.getBlock(itemId)?.metadata);

    expect(renderedOrderedItems(fixture.container)).toEqual([
      { id: fourItemIds[0], marker: "1.", ariaHidden: "true" },
      { id: fourItemIds[1], marker: "2.", ariaHidden: "true" },
      { id: fourItemIds[2], marker: "3.", ariaHidden: "true" },
      { id: fourItemIds[3], marker: "4.", ariaHidden: "true" },
    ]);
    expect(fixture.container.querySelectorAll("ol")).toHaveLength(1);

    commitCompleteLeadingItemsSelection(
      fixture,
      fourTextIds[0],
      fourTextIds[1],
    );
    fireEvent.keyDown(fixture.activeTextView, { key: "Backspace" });

    expect(fixture.editor.getChildBlockIds(listCase.containerId)).toEqual(
      fourItemIds.slice(2),
    );
    for (const removedId of [
      fourItemIds[0],
      fourTextIds[0],
      fourItemIds[1],
      fourTextIds[1],
    ]) {
      expect(fixture.editor.getBlock(removedId)).toBeNull();
    }
    expect(renderedOrderedItems(fixture.container)).toEqual([
      { id: fourItemIds[2], marker: "1.", ariaHidden: "true" },
      { id: fourItemIds[3], marker: "2.", ariaHidden: "true" },
    ]);
    expect(
      fourTextIds
        .slice(2)
        .map((textId) =>
          fixture.editor.readBlockPlainText(textId, "paragraph"),
        ),
    ).toEqual(survivingText);
    expect(
      fourItemIds
        .slice(2)
        .map((itemId) => fixture.editor.getBlock(itemId)?.metadata),
    ).toEqual(survivingMetadata);
    for (const itemId of fourItemIds.slice(2)) {
      expect(
        fixture.editor.getBlock(itemId)?.metadata ?? {},
      ).not.toHaveProperty("ordinal");
    }

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(listCase.containerId)).toEqual(
      fourItemIds,
    );
    expect(
      renderedOrderedItems(fixture.container).map(({ marker }) => marker),
    ).toEqual(["1.", "2.", "3.", "4."]);
    expect(
      fixture.editor.selectionController.getCommittedSnapshot()?.endpoints,
    ).toMatchObject({
      anchor: { blockId: fourTextIds[0], textOffset: 0 },
      head: { blockId: fourTextIds[1] },
    });
    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(listCase.containerId)).toEqual(
      fourItemIds.slice(2),
    );
    expect(
      renderedOrderedItems(fixture.container).map(({ marker }) => marker),
    ).toEqual(["1.", "2."]);
    expect(
      fixture.editor.selectionController.getCommittedSnapshot()?.endpoints,
    ).toMatchObject({
      anchor: { blockId: fourTextIds[2], textOffset: 0 },
      head: { blockId: fourTextIds[2], textOffset: 0 },
    });

    fixture.dispose();
  });

  it("keeps the first two ordered ordinals unchanged after deleting the final two items", () => {
    const listCase = listCases[0]!;
    const itemIds = [...listCase.itemIds, id("fd-ordered-4")] as const;
    const textIds = [...listCase.textIds, listCase.extraTextId] as const;
    const fixture = renderListFixture(
      listCase,
      createFourItemOrderedListSnapshot(),
    );
    const firstTwoText = textIds
      .slice(0, 2)
      .map((textId) => fixture.editor.readBlockPlainText(textId, "paragraph"));

    commitCompleteLeadingItemsSelection(fixture, textIds[2], textIds[3]);
    fireEvent.keyDown(fixture.activeTextView, { key: "Delete" });

    expect(fixture.editor.getChildBlockIds(listCase.containerId)).toEqual(
      itemIds.slice(0, 2),
    );
    expect(renderedOrderedItems(fixture.container)).toEqual([
      { id: itemIds[0], marker: "1.", ariaHidden: "true" },
      { id: itemIds[1], marker: "2.", ariaHidden: "true" },
    ]);
    expect(
      textIds
        .slice(0, 2)
        .map((textId) =>
          fixture.editor.readBlockPlainText(textId, "paragraph"),
        ),
    ).toEqual(firstTwoText);

    fixture.dispose();
  });

  it.each(listCases)(
    "removes the complete middle $name item and preserves its siblings",
    (listCase) => {
      const fixture = renderListFixture(listCase);
      const [firstItem, removedItem, lastItem] = listCase.itemIds;
      const removedPrimary = listCase.textIds[1];
      const firstMetadata = fixture.editor.getBlock(firstItem)?.metadata;
      const lastMetadata = fixture.editor.getBlock(lastItem)?.metadata;

      commitCompleteMiddleItemSelection(
        fixture,
        listCase,
        listCase.name === "bullet list" ? "backward" : "forward",
      );
      fireEvent.keyDown(fixture.activeTextView, { key: "Delete" });

      expect(fixture.editor.getChildBlockIds(listCase.containerId)).toEqual([
        firstItem,
        lastItem,
      ]);
      expect(fixture.editor.getBlock(removedItem)).toBeNull();
      expect(fixture.editor.getBlock(removedPrimary)).toBeNull();
      expect(fixture.editor.getBlock(listCase.extraTextId)).toBeNull();
      expect(fixture.editor.getBlock(firstItem)?.metadata).toEqual(
        firstMetadata,
      );
      expect(fixture.editor.getBlock(lastItem)?.metadata).toEqual(lastMetadata);
      expect(renderedItemIds(fixture.container, listCase)).toEqual([
        firstItem,
        lastItem,
      ]);
      if (listCase.htmlListTag === "ol") {
        expect(
          renderedOrderedItems(fixture.container).map(({ marker }) => marker),
        ).toEqual(["1.", "2."]);
      }

      fixture.dispose();
    },
  );

  it("cuts leading ordered items as a list-shaped fragment and renumbers survivors", () => {
    const listCase = listCases[0]!;
    const itemIds = [...listCase.itemIds, id("fd-ordered-4")] as const;
    const textIds = [...listCase.textIds, listCase.extraTextId] as const;
    const fixture = renderListFixture(
      listCase,
      createFourItemOrderedListSnapshot(),
    );
    commitCompleteLeadingItemsSelection(fixture, textIds[0], textIds[1]);
    const clipboard = new MemoryDataTransfer();
    const event = clipboardEvent("cut", clipboard);

    act(() => fixture.activeTextView.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(clipboard.getData("text/plain")).toContain(
      "Create content with the blocks that fit the idea.",
    );
    expect(clipboard.getData("text/html")).toContain(
      `<${listCase.htmlListTag}`,
    );
    expect(clipboard.getData("text/html")).toContain("<li");
    expect(fixture.editor.getBlock(itemIds[0])).toBeNull();
    expect(fixture.editor.getBlock(itemIds[1])).toBeNull();
    expect(fixture.editor.getChildBlockIds(listCase.containerId)).toEqual([
      itemIds[2],
      itemIds[3],
    ]);
    expect(
      renderedOrderedItems(fixture.container).map(({ marker }) => marker),
    ).toEqual(["1.", "2."]);
    expect(clipboard.getData("text/html")).not.toContain("ordinal");

    fixture.dispose();
  });
});

describe("First Draft product wrapper range deletion", () => {
  afterEach(cleanup);

  it.each([
    ["quote", "fd-heading-1", "heading", "fd-quote-text", "paragraph", "fd-quote"],
    ["code", "fd-paragraph-intro", "paragraph", "fd-code-text", "paragraph", "fd-code"],
    ["callout", "fd-bullet-nested-text", "paragraph", "fd-callout-text", "paragraph", "fd-callout"],
  ] as const)(
    "unwraps a partial %s boundary in one real range transaction",
    (_name, destinationId, destinationType, donorId, _donorType, wrapperId) => {
      const fixture = renderFullRangeFixture();
      commitOpenRange(
        fixture,
        id(destinationId),
        destinationType,
        id(donorId),
      );

      fireEvent.keyDown(fixture.activeTextView, { key: "Backspace" });

      expect(fixture.editor.getBlock(id(wrapperId))).toBeNull();
      expect(fixture.editor.getBlock(id(donorId))).toBeNull();
      expect(fixture.editor.getBlock(id(destinationId))).not.toBeNull();
      expect(fixture.onChange).toHaveBeenCalledTimes(1);
      expect(fixture.editor.undo()).toEqual({ status: "applied" });
      expect(fixture.editor.getBlock(id(wrapperId))?.type).toBe(_name);
      expect(fixture.editor.redo()).toEqual({ status: "applied" });
      expect(fixture.editor.getBlock(id(wrapperId))).toBeNull();
      fixture.dispose();
    },
  );

  it("promotes toggle body contents when a partial range consumes the summary", () => {
    const fixture = renderFullRangeFixture(createToggleRangeSnapshot());
    const promotedIds = fixture.editor.getChildBlockIds(
      id("fd-toggle-heading-body"),
    );
    commitOpenRange(
      fixture,
      id("fd-paragraph-outro"),
      "paragraph",
      id("fd-toggle-heading-summary"),
    );

    fireEvent.keyDown(fixture.activeTextView, { key: "Delete" });

    expect(fixture.editor.getBlock(id("fd-toggle-heading"))).toBeNull();
    expect(promotedIds.map((blockId) => fixture.editor.getParentId(blockId))).toEqual(
      promotedIds.map(() => null),
    );
    expect(fixture.onChange).toHaveBeenCalledTimes(1);
    fixture.dispose();
  });

  it("applies column underflow while preserving the effective tab boundary", () => {
    const columns = renderFullRangeFixture();
    const survivingColumnContents = columns.editor.getChildBlockIds(
      id("fd-column-right"),
    );
    commitOpenRange(
      columns,
      id("fd-paragraph-layouts"),
      "paragraph",
      id("fd-column-left-heading"),
    );
    fireEvent.keyDown(columns.activeTextView, { key: "Backspace" });
    expect(columns.editor.getBlock(id("fd-columns"))).toBeNull();
    expect(
      survivingColumnContents.map((blockId) => columns.editor.getParentId(blockId)),
    ).toEqual(survivingColumnContents.map(() => null));
    expect(columns.onChange).toHaveBeenCalledTimes(1);
    columns.dispose();

    const tabs = renderFullRangeFixture();
    const tabsId = id("fd-tabs");
    const activePaneId = id("fd-tab-overview");
    const activeTextId = id("fd-tab-overview-text");
    const paneIds = tabs.editor.getChildBlockIds(tabsId);
    const paneMetadata = paneIds.map(
      (paneId) => tabs.editor.getBlock(paneId)?.metadata,
    );
    const inactiveContents = paneIds.slice(1).map((paneId) =>
      tabs.editor.getChildBlockIds(paneId),
    );
    const tabsShell = blockShell(tabs.container, tabsId);
    const paneShells = paneIds.map((paneId) =>
      blockShell(tabs.container, paneId),
    );
    commitOpenRange(
      tabs,
      id("fd-paragraph-tabs"),
      "paragraph",
      activeTextId,
    );
    fireEvent.keyDown(tabs.activeTextView, { key: "Delete" });

    expect(tabs.editor.getBlock(tabsId)?.type).toBe("tabs");
    expect(tabs.editor.getChildBlockIds(tabsId)).toEqual(paneIds);
    expect(tabs.editor.getChildBlockIds(activePaneId)).toEqual([]);
    expect(tabs.editor.getBlock(activeTextId)).toBeNull();
    expect(
      paneIds.map((paneId) => tabs.editor.getBlock(paneId)?.metadata),
    ).toEqual(paneMetadata);
    expect(
      paneIds.slice(1).map((paneId) =>
        tabs.editor.getChildBlockIds(paneId),
      ),
    ).toEqual(inactiveContents);
    expect(tabs.editor.getRootBlockIds()).not.toContain(activeTextId);
    expect(blockShell(tabs.container, tabsId)).toBe(tabsShell);
    paneIds.forEach((paneId, index) => {
      expect(blockShell(tabs.container, paneId)).toBe(paneShells[index]);
    });
    expect(
      blockShell(tabs.container, activePaneId).querySelector(
        ".empty-wrapper-add-text-button",
      ),
    ).not.toBeNull();
    expect(tabs.onChange).toHaveBeenCalledTimes(1);

    act(() => expect(tabs.editor.undo()).toEqual({ status: "applied" }));
    expect(tabs.editor.getChildBlockIds(activePaneId)).toEqual([activeTextId]);
    expect(tabs.editor.getBlock(activeTextId)?.parentId).toBe(activePaneId);
    expect(
      blockShell(tabs.container, activePaneId).querySelector(
        ".empty-wrapper-add-text-button",
      ),
    ).toBeNull();
    act(() => expect(tabs.editor.redo()).toEqual({ status: "applied" }));
    expect(tabs.editor.getChildBlockIds(activePaneId)).toEqual([]);

    tabs.onChange.mockClear();
    const addText = blockShell(
      tabs.container,
      activePaneId,
    ).querySelector<HTMLButtonElement>(".empty-wrapper-add-text-button")!;
    fireEvent.click(addText);
    const insertedId = tabs.editor.getChildBlockIds(activePaneId)[0]!;
    expect(tabs.editor.getBlock(insertedId)).toMatchObject({
      type: "paragraph",
      parentId: activePaneId,
    });
    expect(tabs.editor.getChildBlockIds(tabsId)).toEqual(paneIds);
    expect(tabs.onChange).toHaveBeenCalledOnce();
    expect(
      blockShell(tabs.container, activePaneId).querySelector(
        ".empty-wrapper-add-text-button",
      ),
    ).toBeNull();
    expect(document.activeElement).toBe(
      blockShell(tabs.container, insertedId).querySelector(
        '[data-editor-text-root="true"]',
      ),
    );
    tabs.dispose();
  });

  it("preserves tabs for a range from the active pane into the following block", () => {
    const fixture = renderFullRangeFixture();
    const tabsId = id("fd-tabs");
    const activePaneId = id("fd-tab-overview");
    const activeTextId = id("fd-tab-overview-text");
    const donorId = id("fd-paragraph-after-tabs");
    const paneIds = fixture.editor.getChildBlockIds(tabsId);
    const inactiveContents = paneIds.slice(1).map((paneId) =>
      fixture.editor.getChildBlockIds(paneId),
    );
    const activeText = fixture.editor.readBlockPlainText(
      activeTextId,
      "paragraph",
    );
    const donorText = fixture.editor.readBlockPlainText(donorId, "paragraph");

    commitOpenRange(fixture, activeTextId, "paragraph", donorId);
    fireEvent.keyDown(fixture.activeTextView, { key: "Backspace" });

    expect(fixture.editor.getBlock(tabsId)?.type).toBe("tabs");
    expect(fixture.editor.getChildBlockIds(tabsId)).toEqual(paneIds);
    expect(fixture.editor.getChildBlockIds(activePaneId)).toEqual([
      activeTextId,
    ]);
    expect(fixture.editor.getBlock(activeTextId)?.parentId).toBe(activePaneId);
    expect(fixture.editor.getBlock(donorId)).toBeNull();
    expect(
      fixture.editor.readBlockPlainText(activeTextId, "paragraph"),
    ).toBe(activeText.slice(0, -1) + donorText.slice(1));
    expect(
      paneIds.slice(1).map((paneId) =>
        fixture.editor.getChildBlockIds(paneId),
      ),
    ).toEqual(inactiveContents);
    expect(fixture.editor.getRootBlockIds()).not.toContain(activeTextId);
    expect(fixture.onChange).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      blockShell(fixture.container, activeTextId).querySelector(
        '[data-editor-text-root="true"]',
      ),
    );

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getBlock(donorId)?.parentId).toBeNull();
    expect(fixture.editor.getChildBlockIds(activePaneId)).toEqual([
      activeTextId,
    ]);
    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getBlock(donorId)).toBeNull();
    expect(fixture.editor.getChildBlockIds(tabsId)).toEqual(paneIds);
    fixture.dispose();
  });

  it("keeps ordinary multi-block range deletion inside the active pane", () => {
    const fixture = renderFullRangeFixture();
    const tabsId = id("fd-tabs");
    const paneId = id("fd-tab-overview");
    const firstId = id("fd-tab-overview-text");
    let insertion!: ReturnType<typeof fixture.editor.insertBlockAt>;
    act(() => {
      insertion = fixture.editor.insertBlockAt({
        placement: { parentId: paneId, childIndex: 1 },
        blockType: "paragraph",
        selection: false,
      });
    });
    if (!insertion.ok) {
      throw new Error("Failed to add second active-pane paragraph");
    }
    const secondId = fixture.editor.getChildBlockIds(paneId)[1]!;
    act(() => {
      fixture.editor.transaction(() => {
        expect(
          fixture.editor.insertText({
            blockId: secondId,
            offset: 0,
            text: "Second pane paragraph",
          }),
        ).toBe(true);
        fixture.editor.setTransactionSelection({ kind: "preserve" });
      });
    });
    fixture.onChange.mockClear();

    commitOpenRange(fixture, firstId, "paragraph", secondId);
    fireEvent.keyDown(fixture.activeTextView, { key: "Delete" });

    expect(fixture.editor.getBlock(tabsId)?.type).toBe("tabs");
    expect(fixture.editor.getChildBlockIds(paneId)).toEqual([firstId]);
    expect(fixture.editor.getBlock(secondId)).toBeNull();
    expect(fixture.editor.getBlock(firstId)?.parentId).toBe(paneId);
    expect(fixture.onChange).toHaveBeenCalledOnce();
    fixture.dispose();
  });
});

function renderFullRangeFixture(
  snapshot: EditorInstanceSnapshot = createFirstDraftSnapshot(),
) {
  const bootstrap = createFirstDraftBootstrapFromSnapshot({
    documentId: "product-wrapper-range-deletion",
    revision: 0,
    snapshot,
  });
  const viewState = createFirstDraftViewStateStore();
  let contentRuntime: YjsBlockContentRuntime | null = null;
  const definition = {
    ...createFirstDraftEditorDefinition(viewState),
    content: {
      createRuntime: (source) => {
        const runtime = createYjsBlockContentRuntime(source);
        contentRuntime = runtime;
        return runtime;
      },
    },
  } satisfies EditableEditorDefinition;
  const onChange = vi.fn();
  const editor = addEditorBlockOperations(
    initializeEditableEditor({
      compiledDefinition: compileCanonicalEditorDefinition(definition),
      snapshot: bootstrap.snapshot,
      validatedSnapshot: bootstrap,
      onChange,
      onChangeError: (error) => {
        throw error;
      },
      createTransactionId: () => crypto.randomUUID(),
    }),
  );
  const rendered = render(
    <FirstDraftViewStateProvider store={viewState}>
      <div data-editor-interaction-scope="true">
        <FirstDraftBlockHoverProvider enabled>
          <EditorDocument editor={editor} />
        </FirstDraftBlockHoverProvider>
      </div>
    </FirstDraftViewStateProvider>,
  );
  return {
    ...rendered,
    snapshot,
    editor,
    onChange,
    contentRuntime: requireContentRuntime(contentRuntime),
    get activeTextView(): HTMLElement {
      const view =
        rendered.container.querySelector<HTMLElement>(".ProseMirror");
      if (!view) throw new Error("Missing active shared text view");
      return view;
    },
    dispose() {
      rendered.unmount();
      editor.dispose();
    },
  };
}

function createToggleRangeSnapshot(): EditorInstanceSnapshot {
  const source = createFirstDraftSnapshot();
  const destinationId = id("fd-paragraph-outro");
  const toggleId = id("fd-toggle-heading");
  const summaryId = id("fd-toggle-heading-summary");
  const bodyId = id("fd-toggle-heading-body");
  const bodyIds = source.childIdsByParentId[bodyId] ?? [];
  const includedIds = [
    destinationId,
    toggleId,
    summaryId,
    bodyId,
    ...bodyIds,
  ];
  return {
    ...source,
    blocks: Object.fromEntries(
      includedIds.map((blockId) => [blockId, source.blocks[blockId]!]),
    ),
    rootBlockIds: [destinationId, toggleId],
    childIdsByParentId: {
      [toggleId]: [summaryId, bodyId],
      [bodyId]: bodyIds,
    },
    content: Object.fromEntries(
      [destinationId, summaryId, ...bodyIds].map((blockId) => [
        blockId,
        source.content[blockId]!,
      ]),
    ),
    opaqueContentCheckpoints: Object.fromEntries(
      [destinationId, summaryId, ...bodyIds].map((blockId) => [
        blockId,
        source.opaqueContentCheckpoints[blockId]!,
      ]),
    ),
  };
}

function commitOpenRange(
  fixture: ReturnType<typeof renderFullRangeFixture>,
  destinationId: BlockId,
  destinationType: string,
  donorId: BlockId,
): void {
  const destinationContent = fixture.editor.readBlockContent(
    destinationId,
    destinationType,
  );
  if (!destinationContent) {
    throw new Error(`Missing destination content for ${destinationId}`);
  }
  const hold = fixture.contentRuntime.acquireBlockContent(
    destinationId,
    destinationType,
    "canonical-transaction",
  );
  commitSelection(
    fixture.editor,
    destinationId,
    richTextDocumentContentSize(destinationContent) - 1,
    donorId,
    1,
  );
  hold.release();
}

function renderListFixture(
  listCase: ListCase,
  snapshot = createListSnapshot(listCase),
) {
  const bootstrap = createFirstDraftBootstrapFromSnapshot({
    documentId: `list-deletion-${listCase.name.replaceAll(" ", "-")}`,
    revision: 0,
    snapshot,
  });
  const viewState = createFirstDraftViewStateStore();
  let contentRuntime: YjsBlockContentRuntime | null = null;
  const definition = {
    ...createFirstDraftEditorDefinition(viewState),
    content: {
      createRuntime: (source) => {
        const runtime = createYjsBlockContentRuntime(source);
        contentRuntime = runtime;
        return runtime;
      },
    },
  } satisfies EditableEditorDefinition;
  const editor = initializeEditableEditor({
    compiledDefinition: compileCanonicalEditorDefinition(definition),
    snapshot: bootstrap.snapshot,
    validatedSnapshot: bootstrap,
    onChange: () => undefined,
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
  const documentRoot = rendered.container.querySelector<HTMLElement>(
    ".editor-web-document",
  );
  if (!documentRoot) throw new Error("Missing editor document root");
  const activeTextView =
    rendered.container.querySelector<HTMLElement>(".ProseMirror");
  if (activeTextView) {
    throw new Error("Fixture unexpectedly activated text before selection");
  }
  const mountedContentRuntime = requireContentRuntime(contentRuntime);
  return {
    ...rendered,
    snapshot,
    editor,
    contentRuntime: mountedContentRuntime,
    documentRoot,
    get activeTextView(): HTMLElement {
      const view =
        rendered.container.querySelector<HTMLElement>(".ProseMirror");
      if (!view) throw new Error("Missing active shared text view");
      return view;
    },
    dispose() {
      rendered.unmount();
      editor.dispose();
    },
  };
}

function requireContentRuntime(
  runtime: YjsBlockContentRuntime | null,
): YjsBlockContentRuntime {
  if (!runtime) throw new Error("Missing block content runtime");
  return runtime;
}

function createFourItemOrderedListSnapshot(): EditorInstanceSnapshot {
  const source = createFirstDraftSnapshot();
  const containerId = id("fd-ordered-list");
  const itemIds = [
    id("fd-ordered-1"),
    id("fd-ordered-2"),
    id("fd-ordered-3"),
    id("fd-ordered-4"),
  ] as const;
  const textIds = [
    id("fd-ordered-1-text"),
    id("fd-ordered-2-text"),
    id("fd-ordered-3-text"),
    id("fd-paragraph-outro"),
  ] as const;
  const fourthItem = {
    ...source.blocks[itemIds[2]]!,
    id: itemIds[3],
    parentId: containerId,
  };
  const blocks = {
    [containerId]: source.blocks[containerId]!,
    [itemIds[0]]: source.blocks[itemIds[0]]!,
    [textIds[0]]: source.blocks[textIds[0]]!,
    [itemIds[1]]: source.blocks[itemIds[1]]!,
    [textIds[1]]: source.blocks[textIds[1]]!,
    [itemIds[2]]: source.blocks[itemIds[2]]!,
    [textIds[2]]: source.blocks[textIds[2]]!,
    [itemIds[3]]: fourthItem,
    [textIds[3]]: {
      ...source.blocks[textIds[3]]!,
      parentId: itemIds[3],
    },
  };

  return {
    ...source,
    blocks,
    rootBlockIds: [containerId],
    childIdsByParentId: {
      [containerId]: [...itemIds],
      [itemIds[0]]: [textIds[0]],
      [itemIds[1]]: [textIds[1]],
      [itemIds[2]]: [textIds[2]],
      [itemIds[3]]: [textIds[3]],
    },
    content: Object.fromEntries(
      textIds.map((blockId) => [blockId, source.content[blockId]!]),
    ),
    opaqueContentCheckpoints: Object.fromEntries(
      textIds.map((blockId) => [
        blockId,
        source.opaqueContentCheckpoints[blockId]!,
      ]),
    ),
  };
}

function createListSnapshot(listCase: ListCase): EditorInstanceSnapshot {
  const source = createFirstDraftSnapshot();
  const [firstItem, middleItem, lastItem] = listCase.itemIds;
  const [firstText, middleText, lastText] = listCase.textIds;
  const blocks = {
    [listCase.containerId]: source.blocks[listCase.containerId]!,
    [firstItem]: {
      ...source.blocks[firstItem]!,
      parentId: listCase.containerId,
    },
    [firstText]: { ...source.blocks[firstText]!, parentId: firstItem },
    [middleItem]: {
      ...source.blocks[middleItem]!,
      parentId: listCase.containerId,
    },
    [middleText]: { ...source.blocks[middleText]!, parentId: middleItem },
    [listCase.extraTextId]: {
      ...source.blocks[listCase.extraTextId]!,
      parentId: middleItem,
    },
    [lastItem]: { ...source.blocks[lastItem]!, parentId: listCase.containerId },
    [lastText]: { ...source.blocks[lastText]!, parentId: lastItem },
  };
  const textIds = [firstText, middleText, listCase.extraTextId, lastText];
  return {
    ...source,
    blocks,
    rootBlockIds: [listCase.containerId],
    childIdsByParentId: {
      [listCase.containerId]: [...listCase.itemIds],
      [firstItem]: [firstText],
      [middleItem]: [middleText, listCase.extraTextId],
      [lastItem]: [lastText],
    },
    content: Object.fromEntries(
      textIds.map((blockId) => [blockId, source.content[blockId]!]),
    ),
    opaqueContentCheckpoints: Object.fromEntries(
      textIds.map((blockId) => [
        blockId,
        source.opaqueContentCheckpoints[blockId]!,
      ]),
    ),
  };
}

function commitCompleteMiddleItemSelection(
  fixture: ReturnType<typeof renderListFixture>,
  listCase: ListCase,
  direction: "forward" | "backward" = "forward",
) {
  const end = richTextDocumentContentSize(
    fixture.snapshot.content[listCase.extraTextId]!,
  );
  const hold = fixture.contentRuntime.acquireBlockContent(
    direction === "forward" ? listCase.textIds[1] : listCase.extraTextId,
    "paragraph",
    "canonical-transaction",
  );
  if (direction === "forward") {
    commitSelection(
      fixture.editor,
      listCase.textIds[1],
      0,
      listCase.extraTextId,
      end,
    );
  } else {
    commitSelection(
      fixture.editor,
      listCase.extraTextId,
      end,
      listCase.textIds[1],
      0,
      "backward",
    );
  }
  hold.release();
}

function commitCompleteLeadingItemsSelection(
  fixture: ReturnType<typeof renderListFixture>,
  firstTextId: BlockId,
  secondTextId: BlockId,
) {
  const end = richTextDocumentContentSize(
    fixture.snapshot.content[secondTextId]!,
  );
  const hold = fixture.contentRuntime.acquireBlockContent(
    firstTextId,
    "paragraph",
    "canonical-transaction",
  );
  commitSelection(fixture.editor, firstTextId, 0, secondTextId, end);
  hold.release();
}

function commitSelection(
  editor: EditorImplementation,
  anchorBlockId: BlockId,
  anchorOffset: number,
  focusBlockId: BlockId,
  focusOffset: number,
  direction: "forward" | "backward" = "forward",
): void {
  act(() => {
    const anchor = captureTextPoint(editor, anchorBlockId, anchorOffset);
    const focus = captureTextPoint(editor, focusBlockId, focusOffset);
    const settlement = editor.selectionController.commitCanonicalSelection(
      { direction, anchor, focus },
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
    if (settlement.kind === "rejected") {
      throw new Error(`Selection was rejected: ${JSON.stringify(settlement)}`);
    }
  });
}

function captureTextPoint(
  editor: EditorImplementation,
  blockId: BlockId,
  offset: number,
) {
  editor.focusText(blockId, { offset });
  const canonical = editor.selectionController.getCanonicalSnapshot();
  if (canonical.kind !== "document") throw new Error("Text focus was rejected");
  const point = canonical.snapshot.documentSelection.focus;
  if (!point?.textAnchor)
    throw new Error("Text focus did not create an anchor");
  return point;
}

function renderedItemIds(
  container: HTMLElement,
  listCase: ListCase,
): readonly BlockId[] {
  return [
    ...container.querySelectorAll<HTMLElement>(listCase.renderedItemSelector),
  ].map((element) => {
    const idValue = element
      .closest<HTMLElement>("[data-editor-block-id]")
      ?.getAttribute("data-editor-block-id");
    if (!idValue) throw new Error("Rendered list item has no block shell");
    return idValue as BlockId;
  });
}

function renderedOrderedItems(container: HTMLElement) {
  const list = container.querySelector<HTMLOListElement>(
    'ol[data-editor-block-type="orderedList"]',
  );
  if (!list) throw new Error("Missing ordered list");
  const documentDropTargets = list.querySelectorAll(
    ":scope > .first-draft-block-drop-target",
  );
  expect(documentDropTargets).toHaveLength(1);
  expect(list.lastElementChild).toBe(documentDropTargets[0]);
  return [...list.children]
    .filter((element) => element.hasAttribute("data-editor-block-id"))
    .map((element) => {
    if (!(element instanceof HTMLLIElement)) {
      throw new Error("Ordered-list direct child is not an li");
    }
    const itemId = element.getAttribute("data-editor-block-id");
    const marker = element.querySelector<HTMLElement>(
      ".list-item-block__marker",
    );
    if (!itemId || !marker) throw new Error("Missing ordered item marker");
    return {
      id: itemId as BlockId,
      marker: marker.textContent,
      ariaHidden: marker.getAttribute("aria-hidden"),
    };
    });
}

function blockShell(container: ParentNode, blockId: BlockId): HTMLElement {
  const result = container.querySelector<HTMLElement>(
    `[data-editor-block-shell="true"][data-editor-block-id="${blockId}"]`,
  );
  if (!result) throw new Error(`Missing block shell ${blockId}`);
  return result;
}

function clipboardEvent(
  type: "cut",
  clipboard: MemoryDataTransfer,
): ClipboardEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, "clipboardData", {
    value: clipboard.asDataTransfer(),
  });
  return event as ClipboardEvent;
}

class MemoryDataTransfer {
  readonly values = new Map<string, string>();

  setData(format: string, value: string): void {
    this.values.set(format, value);
  }

  getData(format: string): string {
    return this.values.get(format) ?? "";
  }

  asDataTransfer(): DataTransfer {
    return this as unknown as DataTransfer;
  }
}

function id(value: string): BlockId {
  return value as BlockId;
}
