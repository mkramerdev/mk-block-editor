import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import type { BlockId } from "@repo/editor-core/kernel";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import {
  EditorDocument,
  type EditorChangeCallback,
} from "@repo/editor-web/document-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstDraftBlockHoverProvider } from "../block-controls/index.ts";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
} from "../blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "../first-draft-definition.tsx";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import {
  initializeTestEditableEditor,
  type FirstDraftTestEditor,
} from "../test-editor.ts";
import { FirstDraftAppendParagraphSurface } from "../blocks/append-paragraph-surface.tsx";

const id = (value: string) => value as BlockId;
const nonemptyId = id("fd-paragraph-intro");
const emptyId = id("fd-empty-after-callout");
const dividerId = id("fd-divider");
const quoteId = id("fd-quote");
const quoteTextId = id("fd-quote-text");
const columnsId = id("fd-columns");
const leftColumnId = id("fd-column-left");
const rightColumnId = id("fd-column-right");
const leftHeadingId = id("fd-column-left-heading");
const leftTextId = id("fd-column-left-text");
const rightHeadingId = id("fd-column-right-heading");
const rightTextId = id("fd-column-right-text");
const disposables: FirstDraftTestEditor[] = [];

describe("First Draft append-paragraph surface", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    for (const editor of disposables.splice(0)) editor.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  it("renders after the canonical list without disturbing root-leading content", () => {
    const fixture = renderFixture(snapshotForRoots([nonemptyId]), {
      leadingContent: <div data-testid="root-start-target" />,
    });
    const surface = screen.getByRole("button", {
      name: "Add paragraph at end of document",
    });
    const list = screen.getByRole("list", { name: "Document blocks" });
    const leading = screen.getByTestId("root-start-target");
    const finalRoot = fixture.container.querySelector(
      `[data-editor-block-id="${nonemptyId}"]`,
    );

    expect(surface.textContent).toBe("");
    expect(surface.childNodes).toHaveLength(0);
    expect(surface.tabIndex).toBe(-1);
    expect(surface.getAttribute("data-editor-ui")).toBe("true");
    expect(surface.getAttribute("data-editor-preserve-selection")).toBe("true");
    expect(list.contains(leading)).toBe(true);
    expect(list.contains(finalRoot)).toBe(true);
    expect(list.contains(surface)).toBe(false);
    expect(list.nextElementSibling).toBe(surface);
    expect(leading.compareDocumentPosition(finalRoot!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("appends one selected paragraph, focuses it, and restores it as one history action", () => {
    const onChange = vi.fn();
    const fixture = renderFixture(snapshotForRoots([nonemptyId]), { onChange });
    const originalRoots = fixture.editor.getRootBlockIds();
    const surface = screen.getByRole("button", {
      name: "Add paragraph at end of document",
    });
    onChange.mockClear();

    fireEvent.click(surface);

    const roots = fixture.editor.getRootBlockIds();
    expect(roots).toHaveLength(originalRoots.length + 1);
    expect(roots.slice(0, -1)).toEqual(originalRoots);
    const paragraphId = roots.at(-1)!;
    expect(fixture.editor.getBlock(paragraphId)?.type).toBe("paragraph");
    expect(fixture.editor.readBlockPlainText(paragraphId, "paragraph")).toBe("");
    expectCanonicalTextSelection(fixture.editor, paragraphId, 0);
    expect(document.activeElement).toBe(textRoot(fixture.container, paragraphId));
    expect(onChange).toHaveBeenCalledOnce();
    expect(fixture.editor.canUndo).toBe(true);

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getRootBlockIds()).toEqual(originalRoots);
    expect(fixture.editor.getBlock(paragraphId)).toBeNull();
    expect(fixture.editor.canUndo).toBe(false);

    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getRootBlockIds()).toEqual(roots);
    expectCanonicalTextSelection(fixture.editor, paragraphId, 0);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  for (const [name, snapshot] of [
    ["atomic", snapshotForRoots([dividerId])],
    [
      "wrapper",
      snapshotForRoots([quoteId], { [quoteId]: [quoteTextId] }),
    ],
  ] as const) {
    it(`appends exactly one root after a final ${name} block`, () => {
      const fixture = renderFixture(snapshot);
      fireEvent.click(
        screen.getByRole("button", { name: "Add paragraph at end of document" }),
      );
      const roots = fixture.editor.getRootBlockIds();
      expect(roots).toHaveLength(2);
      expect(roots[0]).toBe(snapshot.rootBlockIds[0]);
      expect(fixture.editor.getBlock(roots[1]!)?.type).toBe("paragraph");
    });
  }

  it("focuses an existing empty final paragraph without a change", () => {
    const onChange = vi.fn();
    const fixture = renderFixture(snapshotForRoots([emptyId]), { onChange });
    const roots = fixture.editor.getRootBlockIds();

    fireEvent.click(
      screen.getByRole("button", { name: "Add paragraph at end of document" }),
    );

    expect(fixture.editor.getRootBlockIds()).toBe(roots);
    expectCanonicalTextSelection(fixture.editor, emptyId, 0);
    expect(document.activeElement).toBe(textRoot(fixture.container, emptyId));
    expect(onChange).not.toHaveBeenCalled();
    expect(fixture.editor.canUndo).toBe(false);
  });

  it("treats whitespace as content and responds to content changes without remounting", () => {
    const fixture = renderFixture(snapshotForRoots([emptyId]));
    const surface = screen.getByRole("button", {
      name: "Add paragraph at end of document",
    });
    const originalSurface = surface;

    fireEvent.click(surface);
    expect(fixture.editor.getRootBlockIds()).toEqual([emptyId]);
    act(() => {
      expect(
        fixture.editor.insertText({ blockId: emptyId, offset: 0, text: "   " }),
      ).toBe(true);
    });
    expect(screen.getByRole("button", { name: "Add paragraph at end of document" })).toBe(
      originalSurface,
    );

    fireEvent.click(surface);
    expect(fixture.editor.getRootBlockIds()).toHaveLength(2);
  });

  it("re-reads the live final root and never appends consecutive empty paragraphs", () => {
    const fixture = renderFixture(snapshotForRoots([nonemptyId]));
    const surface = screen.getByRole("button", {
      name: "Add paragraph at end of document",
    });

    fireEvent.doubleClick(surface);
    fireEvent.click(surface);

    const roots = fixture.editor.getRootBlockIds();
    expect(roots).toHaveLength(2);
    const finalId = roots.at(-1)!;
    expect(fixture.editor.getBlock(finalId)?.type).toBe("paragraph");
    expect(fixture.editor.readBlockPlainText(finalId, "paragraph")).toBe("");
    expect(surface.getAttribute("data-first-draft-append-after")).toBe(
      finalId,
    );
  });

  it("updates its final-root subscription after a canonical append", () => {
    const fixture = renderFixture(snapshotForRoots([nonemptyId]));
    const surface = screen.getByRole("button", {
      name: "Add paragraph at end of document",
    });
    let insertion: ReturnType<FirstDraftEditor["insertBlockAt"]>;
    act(() => {
      insertion = fixture.editor.insertBlockAt({
        placement: { parentId: null, childIndex: 1 },
        blockType: "divider",
      });
    });
    expect(insertion!).toMatchObject({ ok: true });
    expect(surface.getAttribute("data-first-draft-append-after")).toBe(
      fixture.editor.getRootBlockIds().at(-1),
    );

    fireEvent.click(surface);
    expect(fixture.editor.getRootBlockIds()).toHaveLength(3);
    expect(fixture.editor.getBlock(fixture.editor.getRootBlockIds().at(-1)!)?.type)
      .toBe("paragraph");
  });

  it("preserves the current editor selection on mouse-down", () => {
    const fixture = renderFixture(snapshotForRoots([nonemptyId]));
    const surface = screen.getByRole("button", {
      name: "Add paragraph at end of document",
    });
    act(() => {
      expect(
        fixture.editor.focusText(nonemptyId, {
          offset: 0,
          preventScroll: true,
        }).status,
      ).toBe("focused");
    });
    const before = fixture.editor.selection.getSnapshot();

    expect(fireEvent.mouseDown(surface)).toBe(false);
    expect(fixture.editor.selection.getSnapshot()).toBe(before);
  });

  it("renders the shared surface after every column's canonical children", () => {
    const fixture = renderFixture(columnsSnapshot());
    const rootSurface = screen.getByRole("button", {
      name: "Add paragraph at end of document",
    });
    const columnSurfaces = screen.getAllByRole("button", {
      name: "Add paragraph at end of column",
    });

    expect(rootSurface.getAttribute("data-scope")).toBe("root");
    expect(columnSurfaces).toHaveLength(2);
    for (const columnId of [leftColumnId, rightColumnId]) {
      const lane = columnLane(fixture.container, columnId);
      const surface = columnSurface(fixture.container, columnId);
      const startTarget = lane.querySelector(
        ":scope > .first-draft-block-drop-target",
      );
      const firstCanonicalChild = lane.querySelector(
        ':scope > [data-editor-block-shell="true"]',
      );
      expect(surface.className).toBe(rootSurface.className);
      expect(surface.getAttribute("data-scope")).toBe("column");
      expect(lane.lastElementChild).toBe(surface);
      expect(startTarget?.nextElementSibling).toBe(firstCanonicalChild);
    }
  });

  it("appends, selects, focuses, undoes, and redoes one paragraph in the left column", () => {
    const onChange = vi.fn();
    const fixture = renderFixture(columnsSnapshot(), { onChange });
    const roots = fixture.editor.getRootBlockIds();
    const columnsChildren = fixture.editor.getChildBlockIds(columnsId);
    const leftChildren = fixture.editor.getChildBlockIds(leftColumnId);
    const rightChildren = fixture.editor.getChildBlockIds(rightColumnId);
    const leftMetadata = fixture.editor.getBlock(leftColumnId)?.metadata;
    const surface = columnSurface(fixture.container, leftColumnId);
    act(() => {
      expect(
        fixture.editor.focusText(leftTextId, {
          offset: 0,
          preventScroll: true,
        }).status,
      ).toBe("focused");
    });
    const selectionBeforeMouseDown = fixture.editor.selection.getSnapshot();
    onChange.mockClear();

    expect(fireEvent.mouseDown(surface)).toBe(false);
    expect(fixture.editor.selection.getSnapshot()).toBe(
      selectionBeforeMouseDown,
    );
    fireEvent.click(surface);

    const appendedLeftChildren = fixture.editor.getChildBlockIds(leftColumnId);
    const paragraphId = appendedLeftChildren.at(-1)!;
    expect(fixture.editor.getRootBlockIds()).toEqual(roots);
    expect(fixture.editor.getChildBlockIds(columnsId)).toEqual(columnsChildren);
    expect(fixture.editor.getChildBlockIds(rightColumnId)).toEqual(rightChildren);
    expect(appendedLeftChildren.slice(0, -1)).toEqual(leftChildren);
    expect(fixture.editor.getBlock(paragraphId)).toMatchObject({
      type: "paragraph",
      parentId: leftColumnId,
    });
    expect(fixture.editor.getBlock(leftColumnId)?.metadata).toEqual(leftMetadata);
    expectCanonicalTextSelection(fixture.editor, paragraphId, 0);
    expect(document.activeElement).toBe(textRoot(fixture.container, paragraphId));
    expect(onChange).toHaveBeenCalledOnce();
    expect(fixture.editor.canUndo).toBe(true);

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(leftColumnId)).toEqual(leftChildren);
    expect(fixture.editor.getChildBlockIds(rightColumnId)).toEqual(rightChildren);
    expect(fixture.editor.getBlock(paragraphId)).toBeNull();
    expect(fixture.editor.getBlock(leftColumnId)?.type).toBe("column");
    expect(fixture.editor.canUndo).toBe(false);

    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(leftColumnId)).toEqual(
      appendedLeftChildren,
    );
    expect(fixture.editor.getChildBlockIds(rightColumnId)).toEqual(rightChildren);
    expectCanonicalTextSelection(fixture.editor, paragraphId, 0);
  });

  it("targets the activated right column without changing root or sibling order", () => {
    const fixture = renderFixture(columnsSnapshot());
    const roots = fixture.editor.getRootBlockIds();
    const leftChildren = fixture.editor.getChildBlockIds(leftColumnId);
    const rightChildren = fixture.editor.getChildBlockIds(rightColumnId);

    fireEvent.click(columnSurface(fixture.container, rightColumnId));

    const nextRightChildren = fixture.editor.getChildBlockIds(rightColumnId);
    const paragraphId = nextRightChildren.at(-1)!;
    expect(fixture.editor.getRootBlockIds()).toEqual(roots);
    expect(fixture.editor.getChildBlockIds(leftColumnId)).toEqual(leftChildren);
    expect(nextRightChildren.slice(0, -1)).toEqual(rightChildren);
    expect(fixture.editor.getBlock(paragraphId)?.parentId).toBe(rightColumnId);
    expectCanonicalTextSelection(fixture.editor, paragraphId, 0);
    expect(document.activeElement).toBe(textRoot(fixture.container, paragraphId));
  });

  it("focuses an existing empty final column paragraph without publishing a change", () => {
    const onChange = vi.fn();
    const fixture = renderFixture(
      columnsSnapshot({ leftChildren: [emptyId] }),
      { onChange },
    );
    const leftChildren = fixture.editor.getChildBlockIds(leftColumnId);
    onChange.mockClear();

    fireEvent.click(columnSurface(fixture.container, leftColumnId));
    fireEvent.click(columnSurface(fixture.container, leftColumnId));

    expect(fixture.editor.getChildBlockIds(leftColumnId)).toBe(leftChildren);
    expectCanonicalTextSelection(fixture.editor, emptyId, 0);
    expect(document.activeElement).toBe(textRoot(fixture.container, emptyId));
    expect(onChange).not.toHaveBeenCalled();
    expect(fixture.editor.canUndo).toBe(false);
  });

  for (const [name, snapshot] of [
    ["atomic child", columnsSnapshot({ leftChildren: [dividerId] })],
    [
      "wrapper containing an empty paragraph",
      columnsSnapshot({
        leftChildren: [quoteId],
        extraChildIdsByParentId: { [quoteId]: [emptyId] },
      }),
    ],
  ] as const) {
    it(`appends a direct column paragraph after a final ${name}`, () => {
      const fixture = renderFixture(snapshot);
      const before = fixture.editor.getChildBlockIds(leftColumnId);

      fireEvent.click(columnSurface(fixture.container, leftColumnId));

      const after = fixture.editor.getChildBlockIds(leftColumnId);
      const paragraphId = after.at(-1)!;
      expect(after.slice(0, -1)).toEqual(before);
      expect(fixture.editor.getBlock(paragraphId)).toMatchObject({
        type: "paragraph",
        parentId: leftColumnId,
      });
      if (name.startsWith("wrapper")) {
        expect(fixture.editor.getChildBlockIds(quoteId)).toEqual([emptyId]);
      }
    });
  }

  it("re-reads a newly appended column paragraph on repeated activation", () => {
    const onChange = vi.fn();
    const fixture = renderFixture(columnsSnapshot(), { onChange });
    const surface = columnSurface(fixture.container, leftColumnId);
    const originalLength = fixture.editor.getChildBlockIds(leftColumnId).length;
    onChange.mockClear();

    fireEvent.click(surface);
    fireEvent.click(surface);

    expect(fixture.editor.getChildBlockIds(leftColumnId)).toHaveLength(
      originalLength + 1,
    );
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("cannot insert while interaction is disabled", () => {
    const fixture = renderFixture(columnsSnapshot(), {
      interactionEnabled: false,
    });
    const rootSurface = screen.getByRole("button", {
      name: "Add paragraph at end of document",
    });
    const columnSurfaces = screen.getAllByRole("button", {
      name: "Add paragraph at end of column",
    });
    const roots = fixture.editor.getRootBlockIds();
    const leftChildren = fixture.editor.getChildBlockIds(leftColumnId);

    expect((rootSurface as HTMLButtonElement).disabled).toBe(true);
    expect(
      columnSurfaces.every(
        (surface) => (surface as HTMLButtonElement).disabled,
      ),
    ).toBe(true);
    fireEvent.click(rootSurface);
    fireEvent.click(columnSurfaces[0]!);
    expect(fixture.editor.getRootBlockIds()).toEqual(roots);
    expect(fixture.editor.getChildBlockIds(leftColumnId)).toEqual(leftChildren);
  });

  it("fails safely when a live final paragraph has unreadable content", () => {
    const insertBlockAt = vi.fn();
    const paragraph = createFirstDraftSnapshot().blocks[emptyId]!;
    const rootIds = Object.freeze([emptyId]);
    const editor = {
      editable: true,
      getRootBlockIds: () => rootIds,
      subscribeRootBlockIds: () => () => undefined,
      getBlock: () => paragraph,
      subscribeBlock: () => () => undefined,
      readBlockContent: () => null,
      insertBlockAt,
      focusText: vi.fn(),
    } as unknown as FirstDraftEditor;

    render(
      <FirstDraftAppendParagraphSurface
        editor={editor}
        parentId={null}
        scope="root"
        ariaLabel="Add paragraph at end of document"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add paragraph at end of document" }),
    );
    expect(insertBlockAt).not.toHaveBeenCalled();
  });

  it("inserts the first paragraph into an empty document", () => {
    const createdId = id("document-end-created");
    const paragraph = {
      ...createFirstDraftSnapshot().blocks[emptyId]!,
      id: createdId,
    };
    const insertBlockAt = vi.fn(() => ({
      ok: true as const,
      handled: true as const,
      transaction: {
        transaction: {
          selection: {
            kind: "text-offset" as const,
            blockId: createdId,
            offset: 0,
          },
        },
      },
    }));
    const focusText = vi.fn();
    const noRoots = Object.freeze([] as BlockId[]);
    const editor = {
      editable: true,
      getRootBlockIds: () => noRoots,
      subscribeRootBlockIds: () => () => undefined,
      getBlock: (blockId: BlockId) =>
        blockId === createdId ? paragraph : null,
      subscribeBlock: () => () => undefined,
      readBlockContent: () => null,
      insertBlockAt,
      focusText,
    } as unknown as FirstDraftEditor;
    render(
      <FirstDraftAppendParagraphSurface
        editor={editor}
        parentId={null}
        scope="root"
        ariaLabel="Add paragraph at end of document"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add paragraph at end of document" }),
    );
    expect(insertBlockAt).toHaveBeenCalledWith({
      placement: { parentId: null, childIndex: 0 },
      blockType: "paragraph",
      selection: true,
    });
    expect(focusText).toHaveBeenCalledWith(createdId, {
      offset: 0,
      preventScroll: true,
    });
  });
});

function renderFixture(
  snapshot: EditorInstanceSnapshot,
  options: {
    readonly onChange?: EditorChangeCallback;
    readonly interactionEnabled?: boolean;
    readonly leadingContent?: React.ReactNode;
  } = {},
) {
  const viewState = createFirstDraftViewStateStore();
  const editor = addEditorBlockOperations(
    initializeTestEditableEditor({
      definition: createFirstDraftEditorDefinition(viewState),
      snapshot,
      onChange: options.onChange ?? vi.fn(),
    }),
  );
  disposables.push(editor);
  const interactionEnabled = options.interactionEnabled ?? true;
  const rendered = render(
    <FirstDraftViewStateProvider store={viewState}>
      <div data-editor-interaction-scope="true">
        <FirstDraftBlockHoverProvider enabled={interactionEnabled}>
          <EditorDocument
            editor={editor}
            interactionEnabled={interactionEnabled}
            trailingContent={
              <FirstDraftAppendParagraphSurface
                editor={editor}
                parentId={null}
                scope="root"
                ariaLabel="Add paragraph at end of document"
              />
            }
          >
            {options.leadingContent}
          </EditorDocument>
        </FirstDraftBlockHoverProvider>
      </div>
    </FirstDraftViewStateProvider>,
  );
  return { ...rendered, editor };
}

function snapshotForRoots(
  rootBlockIds: readonly BlockId[],
  childIdsByParentId: Readonly<Record<BlockId, readonly BlockId[]>> = {},
): EditorInstanceSnapshot {
  const source = createFirstDraftSnapshot();
  const included = new Set(rootBlockIds);
  const visit = (parentId: BlockId) => {
    for (const childId of childIdsByParentId[parentId] ?? []) {
      included.add(childId);
      visit(childId);
    }
  };
  for (const rootId of rootBlockIds) visit(rootId);
  const entries = [...included];
  return {
    ...source,
    blocks: Object.fromEntries(
      entries.map((blockId) => [blockId, source.blocks[blockId]!]),
    ),
    rootBlockIds: [...rootBlockIds],
    childIdsByParentId: Object.fromEntries(
      Object.entries(childIdsByParentId).map(([parentId, childIds]) => [
        parentId,
        [...childIds],
      ]),
    ) as Record<BlockId, BlockId[]>,
    content: Object.fromEntries(
      entries.flatMap((blockId) =>
        source.content[blockId]
          ? [[blockId, source.content[blockId]!] as const]
          : [],
      ),
    ),
    opaqueContentCheckpoints: Object.fromEntries(
      entries.flatMap((blockId) =>
        source.opaqueContentCheckpoints[blockId]
          ? [[blockId, source.opaqueContentCheckpoints[blockId]!] as const]
          : [],
      ),
    ),
  };
}

function columnsSnapshot(
  options: {
    readonly leftChildren?: readonly BlockId[];
    readonly rightChildren?: readonly BlockId[];
    readonly extraChildIdsByParentId?: Readonly<
      Record<BlockId, readonly BlockId[]>
    >;
  } = {},
): EditorInstanceSnapshot {
  const leftChildren = options.leftChildren ?? [leftHeadingId, leftTextId];
  const rightChildren = options.rightChildren ?? [
    rightHeadingId,
    rightTextId,
  ];
  const childIdsByParentId: Readonly<
    Record<BlockId, readonly BlockId[]>
  > = {
    [columnsId]: [leftColumnId, rightColumnId],
    [leftColumnId]: leftChildren,
    [rightColumnId]: rightChildren,
    ...options.extraChildIdsByParentId,
  };
  const snapshot = snapshotForRoots([columnsId], childIdsByParentId);
  const parentByChildId = new Map<BlockId, BlockId>();
  for (const [parentId, childIds] of Object.entries(childIdsByParentId)) {
    for (const childId of childIds) {
      parentByChildId.set(childId, id(parentId));
    }
  }
  return {
    ...snapshot,
    blocks: Object.fromEntries(
      Object.entries(snapshot.blocks).map(([blockId, block]) => [
        blockId,
        {
          ...block,
          parentId: parentByChildId.get(id(blockId)) ?? block.parentId,
        },
      ]),
    ) as EditorInstanceSnapshot["blocks"],
  };
}

function expectCanonicalTextSelection(
  editor: FirstDraftTestEditor,
  blockId: BlockId,
  offset: number,
): void {
  const selection = editor.selection.getSnapshot();
  expect(selection.kind).toBe("document");
  if (selection.kind !== "document") throw new Error("Missing selection");
  expect(selection.snapshot.documentSelection.normalizedStart).toMatchObject({
    blockId,
    blockType: "paragraph",
    blockCategory: "text",
    textOffset: offset,
  });
  expect(selection.snapshot.documentSelection.normalizedEnd).toMatchObject({
    blockId,
    blockType: "paragraph",
    blockCategory: "text",
    textOffset: offset,
  });
}

function textRoot(container: ParentNode, blockId: BlockId): HTMLElement {
  const result = container.querySelector<HTMLElement>(
    `[data-editor-block-id="${blockId}"] [data-editor-text-root="true"]`,
  );
  if (!result) throw new Error(`Missing text root ${blockId}`);
  return result;
}

function columnLane(container: ParentNode, columnId: BlockId): HTMLElement {
  const result = container.querySelector<HTMLElement>(
    `[data-editor-block-id="${columnId}"] > .columns-block__lane`,
  );
  if (!result) throw new Error(`Missing column lane ${columnId}`);
  return result;
}

function columnSurface(
  container: ParentNode,
  columnId: BlockId,
): HTMLButtonElement {
  const result = columnLane(container, columnId).querySelector<HTMLButtonElement>(
    ':scope > .first-draft-append-paragraph-surface[data-scope="column"]',
  );
  if (!result) throw new Error(`Missing append surface ${columnId}`);
  return result;
}
