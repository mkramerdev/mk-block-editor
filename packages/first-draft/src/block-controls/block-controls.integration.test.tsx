import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { domPointerDragActiveAttribute } from "@mk-drag-and-drop/react";
import {
  createCanonicalBlockRecord,
  insertBlocks,
  moveBlocks,
  removeBlocks,
} from "@repo/editor-core/editing";
import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  richTextDocumentWithInlineContent,
} from "@repo/editor-core/content/rich-text";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import { readEditorViewContentSize } from "@repo/editor-web/editable-block-renderer";
import {
  EditorDocument,
  type EditorChangeCallback,
} from "@repo/editor-web/document-runtime";
import { initializeTestEditableEditor as initializeEditableEditor } from "../test-editor.ts";
import type { EditableEditorDefinition } from "@repo/editor-web/editor";
import { FIRST_DRAFT_CALLOUT_ICONS } from "../callout-icons.ts";
import type { FirstDraftBlockRendererProps } from "../first-draft-editor-contracts.ts";
import {
  CalloutRenderer,
  ParagraphRenderer,
  ToggleBodyRenderer,
  ToggleHeadingRenderer,
  ToggleListItemRenderer,
} from "../blocks/core/renderers.tsx";
import { ColumnsRenderer } from "../blocks/layout/renderers.tsx";
import { createDefaultColumnMetadata } from "../blocks/columns/model.ts";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
} from "../blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import {
  FirstDraftBlockHoverProvider,
  type FirstDraftBlockHoverStore,
} from "./index.ts";
import { FirstDraftBlockHoverStoreCapture } from "./block-hover-store-capture.test-helper.tsx";
import {
  createFirstDraftTableActionMenuStore,
  FirstDraftTableActionMenuProvider,
} from "../table-action-menu/index.ts";
import {
  createFirstDraftBlockActionMenuStore,
  FirstDraftBlockActionMenuLayer,
  type FirstDraftBlockActionMenuStore,
} from "../block-action-menu/index.ts";
import {
  deleteFirstDraftTableRow,
  insertFirstDraftTableRow,
  moveFirstDraftTableRow,
} from "../blocks/table/mutations.ts";
import {
  createFirstDraftBlockPlacementRegistry,
  createFirstDraftBlockDropTargetId,
  FirstDraftRootDropTargetRefContext,
  captureFirstDraftDocumentBlockDragSession,
  type FirstDraftBlockDragAndDropBridge,
} from "../block-drag-and-drop/index.ts";
import { moveFirstDraftDocumentBlock } from "../block-operations/move-document-block.ts";
import {
  FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
  FIRST_DRAFT_TABLE_GRID_BOUNDS_TARGET,
} from "../block-drag-and-drop/document-drag-visual-bounds.ts";

const id = (value: string) => value as BlockId;
const disposables: Array<{ dispose(): void }> = [];
let firstDraftStyles: HTMLStyleElement;
let editorWebStyles: HTMLStyleElement;

beforeAll(() => {
  editorWebStyles = document.createElement("style");
  editorWebStyles.textContent = readFileSync(
    join(process.cwd(), "..", "editor-web", "src", "styles", "editor.css"),
    "utf8",
  );
  document.head.append(editorWebStyles);
  firstDraftStyles = document.createElement("style");
  firstDraftStyles.textContent = readFileSync(
    join(process.cwd(), "src/first-draft.css"),
    "utf8",
  );
  document.head.append(firstDraftStyles);
});

afterAll(() => {
  firstDraftStyles.remove();
  editorWebStyles.remove();
});

afterEach(() => {
  cleanup();
  for (const editor of disposables.splice(0)) editor.dispose();
  vi.restoreAllMocks();
});

describe("First Draft semantic block-control ownership", () => {
  it("keeps live inactive and active paragraph layers transparent over the editor surface", () => {
    const fixture = renderFirstDraft();
    const sourceId = id("fd-paragraph-intro");
    const surface = fixture.container.querySelector<HTMLElement>(
      ".first-draft-example",
    )!;
    const presentation = shell(fixture.container, sourceId).querySelector<HTMLElement>(
      ":scope > .paragraph-block__paragraph",
    )!;
    const inactiveProjection = presentation.querySelector<HTMLElement>(
      "[data-editor-text-projection='true']",
    )!;

    expect(getComputedStyle(surface).background).toBe(
      "var(--color-background)",
    );
    expectTransparentBackground(presentation);
    expectTransparentBackground(inactiveProjection);

    act(() => {
      expect(
        fixture.editor.focusText(sourceId, { offset: 2, preventScroll: true }),
      ).toEqual({ status: "focused" });
    });
    expectTransparentBackground(activeTextRoot(fixture.container));
    expectTransparentBackground(presentation);
  });

  it("retains live presentation ownership after sharing pure visual components", () => {
    const fixture = renderFirstDraft();
    const paragraph = shell(fixture.container, "fd-paragraph-intro");
    const heading = shell(fixture.container, "fd-heading-1");
    const callout = shell(fixture.container, "fd-callout");
    const columns = shell(fixture.container, "fd-columns");

    expect(
      paragraph.querySelectorAll(
        ":scope > .paragraph-block__paragraph > .editor-web-text-shell",
      ),
    ).toHaveLength(1);
    expect(
      heading.querySelectorAll(
        ":scope > .heading-block__heading[data-editor-heading-level='1'] > .editor-web-text-shell",
      ),
    ).toHaveLength(1);
    expect(
      callout.querySelectorAll(
        ":scope > .callout-block__callout > .callout-block__icon-wrap",
      ),
    ).toHaveLength(1);
    expect(
      callout.querySelectorAll(
        ":scope > .callout-block__callout > .callout-block__body",
      ),
    ).toHaveLength(1);
    expect(
      columns.querySelectorAll(":scope > .columns-block__grid"),
    ).toHaveLength(1);
    expect(
      columns.querySelectorAll(
        ":scope > .columns-block__grid > [data-editor-block-type='column']",
      ),
    ).toHaveLength(fixture.editor.getChildBlockIds(id("fd-columns")).length);
    expect(
      columns.querySelectorAll(
        ":scope > .columns-block__grid > .columns-block__resize-overlay",
      ),
    ).toHaveLength(1);
    expect(
      fixture.container.querySelectorAll(
        "[data-editor-block-id='fd-divider'] [data-editor-object-root='true']",
      ),
    ).toHaveLength(1);
    expect(
      fixture.container.querySelector(
        ".first-draft-document-block-drag-overlay",
      ),
    ).toBeNull();
    for (const [blockId, selector] of [
      ["fd-heading-1", ".heading-block__heading"],
      ["fd-quote", ".quote-block__quote"],
      ["fd-code", ".code-block__presentation"],
      ["fd-callout", ".callout-block__callout"],
      ["fd-toggle-heading", ".toggle-heading-block__toggle"],
      ["fd-toggle-list", ".toggle-list-item-block__toggle"],
      ["fd-divider", ".divider-block__rule"],
      ["fd-columns", ".columns-block__grid"],
      ["fd-tabs", ".tabs-block__tabs"],
    ] as const) {
      const visual = shell(fixture.container, blockId).querySelector(selector);
      expect(
        visual?.getAttribute("data-editor-selection-bounds-target"),
        blockId,
      ).toBe(FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET);
      expect(
        visual?.getAttribute("data-editor-selection-bounds-block-id"),
        blockId,
      ).toBe(blockId);
    }
    expect(
      shell(fixture.container, "fd-table")
        .querySelector(".table-block__grid")
        ?.getAttribute("data-editor-selection-bounds-target"),
    ).toBe(FIRST_DRAFT_TABLE_GRID_BOUNDS_TARGET);
    expect(
      shell(fixture.container, "fd-paragraph-intro").querySelector(
        `[data-editor-selection-bounds-target="${FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET}"]`,
      ),
    ).toBeNull();
  });

  it("captures mounted product visual bounds while retaining shell bounds for shell-equivalent blocks", () => {
    const fixture = renderFirstDraft();
    const headingId = id("fd-heading-1");
    const paragraphId = id("fd-paragraph-intro");
    const tableId = id("fd-table");
    const headingShell = shell(fixture.container, headingId);
    const headingVisual = headingShell.querySelector<HTMLElement>(
      ".heading-block__heading",
    )!;
    const paragraphShell = shell(fixture.container, paragraphId);
    const tableShell = shell(fixture.container, tableId);
    const tableObject = tableShell.querySelector<HTMLElement>(
      ".table-block__object",
    )!;
    const tableScroll = tableShell.querySelector<HTMLElement>(
      ".table-block__scroll",
    )!;
    const tableGrid = tableShell.querySelector<HTMLElement>(
      ".table-block__grid",
    )!;
    const headingRect = { left: 40, top: 52, width: 560, height: 38 };
    const paragraphRect = { left: 20, top: 210, width: 600, height: 44 };
    const tableGridRect = { left: -180, top: 360, width: 960, height: 280 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this === headingShell) return domRect(20, 20, 600, 104);
        if (this === headingVisual) return domRect(40, 52, 560, 38);
        if (this === paragraphShell) return domRect(20, 210, 600, 44);
        if (this === tableShell) return domRect(-40, 300, 900, 480);
        if (this === tableObject) return domRect(-20, 320, 860, 440);
        if (this === tableScroll) return domRect(0, 340, 700, 380);
        if (this === tableGrid) return domRect(-180, 360, 960, 280);
        return domRect(0, 0, 0, 0);
      },
    );
    const visualRead = vi.spyOn(
      fixture.editor.geometry,
      "readViewportBlockSelectionRect",
    );
    const shellRead = vi.spyOn(
      fixture.editor.geometry,
      "readViewportBlockShellRect",
    );

    const headingSession = captureFirstDraftDocumentBlockDragSession(
      fixture.editor,
      fixture.viewState,
      headingId,
    );
    const paragraphSession = captureFirstDraftDocumentBlockDragSession(
      fixture.editor,
      fixture.viewState,
      paragraphId,
    );
    const tableSession = captureFirstDraftDocumentBlockDragSession(
      fixture.editor,
      fixture.viewState,
      tableId,
    );

    expect(headingSession).toMatchObject({
      captureSucceeded: true,
      sourceRect: headingRect,
    });
    expect(paragraphSession).toMatchObject({
      captureSucceeded: true,
      sourceRect: paragraphRect,
    });
    expect(tableSession).toMatchObject({
      captureSucceeded: true,
      sourceRect: tableGridRect,
    });
    expect(visualRead).toHaveBeenCalledWith(
      headingId,
      FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
    );
    expect(visualRead).toHaveBeenCalledWith(
      tableId,
      FIRST_DRAFT_TABLE_GRID_BOUNDS_TARGET,
    );
    expect(shellRead).toHaveBeenCalledWith(paragraphId);
    expect(shellRead).not.toHaveBeenCalledWith(headingId);
    expect(shellRead).not.toHaveBeenCalledWith(tableId);

    const duplicate = headingVisual.cloneNode(false) as HTMLElement;
    headingShell.append(duplicate);
    expect(
      captureFirstDraftDocumentBlockDragSession(
        fixture.editor,
        fixture.viewState,
        headingId,
      ),
    ).toEqual({ blockId: headingId, captureSucceeded: false });
    duplicate.remove();
    headingVisual.removeAttribute("data-editor-selection-bounds-target");
    expect(
      captureFirstDraftDocumentBlockDragSession(
        fixture.editor,
        fixture.viewState,
        headingId,
      ),
    ).toEqual({ blockId: headingId, captureSucceeded: false });
  });

  it("mounts permanent chrome for every visible semantic renderer family", () => {
    const fixture = renderFirstDraft();
    const eligibleBlockIds = [
      "fd-paragraph-intro",
      "fd-heading-1",
      "fd-quote",
      "fd-code",
      "fd-callout",
      "fd-toggle-heading",
      "fd-toggle-list",
      "fd-bullet-1",
      "fd-ordered-1",
      "fd-check-unchecked",
      "fd-tabs",
      "fd-tab-overview",
      "fd-divider",
      "fd-table",
    ];
    for (const blockId of eligibleBlockIds) {
      expect(zoneFor(fixture.container, blockId)).not.toBeNull();
    }
  });

  it("keeps semantic ownership while crossing from real hover zones into visible controls", () => {
    const fixture = renderFirstDraft();
    const cases = [
      ["fd-paragraph-intro", "fd-paragraph-intro"],
      ["fd-heading-1", "fd-heading-1"],
      ["fd-bullet-1", "fd-bullet-1"],
      ["fd-toggle-heading-summary", "fd-toggle-heading"],
      ["fd-toggle-list-summary", "fd-toggle-list"],
      ["fd-callout-text", "fd-callout"],
      ["fd-column-left-heading", "fd-column-left-heading"],
      ["fd-tabs", "fd-tabs"],
      ["fd-tab-overview", "fd-tab-overview"],
      ["fd-table", "fd-table"],
    ] as const;

    for (const [zoneBlockId, ownerBlockId] of cases) {
      const zone = zoneFor(fixture.container, zoneBlockId);
      expect(zone, zoneBlockId).not.toBeNull();
      expect(zone?.childNodes).toHaveLength(0);
      expect(zone?.getAttribute("aria-hidden")).toBe("true");
      expect(zone?.dataset.editorUi).toBe("true");
      expect(zone?.hasAttribute("tabindex")).toBe(false);

      fireEvent.pointerMove(zone!);
      expect(controlsOwner(fixture.container), zoneBlockId).toBe(ownerBlockId);
      const controls = singleControls(fixture.container)!;
      const dragHandle = controls.querySelector<HTMLButtonElement>(
        "button[aria-label='Drag block or open block actions']",
      );
      expect(dragHandle, ownerBlockId).not.toBeNull();
      expect(dragHandle?.getAttribute("aria-haspopup")).toBe("menu");
      expect(dragHandle?.hasAttribute("data-dnd-drag-handle")).toBe(true);

      fireEvent.pointerMove(controls);
      expect(controlsOwner(fixture.container), ownerBlockId).toBe(ownerBlockId);
      expect(singleControls(fixture.container)).toBe(controls);
    }
  });

  it.each([
    {
      toggleId: "fd-toggle-heading",
      bodyId: "fd-toggle-heading-body",
      rendererType: "toggleHeading" as const,
    },
    {
      toggleId: "fd-toggle-list",
      bodyId: "fd-toggle-list-body",
      rendererType: "toggleListItem" as const,
    },
  ])(
    "renders and settles an empty $rendererType body without re-executing its registered renderers",
    ({ toggleId, bodyId, rendererType }) => {
      const onChange = vi.fn();
      let bodyExecutions = 0;
      let toggleExecutions = 0;
      const fixture = renderFirstDraft({
        onChange,
        prepare(editor) {
          const children = editor.getChildBlockIds(id(bodyId));
          expect(
            editor.transaction(() => {
              editor.deleteBlocks({
                blockIds: children,
                includeDescendants: true,
                expectedParents: Object.fromEntries(
                  children.map((blockId) => [blockId, id(bodyId)]),
                ),
              });
              editor.setTransactionSelection({ kind: "clear" });
            }).ok,
          ).toBe(true);
        },
        definition(viewState) {
          const base = createFirstDraftEditorDefinition(viewState);
          const CountingBodyRenderer = (props: FirstDraftBlockRendererProps) => {
            bodyExecutions += 1;
            return <ToggleBodyRenderer {...props} />;
          };
          const CountingToggleRenderer = (
            props: FirstDraftBlockRendererProps,
          ) => {
            toggleExecutions += 1;
            return rendererType === "toggleHeading" ? (
              <ToggleHeadingRenderer {...props} />
            ) : (
              <ToggleListItemRenderer {...props} />
            );
          };
          return {
            ...base,
            blocks: {
              ...base.blocks,
              [rendererType]: {
                ...base.blocks[rendererType]!,
                renderer: CountingToggleRenderer,
              },
              [rendererType === "toggleHeading"
                ? "toggleHeadingBody"
                : "toggleListItemBody"]: {
                ...base.blocks[
                  rendererType === "toggleHeading"
                    ? "toggleHeadingBody"
                    : "toggleListItemBody"
                ]!,
                renderer: CountingBodyRenderer,
              },
            },
          };
        },
      });
      onChange.mockClear();
      const bodyShell = shell(fixture.container, bodyId);
      const initialBodyExecutions = bodyExecutions;
      const initialToggleExecutions = toggleExecutions;
      const button = bodyShell.querySelector<HTMLButtonElement>(
        ".empty-wrapper-add-text-button",
      )!;
      expect(button).not.toBeNull();
      expect(button.type).toBe("button");
      expect(button.getAttribute("aria-label")).toBe("Add paragraph");
      expect(button.dataset.editorUi).toBe("true");
      expect(button.hasAttribute("data-editor-object-root")).toBe(false);
      expect(button.draggable).toBe(false);
      expect(button.hasAttribute("data-first-draft-block-drop-target-active")).toBe(
        false,
      );
      expect(
        bodyShell.querySelector(".first-draft-block-drop-target"),
      ).not.toBeNull();
      expect(
        button.closest<HTMLElement>('[data-editor-block-shell="true"]')
          ?.dataset.editorBlockId,
      ).toBe(bodyId);

      fireEvent.mouseDown(button);
      expect(document.activeElement).not.toBe(button);
      const readBlock = fixture.editor.getBlock.bind(fixture.editor);
      const staleParent = vi
        .spyOn(fixture.editor, "getBlock")
        .mockImplementation((blockId) =>
          blockId === id(bodyId) ? null : readBlock(blockId),
        );
      fireEvent.click(button);
      expect(fixture.editor.getChildBlockIds(id(bodyId))).toEqual([]);
      expect(button.disabled).toBe(false);
      expect(button.isConnected).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
      staleParent.mockRestore();
      fireEvent.click(button);

      expect(onChange).toHaveBeenCalledOnce();
      const children = fixture.editor.getChildBlockIds(id(bodyId));
      expect(children).toHaveLength(1);
      const paragraphId = children[0]!;
      expect(fixture.editor.getBlock(paragraphId)?.type).toBe("paragraph");
      expect(bodyShell.querySelector(".empty-wrapper-add-text-button")).toBeNull();
      expectDocumentSelection(fixture.editor, paragraphId);
      expect(document.activeElement).toBe(textRoot(fixture.container, paragraphId));
      expect(bodyExecutions).toBe(initialBodyExecutions);
      expect(toggleExecutions).toBe(initialToggleExecutions);

      act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
      const restoredButton = bodyShell.querySelector<HTMLButtonElement>(
        ".empty-wrapper-add-text-button",
      )!;
      expect(restoredButton).not.toBeNull();
      expect(fixture.editor.getChildBlockIds(id(bodyId))).toEqual([]);
      act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
      expect(fixture.editor.getChildBlockIds(id(bodyId))).toEqual([paragraphId]);
      expect(bodyShell.querySelector(".empty-wrapper-add-text-button")).toBeNull();
      expect(bodyExecutions).toBe(initialBodyExecutions);
      expect(toggleExecutions).toBe(initialToggleExecutions);

      const disclosure = shell(fixture.container, toggleId).querySelector<HTMLButtonElement>(
        "button[aria-expanded]",
      )!;
      const summaryId = fixture.editor.getChildBlockIds(id(toggleId))[0]!;
      act(() => {
        expect(
          fixture.editor.focusText(paragraphId, {
            offset: 0,
            preventScroll: true,
          }).status,
        ).toBe("focused");
      });
      fireEvent.click(disclosure);
      expect(getComputedStyle(bodyShell).display).toBe("none");
      expectDocumentSelection(fixture.editor, summaryId);
      expect(document.activeElement).toBe(textRoot(fixture.container, summaryId));
      fireEvent.click(disclosure);

      act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
      fireEvent.click(disclosure);
      expect(getComputedStyle(bodyShell).display).toBe("none");
      expect(bodyShell.querySelector(".empty-wrapper-add-text-button")).not.toBeNull();
      const publications = onChange.mock.calls.length;
      fireEvent.click(disclosure);
      expect(getComputedStyle(bodyShell).display).not.toBe("none");
      expect(bodyShell.querySelector(".empty-wrapper-add-text-button")).not.toBeNull();
      expect(onChange).toHaveBeenCalledTimes(publications);
    },
  );

  it("uses the normalized heading level's control inset for headings and toggle headings", () => {
    let toggleHeadingExecutions = 0;
    const fixture = renderFirstDraft({
      definition(viewState) {
        const base = createFirstDraftEditorDefinition(viewState);
        function CountingToggleHeadingRenderer(
          props: FirstDraftBlockRendererProps,
        ) {
          toggleHeadingExecutions += 1;
          return <ToggleHeadingRenderer {...props} />;
        }
        return {
          ...base,
          blocks: {
            ...base.blocks,
            toggleHeading: {
              ...base.blocks.toggleHeading!,
              renderer: CountingToggleHeadingRenderer,
            },
          },
        } as EditableEditorDefinition;
      },
    });
    const toggleHeadingBaseline = toggleHeadingExecutions;
    const cases = [
      ["fd-heading-1", "36px"],
      ["fd-heading-2", "18px"],
      ["fd-column-left-heading", "13px"],
    ] as const;
    for (const [blockId, expectedInset] of cases) {
      expectHoverOwner(fixture.container, blockId, blockId);
      expect(
        singleControls(fixture.container)?.style.getPropertyValue(
          "--first-draft-block-controls-inset-block-start",
        ),
      ).toBe(expectedInset);
    }

    for (const [level, expectedInset] of [
      [1, "36px"],
      [2, "18px"],
      [3, "13px"],
    ] as const) {
      act(() => {
        expect(
          fixture.editor.updateBlockMetadata([
            {
              blockId: id("fd-toggle-heading-summary"),
              values: { level },
            },
          ]),
        ).toBe(true);
      });
      expectHoverOwner(
        fixture.container,
        "fd-toggle-heading-summary",
        "fd-toggle-heading",
      );
      expect(
        singleControls(fixture.container)?.style.getPropertyValue(
          "--first-draft-block-controls-inset-block-start",
        ),
      ).toBe(expectedInset);
      expect(toggleHeadingExecutions).toBe(toggleHeadingBaseline);
    }
  });

  it("renders every ordinary heading level as native semantic DOM while inactive and active", () => {
    const fixture = renderFirstDraft();
    const headingId = id("fd-heading-1");
    const headingShell = shell(fixture.container, headingId);
    const headingLayout = headingShell.querySelector<HTMLElement>(
      ":scope > .heading-block__heading",
    )!;
    const textHost = headingLayout.querySelector<HTMLElement>(
      ":scope > [data-editor-text-shell='true']",
    )!;
    const paragraphShell = shell(fixture.container, "fd-paragraph-intro");
    const paragraphHost = textRoot(fixture.container, "fd-paragraph-intro");

    for (const level of [1, 2, 3] as const) {
      act(() => {
        fixture.editor.updateBlockMetadata([
          { blockId: headingId, values: { level } },
        ]);
      });
      const projection = textHost.querySelector<HTMLElement>(
        ":scope > [data-editor-text-projection='true']",
      )!;
      const semantic = projection.querySelector<HTMLElement>(
        `:scope > h${level}[data-block-node='paragraph'][data-editor-heading-level='${level}']`,
      );
      expect(semantic?.textContent).toContain("Welcome to my Block Editor");
      expect(projection.querySelector(":scope > p[data-block-node]")).toBeNull();
      expect(headingLayout.getAttribute("role")).toBeNull();
      expect(headingLayout.getAttribute("aria-level")).toBeNull();
    }

    let sharedView: ReturnType<typeof requiredActiveTextView> | null = null;
    for (const level of [1, 2, 3] as const) {
      act(() => {
        expect(
          fixture.editor.updateBlockMetadata([
            { blockId: headingId, values: { level } },
          ]),
        ).toBe(true);
        expect(
          fixture.editor.focusText(headingId, {
            offset: 4,
            preventScroll: true,
          }).status,
        ).toBe("focused");
      });
      const view = requiredActiveTextView(fixture.editor);
      sharedView ??= view;
      expect(view).toBe(sharedView);
      expect(document.activeElement).toBe(view.dom);
      expect(nativeCaretOffset(view.dom)).toBe(4);
      expect(
        view.dom.querySelector(
          `:scope > h${level}[data-block-node='paragraph'][data-editor-heading-level='${level}']`,
        ),
      ).not.toBeNull();
      expect(view.dom.querySelector(":scope > p[data-block-node]")).toBeNull();
      expect(shell(fixture.container, headingId)).toBe(headingShell);
      expect(
        headingLayout.querySelector(":scope > [data-editor-text-shell='true']"),
      ).toBe(textHost);
      expect(shell(fixture.container, "fd-paragraph-intro")).toBe(
        paragraphShell,
      );
      expect(textRoot(fixture.container, "fd-paragraph-intro")).toBe(
        paragraphHost,
      );
    }

    expect(
      textRoot(fixture.container, "fd-paragraph-intro").querySelector(
        ":scope > p[data-block-node='paragraph']",
      ),
    ).not.toBeNull();
  });

  it("rejects unsupported levels for ordinary and toggle-summary headings", () => {
    const fixture = renderFirstDraft();
    const headingId = id("fd-heading-1");
    const toggleSummaryId = id("fd-toggle-heading-summary");

    act(() => {
      expect(
        fixture.editor.updateBlockMetadata([
          { blockId: headingId, values: { level: 99 } },
        ]),
      ).toBe(false);
      expect(
        fixture.editor.updateBlockMetadata([
          { blockId: toggleSummaryId, values: { level: 99 } },
        ]),
      ).toBe(false);
    });

    expect(fixture.editor.getBlock(headingId)?.metadata?.level).toBe(1);
    expect(fixture.editor.getBlock(toggleSummaryId)?.metadata?.level).toBe(3);
  });

  it("keeps native heading semantics through typing, deletion, and range replacement transactions", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange });
    const headingId = id("fd-heading-1");
    const headingShell = shell(fixture.container, headingId);
    const headingHost = headingShell.querySelector<HTMLElement>(
      ":scope > .heading-block__heading > [data-editor-text-shell='true']",
    )!;
    act(() => {
      expect(
        fixture.editor.focusText(headingId, {
          offset: 4,
          preventScroll: true,
        }).status,
      ).toBe("focused");
    });
    const view = requiredActiveTextView(fixture.editor);
    const viewDom = view.dom;
    let expectedText = fixture.editor.readBlockPlainText(headingId, "heading");
    onChange.mockClear();

    const assertCommittedEdit = (expectedPublications: number) => {
      expect(fixture.editor.readBlockPlainText(headingId, "heading")).toBe(
        expectedText,
      );
      expect(requiredActiveTextView(fixture.editor)).toBe(view);
      expect(view.dom).toBe(viewDom);
      expect(document.activeElement).toBe(view.dom);
      expect(
        view.dom.querySelector(
          ":scope > h1[data-block-node='paragraph'][data-editor-heading-level='1']",
        ),
      ).not.toBeNull();
      expect(view.dom.querySelector(":scope > p[data-block-node]")).toBeNull();
      expect(shell(fixture.container, headingId)).toBe(headingShell);
      expect(
        headingShell.querySelector(
          ":scope > .heading-block__heading > [data-editor-text-shell='true']",
        ),
      ).toBe(headingHost);
      expect(
        headingHost.querySelectorAll(
          ":scope > [data-editor-text-projection='true'], :scope > [data-editor-text-slot='true'] > .ProseMirror",
        ),
      ).toHaveLength(2);
      expect(
        [...headingHost.querySelectorAll<HTMLElement>(
          ":scope > [data-editor-text-projection='true'], :scope > [data-editor-text-slot='true'] > .ProseMirror",
        )].filter((root) => getComputedStyle(root).display !== "none"),
      ).toEqual([view.dom]);
      expect(onChange).toHaveBeenCalledTimes(expectedPublications);
    };

    act(() => view.dispatch(view.state.tr.insertText("X")));
    expectedText = `${expectedText.slice(0, 4)}X${expectedText.slice(4)}`;
    assertCommittedEdit(1);
    expect(nativeCaretOffset(view.dom)).toBe(5);

    act(() => {
      view.dispatch(view.state.tr.insertText("Y"));
      view.dispatch(view.state.tr.insertText("Z"));
    });
    expectedText = `${expectedText.slice(0, 5)}YZ${expectedText.slice(5)}`;
    assertCommittedEdit(3);
    expect(nativeCaretOffset(view.dom)).toBe(7);

    act(() => {
      const position = view.state.selection.from;
      view.dispatch(view.state.tr.delete(position - 1, position));
    });
    expectedText = `${expectedText.slice(0, 6)}${expectedText.slice(7)}`;
    assertCommittedEdit(4);
    expect(nativeCaretOffset(view.dom)).toBe(6);

    act(() => {
      const position = view.state.selection.from;
      view.dispatch(view.state.tr.delete(position, position + 1));
    });
    expectedText = `${expectedText.slice(0, 6)}${expectedText.slice(7)}`;
    assertCommittedEdit(5);
    expect(nativeCaretOffset(view.dom)).toBe(6);

    act(() => settleActiveTextRange(fixture.editor, headingId, 1, 4));
    expect(nativeSelectionOffsets(view.dom)).toEqual({ anchor: 1, focus: 4 });
    act(() => view.dispatch(view.state.tr.insertText("R")));
    expectedText = `${expectedText.slice(0, 1)}R${expectedText.slice(4)}`;
    assertCommittedEdit(6);
    expect(nativeCaretOffset(view.dom)).toBe(2);

    const selection = fixture.editor.selectionController.getCanonicalSnapshot();
    expect(selection.kind).toBe("document");
    if (selection.kind !== "document") {
      throw new Error("Expected a canonical heading selection");
    }
    expect(selection.snapshot.endpoints.anchor).toMatchObject({
      blockId: headingId,
      textOffset: 2,
    });
    expect(selection.snapshot.endpoints.head).toMatchObject({
      blockId: headingId,
      textOffset: 2,
    });
  });

  it("undoes and redoes a native heading edit without replacing its semantic host", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange });
    const headingId = id("fd-heading-1");
    act(() => {
      expect(fixture.editor.focusText(headingId, { offset: 2 }).status).toBe(
        "focused",
      );
    });
    const view = requiredActiveTextView(fixture.editor);
    const viewDom = view.dom;
    const original = fixture.editor.readBlockPlainText(headingId, "heading");
    onChange.mockClear();

    act(() => view.dispatch(view.state.tr.insertText("!")));
    expect(fixture.editor.readBlockPlainText(headingId, "heading")).toBe(
      `${original.slice(0, 2)}!${original.slice(2)}`,
    );
    expect(nativeCaretOffset(view.dom)).toBe(3);
    expect(onChange).toHaveBeenCalledTimes(1);

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.readBlockPlainText(headingId, "heading")).toBe(original);
    expect(requiredActiveTextView(fixture.editor)).toBe(view);
    expect(view.dom).toBe(viewDom);
    expect(view.dom.querySelector(":scope > h1[data-block-node]")).not.toBeNull();
    expect(view.dom.querySelector(":scope > p[data-block-node]")).toBeNull();
    expect(nativeCaretOffset(view.dom)).toBe(2);

    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.readBlockPlainText(headingId, "heading")).toBe(
      `${original.slice(0, 2)}!${original.slice(2)}`,
    );
    expect(requiredActiveTextView(fixture.editor)).toBe(view);
    expect(view.dom).toBe(viewDom);
    expect(view.dom.querySelector(":scope > h1[data-block-node]")).not.toBeNull();
    expect(nativeCaretOffset(view.dom)).toBe(3);
    expect(onChange.mock.calls.map(([change]) => change.historyAction)).toEqual([
      "command",
      "undo",
      "redo",
    ]);
  });

  it("keeps heading and paragraph semantics while owning a cross-block selection", () => {
    const fixture = renderFirstDraft();
    const headingId = id("fd-heading-1");
    const paragraphId = id("fd-paragraph-byline");
    const points: {
      anchor?: ReturnType<typeof captureMountedTextPoint>;
      head?: ReturnType<typeof captureMountedTextPoint>;
    } = {};
    act(() => {
      points.anchor = captureMountedTextPoint(fixture.editor, headingId, 3);
      points.head = captureMountedTextPoint(fixture.editor, paragraphId, 5);
      settleCrossBlockTextRange(fixture.editor, points.anchor, points.head);
    });
    const selection = fixture.editor.selectionController.getCanonicalSnapshot();
    expect(selection.kind).toBe("document");
    if (selection.kind !== "document") {
      throw new Error("Expected a cross-block canonical selection");
    }
    expect(selection.snapshot.endpoints.anchor).toMatchObject({
      blockId: headingId,
      textOffset: 3,
    });
    expect(selection.snapshot.endpoints.head).toMatchObject({
      blockId: paragraphId,
      textOffset: 5,
    });
    expect(
      shell(fixture.container, headingId).querySelector(
        "h1[data-block-node='paragraph']",
      ),
    ).not.toBeNull();
    expect(
      shell(fixture.container, paragraphId).querySelector(
        "p[data-block-node='paragraph']",
      ),
    ).not.toBeNull();
  });

  it("delegates callout, toggle, and list primary content without swallowing nested content", () => {
    const fixture = renderFirstDraft();

    expectHoverOwner(fixture.container, "fd-quote-text", "fd-quote");
    expectHoverOwner(fixture.container, "fd-code-text", "fd-code");
    expectHoverOwner(fixture.container, "fd-callout-text", "fd-callout");
    expectHoverOwner(
      fixture.container,
      "fd-toggle-heading-summary",
      "fd-toggle-heading",
    );
    expectHoverOwner(
      fixture.container,
      "fd-toggle-heading-body-text",
      "fd-toggle-heading-body-text",
    );
    expectHoverOwner(fixture.container, "fd-bullet-1-text", "fd-bullet-1");
    expectHoverOwner(fixture.container, "fd-ordered-1-text", "fd-ordered-1");
    expectHoverOwner(
      fixture.container,
      "fd-check-unchecked-text",
      "fd-check-unchecked",
    );
    expectHoverOwner(
      fixture.container,
      "fd-bullet-nested-text",
      "fd-bullet-nested",
    );
    expect(
      shell(fixture.container, "fd-bullet-1").querySelector(
        ".list-item-block__marker",
      ),
    ).not.toBeNull();
    expect(
      shell(fixture.container, "fd-ordered-1").querySelector(
        ".list-item-block__marker",
      ),
    ).not.toBeNull();
  });

  it.each([
    {
      kind: "bullet",
      containerId: "fd-bullet-list",
      itemId: "fd-bullet-1",
      primaryId: "fd-bullet-1-text",
      siblingItemId: "fd-bullet-2",
    },
    {
      kind: "ordered",
      containerId: "fd-ordered-list",
      itemId: "fd-ordered-1",
      primaryId: "fd-ordered-1-text",
      siblingItemId: "fd-ordered-2",
    },
    {
      kind: "checklist",
      containerId: "fd-checklist",
      itemId: "fd-check-unchecked",
      primaryId: "fd-check-unchecked-text",
      siblingItemId: "fd-check-checked",
    },
  ])(
    "uses the $kind item identity through the real document DnD provider",
    (testCase) => {
      const onChange = vi.fn();
      const nestedId = id(`runtime-${testCase.kind}-additional`);
      const fixture = renderFirstDraft({
        onChange,
        enableDocumentDnd: true,
        prepare(editor) {
          expect(
            editor.insertBlock({
              blockId: id(testCase.primaryId),
              blockType: "paragraph",
              plainText: "Additional item content",
              createBlockId: () => nestedId,
            }).ok,
          ).toBe(true);
        },
      });
      onChange.mockClear();
      const siblingShell = shell(fixture.container, testCase.siblingItemId);
      const siblingPrimaryId = fixture.editor.getChildBlockIds(
        id(testCase.siblingItemId),
      )[0]!;
      const siblingTextRoot = textRoot(fixture.container, siblingPrimaryId);

      expectHoverOwner(fixture.container, testCase.primaryId, testCase.itemId);
      const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
        "button[aria-label='Drag block or open block actions']",
      )!;
      expect(handle.dataset.firstDraftDraggableBlockId).toBe(testCase.itemId);
      expect(handle.dataset.firstDraftDraggableBlockId).not.toBe(
        testCase.containerId,
      );
      expectHoverOwner(fixture.container, nestedId, nestedId);
      expectHoverOwner(fixture.container, testCase.primaryId, testCase.itemId);
      const activeHandle = singleControls(fixture.container)!.querySelector<HTMLElement>(
        "button[aria-label='Drag block or open block actions']",
      )!;
      const rootTarget = fixture.container.querySelector<HTMLElement>(
        "[data-testid='first-draft-root-start-target']",
      )!;
      installDocumentDragGeometry(activeHandle, rootTarget);

      fireEvent(activeHandle, pointerEvent("pointerdown", 41, 24));
      fireEvent(window, pointerEvent("pointermove", 41, 104));
      flushAnimationFrames();
      expect(rootTarget.dataset.firstDraftBlockDropTargetActive).toBe("true");
      fireEvent(window, pointerEvent("pointerup", 41, 104));

      expect(fixture.documentMove).toHaveBeenCalledOnce();
      expect(fixture.documentMove).toHaveBeenCalledWith(
        expect.objectContaining({
          blockId: id(testCase.itemId),
          parentId: id(testCase.containerId),
        }),
        { parentId: null, childIndex: 0 },
      );
      expect(fixture.editor.getBlock(id(testCase.itemId))).toBeNull();
      expect(fixture.editor.getBlock(id(testCase.containerId))).not.toBeNull();
      expect(fixture.editor.getRootBlockIds().slice(0, 2)).toEqual([
        id(testCase.primaryId),
        nestedId,
      ]);
      expect(shell(fixture.container, testCase.siblingItemId)).toBe(siblingShell);
      expect(textRoot(fixture.container, siblingPrimaryId)).toBe(siblingTextRoot);
      expect(onChange).toHaveBeenCalledOnce();
    },
  );

  it("cancels an active list-item pointer drag without a document transaction", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange, enableDocumentDnd: true });
    expectHoverOwner(fixture.container, "fd-bullet-1-text", "fd-bullet-1");
    const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    const originalItems = fixture.editor.getChildBlockIds(id("fd-bullet-list"));
    installDocumentDragGeometry(handle, rootTarget);

    fireEvent(handle, pointerEvent("pointerdown", 42, 24));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    fireEvent(window, pointerEvent("pointermove", 42, 104));
    expect(document.documentElement.getAttribute(domPointerDragActiveAttribute)).toBe("true");
    expect(
      document.body.querySelector(".first-draft-document-block-drag-overlay"),
    ).not.toBeNull();
    expect(
      fixture.blockDragAndDrop?.captureDocumentBlockDragSession,
    ).toHaveBeenCalledOnce();
    flushAnimationFrames();
    fireEvent(window, pointerEvent("pointercancel", 42, 104));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);

    expect(
      document.body.querySelector(".first-draft-document-block-drag-overlay"),
    ).toBeNull();

    fireEvent(handle, pointerEvent("pointerdown", 142, 24));
    fireEvent(window, pointerEvent("pointermove", 142, 104));
    expect(document.documentElement.getAttribute(domPointerDragActiveAttribute)).toBe("true");
    expect(
      fixture.blockDragAndDrop?.captureDocumentBlockDragSession,
    ).toHaveBeenCalledTimes(2);
    fireEvent(window, pointerEvent("pointercancel", 142, 104));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);

    expect(fixture.documentMove).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(fixture.editor.getChildBlockIds(id("fd-bullet-list"))).toEqual(
      originalItems,
    );
    expect(rootTarget.dataset.firstDraftBlockDropTargetActive).toBe("false");
  });

  it("does not mount a package overlay for a quick release before activation", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange, enableDocumentDnd: true });
    expectHoverOwner(fixture.container, "fd-paragraph-intro", "fd-paragraph-intro");
    const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    installDocumentDragGeometry(handle, rootTarget);

    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    fireEvent(handle, pointerEvent("pointerdown", 46, 24));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    fireEvent(window, pointerEvent("pointerup", 46, 24));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);

    expect(
      document.body.querySelector(".first-draft-document-block-drag-overlay"),
    ).toBeNull();
    expect(
      fixture.blockDragAndDrop?.captureDocumentBlockDragSession,
    ).not.toHaveBeenCalled();
    expect(fixture.documentMove).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets the package marker own the active pointer cursor without pointer-move rerenders", () => {
    let paragraphExecutions = 0;
    const fixture = renderFirstDraft({
      enableDocumentDnd: true,
      definition(viewState) {
        const base = createFirstDraftEditorDefinition(viewState);
        function CountingParagraphRenderer(
          props: FirstDraftBlockRendererProps,
        ) {
          paragraphExecutions += 1;
          return <ParagraphRenderer {...props} />;
        }
        return {
          ...base,
          blocks: {
            ...base.blocks,
            paragraph: {
              ...base.blocks.paragraph,
              renderer: CountingParagraphRenderer,
            },
          },
        } as EditableEditorDefinition;
      },
    });
    const sourceId = id("fd-paragraph-intro");
    expectHoverOwner(fixture.container, sourceId, sourceId);
    const controls = singleControls(fixture.container)!;
    const handle = controls.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const addButton = controls.querySelector<HTMLElement>(
      "button[aria-label='Add block below']",
    )!;
    const text = textRoot(fixture.container, sourceId);
    const resizeHandle = fixture.container.querySelector<HTMLElement>(
      ".columns-block__resize-handle",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    installDocumentDragGeometry(handle, rootTarget);

    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    expect(getComputedStyle(handle).cursor).toBe("grab");
    expect(getComputedStyle(text).cursor).toBe("text");
    expect(getComputedStyle(addButton).cursor).toBe("pointer");
    expect(getComputedStyle(resizeHandle).cursor).toBe("col-resize");

    fireEvent(handle, pointerEvent("pointerdown", 63, 24));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    expect(getComputedStyle(handle).cursor).toBe("grab");
    fireEvent(window, pointerEvent("pointermove", 63, 27));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    expect(getComputedStyle(handle).cursor).toBe("grab");
    fireEvent(window, pointerEvent("pointermove", 63, 104));
    expect(document.documentElement.getAttribute(domPointerDragActiveAttribute)).toBe("true");
    // JSDOM drops computed cursor application for a selector group containing
    // pseudo-elements, so runtime coverage proves marker/selector matching;
    // the CSS contract test proves the grouped !important declaration.
    for (const element of [text, addButton, resizeHandle]) {
      expect(
        element.matches(
          `:root[${domPointerDragActiveAttribute}="true"] *`,
        ),
      ).toBe(true);
    }
    const executionsAtActivation = paragraphExecutions;

    fireEvent(window, pointerEvent("pointermove", 63, 116));
    fireEvent(window, pointerEvent("pointermove", 63, 132));
    expect(paragraphExecutions).toBe(executionsAtActivation);
    expect(
      fixture.blockDragAndDrop?.captureDocumentBlockDragSession,
    ).toHaveBeenCalledOnce();

    fireEvent(window, pointerEvent("pointerup", 63, 132));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    expect(fixture.documentMove).toHaveBeenCalledOnce();
    expect(getComputedStyle(textRoot(fixture.container, sourceId)).cursor).toBe(
      "text",
    );
    expect(getComputedStyle(resizeHandle).cursor).toBe("col-resize");
  });

  it("removes the package cursor marker when an active provider unmounts", () => {
    const fixture = renderFirstDraft({ enableDocumentDnd: true });
    expectHoverOwner(fixture.container, "fd-paragraph-intro", "fd-paragraph-intro");
    const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    installDocumentDragGeometry(handle, rootTarget);

    fireEvent(handle, pointerEvent("pointerdown", 64, 24));
    fireEvent(window, pointerEvent("pointermove", 64, 104));
    expect(document.documentElement.getAttribute(domPointerDragActiveAttribute)).toBe("true");

    fixture.unmount();
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
  });

  it.each(["Enter", " "])(
    "does not create the pointer marker for drag-handle keyboard key %j",
    (key) => {
      const fixture = renderFirstDraft({ enableDocumentDnd: true });
      expectHoverOwner(
        fixture.container,
        "fd-paragraph-intro",
        "fd-paragraph-intro",
      );
      const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
        "button[aria-label='Drag block or open block actions']",
      )!;

      handle.focus();
      fireEvent.keyDown(handle, { key });

      expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
      expect(
        fixture.blockDragAndDrop?.captureDocumentBlockDragSession,
      ).not.toHaveBeenCalled();
      expect(
        document.body.querySelector(".first-draft-document-block-drag-overlay"),
      ).toBeNull();
    },
  );

  it("coordinates the package cursor marker across two mounted providers", () => {
    const first = renderFirstDraft({ enableDocumentDnd: true });
    const second = renderFirstDraft({ enableDocumentDnd: true });
    expectHoverOwner(first.container, "fd-paragraph-intro", "fd-paragraph-intro");
    expectHoverOwner(second.container, "fd-paragraph-intro", "fd-paragraph-intro");
    const firstHandle = singleControls(first.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const secondHandle = singleControls(second.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const firstTarget = first.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    const secondTarget = second.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this === firstHandle) return domRect(20, 20, 120, 28);
        if (this === secondHandle) return domRect(420, 20, 120, 28);
        if (this === firstTarget) return domRect(20, 100, 600, 8);
        if (this === secondTarget) return domRect(420, 100, 600, 8);
        return domRect(20, 500, 600, 8);
      },
    );

    fireEvent(firstHandle, pointerEvent("pointerdown", 65, 24));
    fireEvent(window, pointerEvent("pointermove", 65, 104));
    expect(document.documentElement.getAttribute(domPointerDragActiveAttribute)).toBe("true");
    fireEvent(secondHandle, pointerEvent("pointerdown", 66, 24));
    fireEvent(window, pointerEvent("pointermove", 66, 104));
    expect(document.documentElement.getAttribute(domPointerDragActiveAttribute)).toBe("true");

    fireEvent(window, pointerEvent("pointercancel", 65, 104));
    expect(document.documentElement.getAttribute(domPointerDragActiveAttribute)).toBe("true");
    fireEvent(window, pointerEvent("pointercancel", 66, 104));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
  });

  it("ends a list-item pointer drag released with no connected target without a transaction", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange, enableDocumentDnd: true });
    expectHoverOwner(fixture.container, "fd-bullet-1-text", "fd-bullet-1");
    const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    fixture.container
      .querySelectorAll<HTMLElement>(".first-draft-block-drop-target")
      .forEach((target) => target.remove());
    const originalItems = fixture.editor.getChildBlockIds(id("fd-bullet-list"));
    installDocumentDragGeometry(handle, rootTarget);

    fireEvent(handle, pointerEvent("pointerdown", 45, 24));
    fireEvent(window, pointerEvent("pointermove", 45, 104));
    expect(document.documentElement.getAttribute(domPointerDragActiveAttribute)).toBe("true");
    flushAnimationFrames();
    fireEvent(window, pointerEvent("pointerup", 45, 104));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);

    expect(fixture.documentMove).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(fixture.editor.getChildBlockIds(id("fd-bullet-list"))).toEqual(
      originalItems,
    );
  });

  it("keeps a captured preview after source deletion and commits no stale move", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange, enableDocumentDnd: true });
    const sourceId = id("fd-paragraph-outro");
    expectHoverOwner(fixture.container, sourceId, sourceId);
    const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    installDocumentDragGeometry(handle, rootTarget);

    fireEvent(handle, pointerEvent("pointerdown", 47, 24));
    fireEvent(window, pointerEvent("pointermove", 47, 104));
    flushAnimationFrames();
    const capturedOverlay = document.body.querySelector<HTMLElement>(
      ".first-draft-document-block-drag-overlay",
    );
    expect(capturedOverlay).not.toBeNull();

    act(() => {
      const deleted = fixture.editor.transaction(() => {
        fixture.editor.deleteBlocks({
          blockIds: [sourceId],
          includeDescendants: true,
          expectedParents: { [sourceId]: null },
        });
        fixture.editor.setTransactionSelection({ kind: "preserve" });
      });
      expect(deleted.ok).toBe(true);
    });
    expect(fixture.editor.getBlock(sourceId)).toBeNull();
    expect(capturedOverlay?.isConnected).toBe(true);
    expect(onChange).toHaveBeenCalledOnce();

    fireEvent(window, pointerEvent("pointerup", 47, 104));

    expect(fixture.documentMove).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    expect(fixture.editor.getBlock(sourceId)).toBeNull();
    expect(
      document.body.querySelector(".first-draft-document-block-drag-overlay"),
    ).toBeNull();
  });

  it("keeps a failed activation blank and out of document movement", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange, enableDocumentDnd: true });
    const sourceId = id("fd-paragraph-outro");
    expectHoverOwner(fixture.container, sourceId, sourceId);
    const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    installDocumentDragGeometry(handle, rootTarget);
    vi.mocked(
      fixture.blockDragAndDrop!.captureDocumentBlockDragSession,
    ).mockReturnValue(
      Object.freeze({ blockId: sourceId, captureSucceeded: false }),
    );

    fireEvent(handle, pointerEvent("pointerdown", 48, 24));
    fireEvent(window, pointerEvent("pointermove", 48, 104));
    expect(document.documentElement.getAttribute(domPointerDragActiveAttribute)).toBe("true");
    const overlay = document.body.querySelector<HTMLElement>(
      ".first-draft-document-block-drag-overlay",
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.childElementCount).toBe(0);
    expect(overlay?.classList).not.toContain("first-draft-example");
    expect(rootTarget.dataset.firstDraftBlockDropTargetActive).toBe("false");
    fireEvent(window, pointerEvent("pointerup", 48, 104));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);

    expect(fixture.documentMove).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(
      document.body.querySelector(".first-draft-document-block-drag-overlay"),
    ).toBeNull();
  });

  it("fails a real provider activation when a required visual target is missing", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange, enableDocumentDnd: true });
    const sourceId = id("fd-heading-1");
    expectHoverOwner(fixture.container, sourceId, sourceId);
    const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    shell(fixture.container, sourceId)
      .querySelector(".heading-block__heading")
      ?.removeAttribute("data-editor-selection-bounds-target");
    installDocumentDragGeometry(handle, rootTarget);

    fireEvent(handle, pointerEvent("pointerdown", 62, 24));
    fireEvent(window, pointerEvent("pointermove", 62, 104));
    expect(document.documentElement.getAttribute(domPointerDragActiveAttribute)).toBe("true");
    const overlay = document.body.querySelector<HTMLElement>(
      ".first-draft-document-block-drag-overlay",
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.childElementCount).toBe(0);
    expect(rootTarget.dataset.firstDraftBlockDropTargetActive).toBe("false");
    fireEvent(window, pointerEvent("pointerup", 62, 104));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);

    expect(fixture.documentMove).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(fixture.editor.getBlock(sourceId)).not.toBeNull();
    expect(
      document.body.querySelector(".first-draft-document-block-drag-overlay"),
    ).toBeNull();
  });

  it("does not move a source reordered after activation a second time", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange, enableDocumentDnd: true });
    const sourceId = id("fd-paragraph-outro");
    expectHoverOwner(fixture.container, sourceId, sourceId);
    const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    installDocumentDragGeometry(handle, rootTarget);

    fireEvent(handle, pointerEvent("pointerdown", 49, 24));
    fireEvent(window, pointerEvent("pointermove", 49, 104));
    flushAnimationFrames();
    act(() => {
      expect(
        fixture.editor.moveBlockToPosition({
          blockId: sourceId,
          position: { parentId: null, childIndex: 1 },
        }),
      ).toMatchObject({ ok: true });
    });
    expect(fixture.editor.getRootBlockIds().indexOf(sourceId)).toBe(1);
    expect(onChange).toHaveBeenCalledOnce();

    fireEvent(window, pointerEvent("pointerup", 49, 104));

    expect(fixture.documentMove).toHaveBeenCalledOnce();
    expect(fixture.editor.getRootBlockIds().indexOf(sourceId)).toBe(1);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("does not move a source reparented after activation a second time", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange, enableDocumentDnd: true });
    const sourceId = id("fd-paragraph-outro");
    const remoteParentId = id("fd-tab-overview");
    expectHoverOwner(fixture.container, sourceId, sourceId);
    const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    installDocumentDragGeometry(handle, rootTarget);

    fireEvent(handle, pointerEvent("pointerdown", 53, 24));
    fireEvent(window, pointerEvent("pointermove", 53, 104));
    flushAnimationFrames();
    act(() => {
      expect(
        fixture.editor.moveBlockToPosition({
          blockId: sourceId,
          position: {
            parentId: remoteParentId,
            childIndex: fixture.editor.getChildBlockIds(remoteParentId).length,
          },
        }),
      ).toMatchObject({ ok: true });
    });
    expect(fixture.editor.getParentId(sourceId)).toBe(remoteParentId);
    expect(onChange).toHaveBeenCalledOnce();

    fireEvent(window, pointerEvent("pointerup", 53, 104));

    expect(fixture.documentMove).toHaveBeenCalledOnce();
    expect(fixture.editor.getParentId(sourceId)).toBe(remoteParentId);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("transports rich and nested previews through the real provider without editor ownership", () => {
    const richId = id("runtime-rich-drag-preview");
    const fixture = renderFirstDraft({
      enableDocumentDnd: true,
      prepare(editor) {
        expect(
          editor.insertBlock({
            blockId: id("fd-paragraph-intro"),
            blockType: "paragraph",
            content: richTextDocumentWithInlineContent(
              "paragraph",
              createBlockRichTextContentFromPlainText("paragraph", ""),
              [
                {
                  type: "text",
                  text: "Marked",
                  marks: [{ type: "strong" }],
                },
                {
                  type: "text",
                  text: " link",
                  marks: [{
                    type: "link",
                    attrs: { href: "https://example.com" },
                  }],
                },
                { type: "mention", metadata: { id: "preview-person" } },
              ],
            ),
            createBlockId: () => richId,
          }),
        ).toMatchObject({ ok: true });
      },
    });
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;

    expectHoverOwner(fixture.container, richId, richId);
    let handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    installDocumentDragGeometry(handle, rootTarget);
    fireEvent(handle, pointerEvent("pointerdown", 50, 24));
    fireEvent(window, pointerEvent("pointermove", 50, 104));
    let overlay = document.body.querySelector<HTMLElement>(
      ".first-draft-document-block-drag-overlay",
    )!;
    expect(overlay.classList).not.toContain("first-draft-example");
    expectTransparentBackground(overlay);
    expectTransparentBackground(
      overlay.querySelector<HTMLElement>(
        '[data-first-draft-preview-block-type="paragraph"]',
      )!,
    );
    expectTransparentBackground(
      overlay.querySelector<HTMLElement>(".paragraph-block__paragraph")!,
    );
    expectTransparentBackground(
      overlay.querySelector<HTMLElement>(".editor-web-text")!,
    );
    expect(overlay.querySelector("strong")?.textContent).toBe("Marked");
    expect(overlay.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com",
    );
    expect(overlay.querySelector("[data-editor-inline-atom='true']")).not.toBeNull();
    expectForbiddenPreviewOwnership(overlay);
    fireEvent(window, pointerEvent("pointercancel", 50, 104));

    vi.restoreAllMocks();
    expectHoverOwner(fixture.container, "fd-tabs", "fd-tabs", ".tabs-block__tabs");
    handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    installDocumentDragGeometry(handle, rootTarget);
    fireEvent(handle, pointerEvent("pointerdown", 51, 24));
    fireEvent(window, pointerEvent("pointermove", 51, 104));
    overlay = document.body.querySelector<HTMLElement>(
      ".first-draft-document-block-drag-overlay",
    )!;
    expect(overlay.querySelectorAll(".tabs-block__tab").length).toBeGreaterThan(1);
    expect(overlay.querySelectorAll(".tabs-block__pane:not([hidden])")).toHaveLength(1);
    expectForbiddenPreviewOwnership(overlay);
    fireEvent(window, pointerEvent("pointercancel", 51, 104));
  });

  it.each([
    {
      kind: "heading",
      sourceId: "fd-heading-1",
      hoverId: "fd-heading-1",
      ownerId: "fd-heading-1",
      liveVisualSelector: ".heading-block__heading",
      previewVisualSelector: ".heading-block__heading",
      visualRect: { left: 64, top: 48, width: 520, height: 42 },
    },
    {
      kind: "table grid",
      sourceId: "fd-table",
      hoverId: "fd-table-cell-1-1",
      ownerId: "fd-table",
      liveVisualSelector: ".table-block__grid",
      previewVisualSelector: ".table-block__grid",
      visualRect: { left: -160, top: 72, width: 920, height: 280 },
    },
  ])(
    "uses corrected $kind bounds through the installed provider",
    (testCase) => {
      const onChange = vi.fn();
      const fixture = renderFirstDraft({ onChange, enableDocumentDnd: true });
      expectHoverOwner(
        fixture.container,
        testCase.hoverId,
        testCase.ownerId,
      );
      const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
        "button[aria-label='Drag block or open block actions']",
      )!;
      const sourceShell = shell(fixture.container, testCase.sourceId);
      const liveVisual = sourceShell.querySelector<HTMLElement>(
        testCase.liveVisualSelector,
      )!;
      const rootTarget = fixture.container.querySelector<HTMLElement>(
        "[data-testid='first-draft-root-start-target']",
      )!;
      const tableObject = sourceShell.querySelector<HTMLElement>(
        ".table-block__object",
      );
      const tableScroll = sourceShell.querySelector<HTMLElement>(
        ".table-block__scroll",
      );
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
        function (this: HTMLElement) {
          if (this === handle) return domRect(20, 20, 24, 24);
          if (this === sourceShell) return domRect(-40, 8, 680, 420);
          if (this === liveVisual) {
            return domRect(
              testCase.visualRect.left,
              testCase.visualRect.top,
              testCase.visualRect.width,
              testCase.visualRect.height,
            );
          }
          if (this === tableObject) return domRect(-20, 24, 660, 380);
          if (this === tableScroll) return domRect(0, 44, 600, 320);
          if (this === rootTarget) return domRect(20, 460, 600, 8);
          if (
            this.classList.contains(
              "first-draft-document-block-drag-overlay",
            )
          ) {
            return domRect(
              testCase.visualRect.left,
              testCase.visualRect.top,
              testCase.visualRect.width,
              testCase.visualRect.height,
            );
          }
          return domRect(20, 700, 600, 8);
        },
      );
      vi.spyOn(window, "requestAnimationFrame").mockImplementation(
        (callback) => {
          frames.push(callback);
          return frames.length;
        },
      );
      vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
        () => undefined,
      );

      fireEvent(handle, pointerEvent("pointerdown", 61, 24));
      fireEvent(window, pointerEvent("pointermove", 61, 104));

      const overlay = document.body.querySelector<HTMLElement>(
        ".first-draft-document-block-drag-overlay",
      )!;
      expect(overlay).not.toBeNull();
      expect(overlay.style.width).toBe(`${testCase.visualRect.width}px`);
      expect(overlay.style.minHeight).toBe(`${testCase.visualRect.height}px`);
      expect(overlay.style.transform).toBe(
        `translate3d(${testCase.visualRect.left - 20}px, ${testCase.visualRect.top - 20}px, 0)`,
      );
      const previewVisual = overlay.querySelector<HTMLElement>(
        testCase.previewVisualSelector,
      )!;
      expect(previewVisual).not.toBeNull();
      expectForbiddenPreviewOwnership(overlay);
      expect(
        fixture.blockDragAndDrop?.captureDocumentBlockDragSession,
      ).toHaveBeenCalledOnce();
      const session = vi.mocked(
        fixture.blockDragAndDrop!.captureDocumentBlockDragSession,
      ).mock.results[0]?.value;
      expect(session).toMatchObject({
        captureSucceeded: true,
        sourceRect: testCase.visualRect,
      });

      if (testCase.kind === "heading") {
        const computed = getComputedStyle(previewVisual);
        expect(computed.marginTop).toBe("0px");
        expect(computed.marginBottom).toBe("0px");
      } else {
        expect(overlay.querySelectorAll(".table-block__grid")).toHaveLength(1);
        expect(
          overlay.querySelector(
            ".table-block__object, .table-block__scroll, .table-block__frame, .table-block__grid-stack",
          ),
        ).toBeNull();
        expect(
          previewVisual.style.getPropertyValue(
            "--first-draft-table-tracks",
          ),
        ).not.toBe("");
        expect(getComputedStyle(previewVisual).inlineSize).toBe("100%");
      }

      fireEvent(window, pointerEvent("pointermove", 61, 132));
      expect(
        fixture.blockDragAndDrop?.captureDocumentBlockDragSession,
      ).toHaveBeenCalledOnce();
      expect(onChange).not.toHaveBeenCalled();
      for (const callback of frames.splice(0)) callback(performance.now());
      fireEvent(window, pointerEvent("pointercancel", 61, 132));
      expect(
        document.body.querySelector(
          ".first-draft-document-block-drag-overlay",
        ),
      ).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("adds no settlement or canonical work after the grip clears active text selection", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange, enableDocumentDnd: true });
    const sourceId = id("fd-paragraph-intro");
    act(() => {
      expect(
        fixture.editor.focusText(sourceId, { offset: 3, preventScroll: true }),
      ).toEqual({ status: "focused" });
    });
    const selectionSettlements = vi.fn();
    const unsubscribe = fixture.editor.subscribeStandaloneSelectionSettlements(
      selectionSettlements,
    );
    const sourceShell = shell(fixture.container, sourceId);
    fireEvent.pointerMove(activeTextRoot(fixture.container));
    const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    installDocumentDragGeometry(handle, rootTarget);

    fireEvent(handle, pointerEvent("pointerdown", 52, 24));
    expect(selectionSettlements).toHaveBeenCalledOnce();
    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({ kind: "none" });
    fireEvent(window, pointerEvent("pointermove", 52, 104));
    fireEvent(window, pointerEvent("pointermove", 52, 116));
    expect(selectionSettlements).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    const overlay = document.body.querySelector<HTMLElement>(
      ".first-draft-document-block-drag-overlay",
    )!;
    expectForbiddenPreviewOwnership(overlay);
    expect(shell(fixture.container, sourceId)).toBe(sourceShell);
    fireEvent(window, pointerEvent("pointercancel", 52, 116));
    expect(selectionSettlements).toHaveBeenCalledOnce();

    act(() => {
      expect(
        fixture.editor.focusText(sourceId, { offset: 0, preventScroll: true }),
      ).toEqual({ status: "focused" });
      expect(
        fixture.editor.insertText({ blockId: sourceId, offset: 0, text: "x" }),
      ).toBe(true);
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(textRoot(fixture.container, sourceId).textContent).toContain("x");
    unsubscribe();
  });

  it.each([
    {
      kind: "bullet",
      containerId: "fd-bullet-list",
      itemId: "fd-bullet-1",
      primaryId: "fd-bullet-1-text",
    },
    {
      kind: "ordered",
      containerId: "fd-ordered-list",
      itemId: "fd-ordered-1",
      primaryId: "fd-ordered-1-text",
    },
    {
      kind: "checklist",
      containerId: "fd-checklist",
      itemId: "fd-check-unchecked",
      primaryId: "fd-check-unchecked-text",
    },
  ])(
    "removes a final $kind container through one real pointer drop and supports undo/redo",
    (testCase) => {
      const onChange = vi.fn();
      const additionalId = id(`runtime-final-${testCase.kind}-additional`);
      const fixture = renderFirstDraft({
        onChange,
        enableDocumentDnd: true,
        prepare(editor) {
          expect(
            editor.insertBlock({
              blockId: id(testCase.primaryId),
              blockType: "paragraph",
              plainText: "Final promoted child",
              createBlockId: () => additionalId,
            }).ok,
          ).toBe(true);
          const otherItems = editor
            .getChildBlockIds(id(testCase.containerId))
            .filter((blockId) => blockId !== id(testCase.itemId));
          const result = editor.transaction(() => {
            editor.deleteBlocks({
              blockIds: otherItems,
              includeDescendants: true,
              expectedParents: Object.fromEntries(
                otherItems.map((blockId) => [blockId, id(testCase.containerId)]),
              ),
            });
            editor.setTransactionSelection({ kind: "preserve" });
          });
          expect(result.ok).toBe(true);
        },
      });
      const originalRoots = [...fixture.editor.getRootBlockIds()];
      onChange.mockClear();
      expectHoverOwner(fixture.container, testCase.primaryId, testCase.itemId);
      const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
        "button[aria-label='Drag block or open block actions']",
      )!;
      const rootTarget = fixture.container.querySelector<HTMLElement>(
        "[data-testid='first-draft-root-start-target']",
      )!;
      installDocumentDragGeometry(handle, rootTarget);

      fireEvent(handle, pointerEvent("pointerdown", 44, 24));
      fireEvent(window, pointerEvent("pointermove", 44, 104));
      flushAnimationFrames();
      fireEvent(window, pointerEvent("pointerup", 44, 104));

      expect(fixture.documentMove).toHaveBeenCalledOnce();
      expect(fixture.editor.getBlock(id(testCase.itemId))).toBeNull();
      expect(fixture.editor.getBlock(id(testCase.containerId))).toBeNull();
      expect(fixture.editor.getRootBlockIds().slice(0, 2)).toEqual([
        id(testCase.primaryId),
        additionalId,
      ]);
      expect(onChange).toHaveBeenCalledOnce();
      act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
      expect(fixture.editor.getRootBlockIds()).toEqual(originalRoots);
      expect(fixture.editor.getChildBlockIds(id(testCase.containerId))).toEqual([
        id(testCase.itemId),
      ]);
      act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
      expect(fixture.editor.getBlock(id(testCase.containerId))).toBeNull();
      expect(onChange).toHaveBeenCalledTimes(3);
    },
  );

  it("keeps list-container and between-item positions out of the real drop-target lane", () => {
    const fixture = renderFirstDraft({ enableDocumentDnd: true });
    const registry = createFirstDraftBlockPlacementRegistry(fixture.editor);
    const listId = id("fd-bullet-list");
    const firstItemId = id("fd-bullet-1");
    const secondItemId = id("fd-bullet-2");
    const firstTextId = id("fd-bullet-1-text");
    const listShell = shell(fixture.container, listId);
    const firstItemShell = shell(fixture.container, firstItemId);
    const secondItemShell = shell(fixture.container, secondItemId);
    const directTargetsBefore = listShell.querySelectorAll(
      ":scope > .first-draft-block-drop-target",
    ).length;

    expect(
      registry.get(
        createFirstDraftBlockDropTargetId({
          kind: "wrapper-child-start",
          wrapperId: listId,
        }),
      ),
    ).toBeNull();
    expect(
      registry.get(
        createFirstDraftBlockDropTargetId({
          kind: "after-block",
          blockId: firstItemId,
        }),
      ),
    ).toBeNull();
    expect(
      registry.get(
        createFirstDraftBlockDropTargetId({
          kind: "after-block",
          blockId: listId,
        }),
      ),
    ).toEqual({
      parentId: null,
      childIndex: fixture.editor.getRootBlockIds().indexOf(listId) + 1,
    });
    expect(
      registry.get(
        createFirstDraftBlockDropTargetId({
          kind: "after-block",
          blockId: firstTextId,
        }),
      ),
    ).toEqual({ parentId: firstItemId, childIndex: 1 });
    expect(firstItemShell.nextElementSibling).toBe(secondItemShell);
    expect(directTargetsBefore).toBe(1);

    expectHoverOwner(fixture.container, firstTextId, firstItemId);
    const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    installDocumentDragGeometry(handle, rootTarget);
    fireEvent(handle, pointerEvent("pointerdown", 43, 24));
    fireEvent(window, pointerEvent("pointermove", 43, 104));
    flushAnimationFrames();

    expect(firstItemShell.nextElementSibling).toBe(secondItemShell);
    expect(
      listShell.querySelectorAll(":scope > .first-draft-block-drop-target"),
    ).toHaveLength(directTargetsBefore);
    fireEvent(window, pointerEvent("pointercancel", 43, 104));
  });

  it("keeps list markers and content in the shared editable grid structure", () => {
    const fixture = renderFirstDraft();

    for (const blockId of ["fd-bullet-1", "fd-ordered-1"] as const) {
      const item = shell(fixture.container, blockId).querySelector(
        ":scope > .list-item-block__item",
      );
      expect(item).not.toBeNull();
      expect(item!.children).toHaveLength(2);
      expect(
        item!.children[0]?.classList.contains("list-item-block__marker"),
      ).toBe(true);
      expect(
        item!.children[1]?.matches('[data-editor-block-shell="true"]'),
      ).toBe(true);
      expect(item!.querySelector(":scope > .first-draft-block-drop-target")).toBeNull();
    }

    for (const [blockId, checked] of [
      ["fd-check-unchecked", false],
      ["fd-check-checked", true],
    ] as const) {
      const item = shell(fixture.container, blockId).querySelector(
        ":scope > .checklist-block__item",
      );
      const checkboxes = item?.querySelectorAll(
        ":scope > input[type='checkbox']",
      );
      expect(item).not.toBeNull();
      expect(item!.children).toHaveLength(2);
      expect(checkboxes).toHaveLength(1);
      expect(item!.children[0]).toBe(checkboxes![0]);
      expect(
        item!.children[1]?.matches('[data-editor-block-shell="true"]'),
      ).toBe(true);
      expect(item!.querySelector(":scope > .first-draft-block-drop-target")).toBeNull();
      expect((checkboxes![0] as HTMLInputElement).checked).toBe(checked);
      expect((checkboxes![0] as HTMLInputElement).disabled).toBe(false);
      expect(checkboxes![0]?.getAttribute("aria-label")).toBe(
        "Checklist item complete",
      );
    }
  });

  it("renders the callout body and toggle shells without duplicate canonical ownership", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange });
    const calloutShell = shell(fixture.container, "fd-callout");
    const callout = calloutShell.querySelector<HTMLElement>(
      ":scope > .callout-block__callout",
    );
    expect(callout).not.toBeNull();
    expect(
      callout!.querySelector(":scope > .first-draft-block-drop-target"),
    ).toBeNull();
    expect([...callout!.children].map((child) => child.className)).toEqual([
      "callout-block__icon-wrap",
      "callout-block__body",
    ]);
    const calloutBody = callout!.querySelector<HTMLElement>(
      ":scope > .callout-block__body",
    )!;
    const calloutChild = shell(fixture.container, "fd-callout-text");
    expect(calloutBody.matches('[data-editor-block-shell="true"]')).toBe(false);
    expect(calloutChild.parentElement).toBe(calloutBody);
    expect(getComputedStyle(callout!).display).toBe("flex");
    expect(getComputedStyle(calloutBody).paddingTop).toBe("0.75rem");
    expect(getComputedStyle(calloutBody).paddingRight).toBe("0px");
    expect(getComputedStyle(calloutBody).paddingBottom).toBe("0.75rem");
    expect(getComputedStyle(calloutBody).paddingLeft).toBe("0px");
    expect(getComputedStyle(callout!).gap).toBe("0.75rem");
    const iconWrap = callout!.querySelector<HTMLElement>(
      ":scope > .callout-block__icon-wrap",
    )!;
    const iconButton = iconWrap.querySelector<HTMLButtonElement>(
      "button[aria-label='Change callout icon']",
    )!;
    fireEvent.click(iconButton);
    const picker = iconWrap.querySelector<HTMLElement>(
      ":scope > .callout-block__picker",
    );
    expect(picker).not.toBeNull();
    expect(picker!.parentElement).toBe(iconWrap);
    expect(onChange).not.toHaveBeenCalled();
    const iconOptions = [
      ...picker!.querySelectorAll<HTMLButtonElement>(":scope > button[role='menuitem']"),
    ];
    expect(iconOptions).toHaveLength(4);
    expect(iconOptions.map((option) => option.getAttribute("aria-label"))).toEqual(
      FIRST_DRAFT_CALLOUT_ICONS.map((candidate) => candidate.label),
    );
    expect(iconOptions.map((option) => option.textContent)).toEqual(
      FIRST_DRAFT_CALLOUT_ICONS.map((candidate) => candidate.glyph),
    );
    for (const option of iconOptions) {
      expect(option.children).toHaveLength(1);
      expect(option.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    }
    fireEvent.click(iconOptions[2]!);
    expect(iconWrap.querySelector(":scope > .callout-block__picker")).toBeNull();
    expect(fixture.editor.getBlock(id("fd-callout"))?.metadata?.icon).toBe(
      "warning",
    );
    expect(onChange).toHaveBeenCalledTimes(1);

    for (const [toggleId, layoutClass, summaryId, bodyId] of [
      [
        "fd-toggle-heading",
        ".toggle-heading-block__toggle",
        "fd-toggle-heading-summary",
        "fd-toggle-heading-body",
      ],
      [
        "fd-toggle-list",
        ".toggle-list-item-block__toggle",
        "fd-toggle-list-summary",
        "fd-toggle-list-body",
      ],
    ] as const) {
      const toggleShell = shell(fixture.container, toggleId);
      const layout = toggleShell.querySelector<HTMLElement>(
        `:scope > ${layoutClass}`,
      );
      expect(layout).not.toBeNull();
      expect([...layout!.children].map((child) =>
        child.matches('[data-editor-block-shell="true"]')
          ? child.getAttribute("data-editor-block-id")
          : child.matches("button")
            ? "disclosure"
            : child.className,
      )).toEqual([
        "disclosure",
        summaryId,
        bodyId,
        "first-draft-block-drop-target",
      ]);
      const bodyShell = shell(fixture.container, bodyId);
      const disclosure = layout!.querySelector<HTMLButtonElement>(
        ":scope > button",
      )!;
      expect(disclosure.type).toBe("button");
      expect(disclosure.getAttribute("aria-expanded")).toBe("true");
      expect(bodyShell.hidden).toBe(false);
      fireEvent.click(disclosure);
      expect(disclosure.getAttribute("aria-expanded")).toBe("false");
      expect(bodyShell.hidden).toBe(false);
      expect(getComputedStyle(bodyShell).display).toBe("none");
      expect(shell(fixture.container, bodyId)).toBe(bodyShell);
      expect(
        fixture.container.querySelectorAll(
          `[data-editor-block-shell="true"][data-editor-block-id="${bodyId}"]`,
        ),
      ).toHaveLength(1);
      fireEvent.click(disclosure);
      expect(disclosure.getAttribute("aria-expanded")).toBe("true");
      expect(getComputedStyle(bodyShell).display).not.toBe("none");
      expect(shell(fixture.container, bodyId)).toBe(bodyShell);
      expect(
        fixture.container.querySelectorAll(
          `[data-editor-block-shell="true"][data-editor-block-id="${bodyId}"]`,
        ),
      ).toHaveLength(1);
    }
  });

  it.each([
    { label: "heading level 1", level: 1, iconSize: "1.5rem" },
    { label: "heading level 2", level: 2, iconSize: "1.25rem" },
    { label: "heading level 3", level: 3, iconSize: "1.25rem" },
  ] as const)(
    "derives the toggle glyph size from $label without changing its mounted structure",
    ({ level, iconSize }) => {
      const summaryId = "fd-toggle-heading-summary";
      const bodyId = "fd-toggle-heading-body";
      const fixture = renderFirstDraft({
        prepare(editor) {
          if (level === 3) return;
          expect(
            editor.updateBlockMetadata([
              { blockId: id(summaryId), values: { level } },
            ]),
          ).toBe(true);
        },
      });
      const toggleShell = shell(fixture.container, "fd-toggle-heading");
      const layout = toggleShell.querySelector<HTMLElement>(
        ":scope > .toggle-heading-block__toggle",
      )!;
      const disclosure = layout.querySelector<HTMLButtonElement>(
        ":scope > .toggle-heading-block__chevron",
      )!;
      const glyph = disclosure.querySelector<SVGElement>(":scope > svg")!;
      const summaryShell = shell(fixture.container, summaryId);
      const bodyShell = shell(fixture.container, bodyId);
      const layoutStyle = getComputedStyle(layout);
      const disclosureStyle = getComputedStyle(disclosure);
      const glyphStyle = getComputedStyle(glyph);

      expect(layoutStyle.getPropertyValue("--fd-toggle-chevron-control-size")).toBe(
        "1.5rem",
      );
      expect(layoutStyle.getPropertyValue("--fd-toggle-chevron-icon-size")).toBe(
        iconSize,
      );
      expect(disclosureStyle.inlineSize).toBe(
        "var(--fd-toggle-chevron-control-size)",
      );
      expect(disclosureStyle.blockSize).toBe(
        "var(--fd-toggle-chevron-control-size)",
      );
      expect(glyphStyle.inlineSize).toBe("var(--fd-toggle-chevron-icon-size)");
      expect(glyphStyle.blockSize).toBe("var(--fd-toggle-chevron-icon-size)");
      expect(disclosure.type).toBe("button");
      expect(layout.querySelectorAll(":scope > button")).toHaveLength(1);
      expect(disclosure.querySelectorAll(":scope > svg")).toHaveLength(1);
      expect(
        summaryShell.querySelector(
          `.heading-block__heading[data-editor-heading-level="${level}"]`,
        ),
      ).not.toBeNull();
      expect([...layout.children].slice(0, 3)).toEqual([
        disclosure,
        summaryShell,
        bodyShell,
      ]);
      for (const blockId of [summaryId, bodyId]) {
        expect(
          fixture.container.querySelectorAll(
            `[data-editor-block-shell="true"][data-editor-block-id="${blockId}"]`,
          ),
        ).toHaveLength(1);
      }
    },
  );

  it("keeps the paragraph toggle glyph at 1rem within the fixed disclosure control", () => {
    const fixture = renderFirstDraft();
    const layout = shell(fixture.container, "fd-toggle-list").querySelector<HTMLElement>(
      ":scope > .toggle-list-item-block__toggle",
    )!;
    const disclosure = layout.querySelector<HTMLButtonElement>(
      ":scope > .toggle-list-item-block__chevron",
    )!;
    const glyph = disclosure.querySelector<SVGElement>(":scope > svg")!;
    const summaryShell = shell(fixture.container, "fd-toggle-list-summary");
    const bodyShell = shell(fixture.container, "fd-toggle-list-body");
    const layoutStyle = getComputedStyle(layout);

    expect(summaryShell.dataset.editorBlockType).toBe("paragraph");
    expect(layoutStyle.getPropertyValue("--fd-toggle-chevron-control-size")).toBe(
      "1.5rem",
    );
    expect(layoutStyle.getPropertyValue("--fd-toggle-chevron-icon-size")).toBe(
      "1rem",
    );
    expect(getComputedStyle(disclosure).inlineSize).toBe(
      "var(--fd-toggle-chevron-control-size)",
    );
    expect(getComputedStyle(disclosure).blockSize).toBe(
      "var(--fd-toggle-chevron-control-size)",
    );
    expect(layout.querySelectorAll(":scope > button")).toHaveLength(1);
    expect(disclosure.querySelectorAll(":scope > svg")).toHaveLength(1);
    expect([...layout.children].slice(0, 3)).toEqual([
      disclosure,
      summaryShell,
      bodyShell,
    ]);
    expect(glyph.isConnected).toBe(true);
    for (const blockId of ["fd-toggle-list-summary", "fd-toggle-list-body"]) {
      expect(
        fixture.container.querySelectorAll(
          `[data-editor-block-shell="true"][data-editor-block-id="${blockId}"]`,
        ),
      ).toHaveLength(1);
    }
  });

  it("keeps every toggle-heading level semantic through activation without executing the outer renderer", () => {
    let toggleHeadingExecutions = 0;
    const fixture = renderFirstDraft({
      definition(viewState) {
        const base = createFirstDraftEditorDefinition(viewState);
        function CountingToggleHeadingRenderer(
          props: FirstDraftBlockRendererProps,
        ) {
          toggleHeadingExecutions += 1;
          return <ToggleHeadingRenderer {...props} />;
        }
        return {
          ...base,
          blocks: {
            ...base.blocks,
            toggleHeading: {
              ...base.blocks.toggleHeading!,
              renderer: CountingToggleHeadingRenderer,
            },
          },
        } as EditableEditorDefinition;
      },
    });
    const summaryId = id("fd-toggle-heading-summary");
    const toggleShell = shell(fixture.container, "fd-toggle-heading");
    const summaryShell = shell(fixture.container, summaryId);
    const bodyShell = shell(fixture.container, "fd-toggle-heading-body");
    const layout = toggleShell.querySelector<HTMLElement>(
      ":scope > .toggle-heading-block__toggle",
    )!;
    const disclosure = layout.querySelector<HTMLButtonElement>(
      ":scope > .toggle-heading-block__chevron",
    )!;
    const textHost = summaryShell.querySelector<HTMLElement>(
      ":scope > .heading-block__heading > [data-editor-text-shell='true']",
    )!;
    const projection = textHost.querySelector<HTMLElement>(
      ":scope > [data-editor-text-projection='true']",
    )!;
    const baseline = toggleHeadingExecutions;
    let sharedView: ReturnType<typeof requiredActiveTextView> | null = null;

    for (const level of [1, 2, 3] as const) {
      act(() => {
        expect(
          fixture.editor.updateBlockMetadata([
            { blockId: summaryId, values: { level } },
          ]),
        ).toBe(true);
      });

      // Renderer isolation is the primary invariant and must execute before
      // any independent styling assertion can fail this iteration.
      expect(toggleHeadingExecutions).toBe(baseline);
      expect(
        projection.querySelector(
          `:scope > h${level}[data-block-node="paragraph"][data-editor-heading-level="${level}"]`,
        ),
      ).not.toBeNull();
      expect(projection.querySelector(":scope > p[data-block-node]")).toBeNull();
      expect(projection.hidden).toBe(false);
      expect(
        summaryShell.querySelector(".heading-block__heading")?.getAttribute(
          "role",
        ),
      ).toBeNull();
      expect(
        summaryShell.querySelector(".heading-block__heading")?.getAttribute(
          "aria-level",
        ),
      ).toBeNull();

      act(() => {
        expect(
          fixture.editor.focusText(summaryId, {
            offset: 3,
            preventScroll: true,
          }).status,
        ).toBe("focused");
      });
      const view = requiredActiveTextView(fixture.editor);
      sharedView ??= view;
      expect(view).toBe(sharedView);
      expect(view.dom.querySelector(
        `:scope > h${level}[data-block-node="paragraph"][data-editor-heading-level="${level}"]`,
      )).not.toBeNull();
      expect(view.dom.querySelector(":scope > p[data-block-node]")).toBeNull();
      expect(projection.hidden).toBe(true);
      expect(document.activeElement).toBe(view.dom);
      expect(nativeCaretOffset(view.dom)).toBe(3);

      act(() => {
        expect(
          fixture.editor.focusText(id("fd-paragraph-intro"), {
            offset: 2,
            preventScroll: true,
          }).status,
        ).toBe("focused");
      });
      expect(requiredActiveTextView(fixture.editor)).toBe(sharedView);
      expect(projection.hidden).toBe(false);
      expect(
        projection.querySelector(
          `:scope > h${level}[data-block-node="paragraph"][data-editor-heading-level="${level}"]`,
        ),
      ).not.toBeNull();
      expect(toggleHeadingExecutions).toBe(baseline);
      expect(shell(fixture.container, "fd-toggle-heading")).toBe(toggleShell);
      expect(shell(fixture.container, summaryId)).toBe(summaryShell);
      expect(shell(fixture.container, "fd-toggle-heading-body")).toBe(bodyShell);
      expect(
        summaryShell.querySelector(
          ":scope > .heading-block__heading > [data-editor-text-shell='true']",
        ),
      ).toBe(textHost);
      expect(
        layout.querySelector(":scope > .toggle-heading-block__chevron"),
      ).toBe(disclosure);
      expect([...layout.children].slice(0, 3)).toEqual([
        disclosure,
        summaryShell,
        bodyShell,
      ]);
    }

    const toggleListSummary = shell(fixture.container, "fd-toggle-list-summary");
    expect(
      toggleListSummary.querySelector(
        ".paragraph-block__paragraph p[data-block-node='paragraph']",
      ),
    ).not.toBeNull();
    expect(toggleListSummary.querySelector(":is(h1,h2,h3)"))
      .toBeNull();
  });

  it("updates an active toggle summary heading without replacing toggle shells or the shared editor", () => {
    const fixture = renderFirstDraft();
    const summaryId = id("fd-toggle-heading-summary");
    const toggleShell = shell(fixture.container, "fd-toggle-heading");
    const summaryShell = shell(fixture.container, summaryId);
    const bodyShell = shell(fixture.container, "fd-toggle-heading-body");
    const layout = toggleShell.querySelector<HTMLElement>(
      ":scope > .toggle-heading-block__toggle",
    )!;
    const disclosure = layout.querySelector<HTMLButtonElement>(
      ":scope > .toggle-heading-block__chevron",
    )!;

    act(() => {
      expect(
        fixture.editor.focusText(summaryId, {
          offset: 3,
          preventScroll: true,
        }).status,
      ).toBe("focused");
    });
    const view = requiredActiveTextView(fixture.editor);
    const viewDom = view.dom;
    expect(view.dom.querySelector(":scope > h3[data-block-node]")).not.toBeNull();

    act(() => {
      expect(
        fixture.editor.updateBlockMetadata([
          { blockId: summaryId, values: { level: 2 } },
        ]),
      ).toBe(true);
    });

    expect(requiredActiveTextView(fixture.editor)).toBe(view);
    expect(view.dom).toBe(viewDom);
    expect(document.activeElement).toBe(view.dom);
    expect(nativeCaretOffset(view.dom)).toBe(3);
    expect(
      view.dom.querySelector(
        ":scope > h2[data-block-node='paragraph'][data-editor-heading-level='2']",
      ),
    ).not.toBeNull();
    expect(view.dom.querySelector(":scope > p[data-block-node]")).toBeNull();
    expect(shell(fixture.container, "fd-toggle-heading")).toBe(toggleShell);
    expect(shell(fixture.container, summaryId)).toBe(summaryShell);
    expect(shell(fixture.container, "fd-toggle-heading-body")).toBe(bodyShell);
    expect(
      layout.querySelector(":scope > .toggle-heading-block__chevron"),
    ).toBe(disclosure);

    fireEvent.click(disclosure);
    expect(getComputedStyle(bodyShell).display).toBe("none");
    fireEvent.click(disclosure);
    expect(getComputedStyle(bodyShell).display).not.toBe("none");
    expect(
      getComputedStyle(layout).getPropertyValue("--fd-toggle-chevron-icon-size"),
    ).toBe("1.25rem");
  });

  it.each([
    {
      kind: "toggle heading",
      toggleId: "fd-toggle-heading",
      summaryId: "fd-toggle-heading-summary",
      bodyId: "fd-toggle-heading-body",
    },
    {
      kind: "toggle list item",
      toggleId: "fd-toggle-list",
      summaryId: "fd-toggle-list-summary",
      bodyId: "fd-toggle-list-body",
    },
  ])(
    "keeps $kind disclosure pointer and keyboard activation local to mounted view state",
    ({ toggleId, summaryId, bodyId }) => {
      const onChange = vi.fn();
      const fixture = renderFirstDraft({
        onChange,
        enableDocumentDnd: true,
      });
      const canonicalBefore = fixture.editor.readSnapshot();
      const canonicalPublications = vi.fn();
      const unsubscribeCanonical = [
        fixture.editor.subscribeRootBlockIds(canonicalPublications),
        fixture.editor.subscribeBlock(id(toggleId), canonicalPublications),
        fixture.editor.subscribeChildBlockIds(
          id(toggleId),
          canonicalPublications,
        ),
        fixture.editor.subscribeBlock(id(summaryId), canonicalPublications),
        fixture.editor.subscribeBlock(id(bodyId), canonicalPublications),
      ];
      const viewPublications = vi.fn();
      const unsubscribeView = fixture.viewState.subscribe(viewPublications);
      const toggleShell = shell(fixture.container, toggleId);
      const bodyShell = shell(fixture.container, bodyId);
      const disclosure = toggleShell.querySelector<HTMLButtonElement>(
        ":scope > :is(.toggle-heading-block__toggle, .toggle-list-item-block__toggle) > button",
      )!;
      const glyph = disclosure.querySelector<SVGElement>(":scope > svg")!;
      const pointerTargets: EventTarget[] = [];
      const recordPointerTarget = (event: Event) => {
        pointerTargets.push(event.target!);
      };
      disclosure.addEventListener("pointerdown", recordPointerTarget);
      disclosure.addEventListener("pointerup", recordPointerTarget);
      disclosure.addEventListener("click", recordPointerTarget);

      const expectExpanded = (expanded: boolean) => {
        expect(disclosure.getAttribute("aria-expanded")).toBe(String(expanded));
        expect(disclosure.getAttribute("aria-label")).toBe(
          expanded ? "Collapse toggle" : "Expand toggle",
        );
        expect(
          disclosure.querySelector("svg")?.getAttribute("data-expanded"),
        ).toBe(String(expanded));
        expect(getComputedStyle(bodyShell).display === "none").toBe(!expanded);
        expect(shell(fixture.container, bodyId)).toBe(bodyShell);
        expect(
          fixture.container.querySelectorAll(
            `[data-editor-block-shell="true"][data-editor-block-id="${bodyId}"]`,
          ),
        ).toHaveLength(1);
      };

      expect(disclosure.type).toBe("button");
      expect(disclosure.isConnected).toBe(true);
      expect(getComputedStyle(glyph).pointerEvents).toBe("none");
      disclosure.focus();
      expect(document.activeElement).toBe(disclosure);
      expectExpanded(true);
      const summaryZone = zoneFor(fixture.container, summaryId);
      expect(summaryZone).not.toBeNull();
      expectHoverOwner(fixture.container, summaryId, toggleId);

      fireEvent(disclosure, pointerEvent("pointerdown", 71, 24));
      expectExpanded(true);
      fireEvent(disclosure, pointerEvent("pointerup", 71, 24));
      expectExpanded(true);
      fireEvent.click(disclosure);
      expectExpanded(false);
      expect(pointerTargets).toEqual([disclosure, disclosure, disclosure]);
      expect(viewPublications).toHaveBeenCalledTimes(1);
      expect(disclosure.isConnected).toBe(true);
      expect(document.activeElement).toBe(disclosure);
      expect(zoneFor(fixture.container, summaryId)).toBe(summaryZone);
      expectHoverOwner(fixture.container, summaryId, toggleId);

      fireEvent(disclosure, pointerEvent("pointerdown", 72, 24));
      fireEvent(disclosure, pointerEvent("pointerup", 72, 24));
      fireEvent.click(disclosure);
      expectExpanded(true);
      expect(viewPublications).toHaveBeenCalledTimes(2);

      disclosure.removeEventListener("pointerdown", recordPointerTarget);
      disclosure.removeEventListener("pointerup", recordPointerTarget);
      disclosure.removeEventListener("click", recordPointerTarget);

      fireEvent.keyDown(disclosure, { key: "Enter" });
      fireEvent.click(disclosure, { detail: 0 });
      fireEvent.keyUp(disclosure, { key: "Enter" });
      expectExpanded(false);
      expect(viewPublications).toHaveBeenCalledTimes(3);

      fireEvent.keyDown(disclosure, { key: " " });
      fireEvent.keyUp(disclosure, { key: " " });
      fireEvent.click(disclosure, { detail: 0 });
      expectExpanded(true);
      expect(viewPublications).toHaveBeenCalledTimes(4);
      expect(document.activeElement).toBe(disclosure);

      expectHoverOwner(fixture.container, summaryId, toggleId);
      expect(zoneFor(fixture.container, summaryId)).toBe(summaryZone);
      expect(fixture.documentMove).not.toHaveBeenCalled();
      for (const target of fixture.container.querySelectorAll<HTMLElement>(
        ".first-draft-block-drop-target",
      )) {
        expect(target.dataset.firstDraftBlockDropTargetActive).toBe("false");
      }
      expect(fixture.editor.readSnapshot()).toEqual(canonicalBefore);
      expect(canonicalPublications).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();

      unsubscribeView();
      for (const unsubscribe of unsubscribeCanonical) unsubscribe();
    },
  );

  it("keeps the callout body and renderer isolated from child changes", () => {
    let calloutExecutions = 0;
    const fixture = renderFirstDraft({
      definition(viewState) {
        const base = createFirstDraftEditorDefinition(viewState);
        function CountingCalloutRenderer(props: FirstDraftBlockRendererProps) {
          calloutExecutions += 1;
          return <CalloutRenderer {...props} />;
        }
        return {
          ...base,
          blocks: {
            ...base.blocks,
            callout: {
              ...base.blocks.callout!,
              renderer: CountingCalloutRenderer,
            },
          },
        } as EditableEditorDefinition;
      },
    });
    const callout = shell(fixture.container, "fd-callout").querySelector<HTMLElement>(
      ":scope > .callout-block__callout",
    )!;
    const iconWrap = callout.querySelector<HTMLElement>(
      ":scope > .callout-block__icon-wrap",
    )!;
    const iconButton = iconWrap.querySelector<HTMLButtonElement>(
      ":scope > .callout-block__icon-button",
    )!;
    const body = callout.querySelector<HTMLElement>(
      ":scope > .callout-block__body",
    )!;
    const originalShell = shell(fixture.container, "fd-callout-text");
    const originalTextRoot = textRoot(fixture.container, "fd-callout-text");
    const baseline = calloutExecutions;
    const middleId = id("fd-callout-middle-runtime");
    const lastId = id("fd-callout-last-runtime");
    const middleContent = createBlockRichTextContentFromPlainText(
      "paragraph",
      "Middle callout child",
    );
    const lastContent = createBlockRichTextContentFromPlainText(
      "paragraph",
      "Last callout child",
    );

    act(() => {
      expect(
        fixture.editor.executeStructuralTransaction({
          origin: "callout-spacing-insert",
          operations: [
            insertBlocks({
              placement: { parentId: id("fd-callout"), childIndex: 1 },
              blocks: [
                createCanonicalBlockRecord({
                  id: middleId,
                  type: "paragraph",
                  parentId: id("fd-callout"),
                  content: middleContent,
                  plainText:
                    extractPlainTextFromRichTextDocument(middleContent),
                }),
                createCanonicalBlockRecord({
                  id: lastId,
                  type: "paragraph",
                  parentId: id("fd-callout"),
                  content: lastContent,
                  plainText: extractPlainTextFromRichTextDocument(lastContent),
                }),
              ],
            }),
          ],
        }).ok,
      ).toBe(true);
    });

    const directShells = () => [
      ...body.querySelectorAll<HTMLElement>(
        ':scope > [data-editor-block-shell="true"]',
      ),
    ];
    expect(directShells().map((element) => element.dataset.editorBlockId)).toEqual([
      "fd-callout-text",
      String(middleId),
      String(lastId),
    ]);
    expect([...callout.children]).toEqual([iconWrap, body]);
    expect(body.matches('[data-editor-block-shell="true"]')).toBe(false);
    expect(new Set(directShells()).size).toBe(3);
    expect(directShells().every((element) => element.parentElement === body)).toBe(
      true,
    );
    expect(getComputedStyle(callout).display).toBe("flex");
    expect(getComputedStyle(iconWrap).alignSelf).toBe("flex-start");
    expect(getComputedStyle(iconWrap).position).toBe("relative");
    expect(getComputedStyle(iconWrap).zIndex).toBe("");
    expect(getComputedStyle(iconButton).position).toBe("relative");
    expect(getComputedStyle(iconButton).zIndex).toBe("13");
    expect(getComputedStyle(iconWrap).marginTop).toBe(
      "var(--fd-callout-icon-margin-top)",
    );
    expect(getComputedStyle(body).paddingTop).toBe("0.75rem");
    expect(getComputedStyle(body).paddingRight).toBe("0px");
    expect(getComputedStyle(body).paddingBottom).toBe("0.75rem");
    expect(getComputedStyle(body).paddingLeft).toBe("0px");
    expect(
      getComputedStyle(callout).getPropertyValue(
        "--fd-callout-icon-margin-top",
      ),
    ).toBe("0.875rem");
    expect(calloutExecutions).toBe(baseline);
    expect(shell(fixture.container, "fd-callout-text")).toBe(originalShell);
    expect(textRoot(fixture.container, "fd-callout-text")).toBe(
      originalTextRoot,
    );

    act(() => {
      expect(
        fixture.editor.replaceBlock({
          blockId: middleId,
          blockType: "heading",
          metadata: { level: 1 },
          plainText: "Later heading",
        }).ok,
      ).toBe(true);
    });
    const headingId = fixture.editor.getChildBlockIds(id("fd-callout"))[1]!;
    expect(headingId).not.toBe(middleId);
    const middleShell = shell(fixture.container, headingId);
    const middleTextRoot = textRoot(fixture.container, headingId);
    expect(middleShell.parentElement).toBe(body);
    expect(
      getComputedStyle(callout).getPropertyValue(
        "--fd-callout-icon-margin-top",
      ),
    ).toBe("0.875rem");
    expect(calloutExecutions).toBe(baseline);

    act(() => {
      expect(
        fixture.editor.insertText({
          blockId: headingId,
          offset: 0,
          text: "Edited ",
        }),
      ).toBe(true);
    });
    expect(calloutExecutions).toBe(baseline);

    act(() => {
      expect(
        fixture.editor.executeStructuralTransaction({
          origin: "callout-spacing-reorder",
          operations: [
            moveBlocks({
              blockIds: [headingId],
              sourcePlacement: {
                parentId: id("fd-callout"),
                childIndex: 1,
              },
              destinationPlacement: {
                parentId: id("fd-callout"),
                childIndex: 0,
              },
            }),
          ],
        }).ok,
      ).toBe(true);
    });
    expect(directShells().map((element) => element.dataset.editorBlockId)).toEqual([
      String(headingId),
      "fd-callout-text",
      String(lastId),
    ]);
    expect(shell(fixture.container, headingId)).toBe(middleShell);
    expect(textRoot(fixture.container, headingId)).toBe(middleTextRoot);
    expect(shell(fixture.container, "fd-callout-text")).toBe(originalShell);
    expect(textRoot(fixture.container, "fd-callout-text")).toBe(
      originalTextRoot,
    );
    expect(
      getComputedStyle(callout).getPropertyValue(
        "--fd-callout-icon-margin-top",
      ),
    ).toBe("1.625rem");
    expect(calloutExecutions).toBe(baseline);

    act(() => {
      expect(
        fixture.editor.executeStructuralTransaction({
          origin: "callout-spacing-reorder-away",
          operations: [
            moveBlocks({
              blockIds: [headingId],
              sourcePlacement: {
                parentId: id("fd-callout"),
                childIndex: 0,
              },
              destinationPlacement: {
                parentId: id("fd-callout"),
                childIndex: 2,
              },
            }),
          ],
        }).ok,
      ).toBe(true);
    });
    expect(directShells().map((element) => element.dataset.editorBlockId)).toEqual([
      "fd-callout-text",
      String(lastId),
      String(headingId),
    ]);
    expect(
      getComputedStyle(callout).getPropertyValue(
        "--fd-callout-icon-margin-top",
      ),
    ).toBe("0.875rem");
    expect(shell(fixture.container, headingId)).toBe(middleShell);
    expect(textRoot(fixture.container, headingId)).toBe(middleTextRoot);
    expect(calloutExecutions).toBe(baseline);

    act(() => {
      expect(
        fixture.editor.executeStructuralTransaction({
          origin: "callout-spacing-remove",
          operations: [
            removeBlocks({
              blockIds: [lastId],
              includeDescendants: true,
              expectedParents: { [lastId]: id("fd-callout") },
            }),
          ],
        }).ok,
      ).toBe(true);
    });
    expect(directShells()).toHaveLength(2);
    expect(shell(fixture.container, headingId)).toBe(middleShell);
    expect(shell(fixture.container, "fd-callout-text")).toBe(originalShell);
    expect(calloutExecutions).toBe(baseline);
  });

  it.each([
    [1, "1.625rem"],
    [2, "1.125rem"],
    [3, "0.625rem"],
  ] as const)(
    "aligns the callout icon for a first-child heading level %i",
    (level, expectedOffset) => {
      const fixture = renderFirstDraft({
        prepare(editor) {
          expect(
            editor.replaceBlock({
              blockId: id("fd-callout-text"),
              blockType: "heading",
              metadata: { level },
              plainText: `Heading level ${level}`,
            }).ok,
          ).toBe(true);
        },
      });
      const callout = shell(
        fixture.container,
        "fd-callout",
      ).querySelector<HTMLElement>(":scope > .callout-block__callout")!;
      expect(
        getComputedStyle(callout).getPropertyValue(
          "--fd-callout-icon-margin-top",
        ),
      ).toBe(expectedOffset);
    },
  );

  it("keeps the checklist checkbox interactive without stealing canonical selection", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange });
    const primaryId = id("fd-check-unchecked-text");
    act(() => {
      expect(
        fixture.editor.focusText(primaryId, {
          offset: 4,
          preventScroll: true,
        }),
      ).toEqual({ status: "focused" });
    });
    const selectionBefore =
      fixture.editor.selectionController.getCanonicalSnapshot();
    expect(selectionBefore.kind).toBe("document");
    if (selectionBefore.kind !== "document") {
      throw new Error("Expected a document selection around checklist text");
    }
    const endpointsBefore = selectionBefore.snapshot.endpoints;
    const checkbox = shell(
      fixture.container,
      "fd-check-unchecked",
    ).querySelector<HTMLInputElement>(
      "input[aria-label='Checklist item complete']",
    )!;
    const primaryPresentation = shell(
      fixture.container,
      primaryId,
    ).querySelector<HTMLElement>(":scope > .paragraph-block__paragraph")!;
    expect(getComputedStyle(primaryPresentation).textDecoration).not.toContain(
      "line-through",
    );

    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(true);
    expect(checkbox.parentElement?.getAttribute("data-checked")).toBe("true");
    expect(getComputedStyle(primaryPresentation).textDecoration).toContain(
      "line-through",
    );
    expect(
      fixture.editor.getBlock(id("fd-check-unchecked"))?.metadata?.checked,
    ).toBe(true);
    expectCanonicalEndpoints(fixture.editor, endpointsBefore);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      kind: "block-metadata",
      changedBlockIds: [id("fd-check-unchecked")],
      historyAction: "command",
    });

    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(false);
    expect(checkbox.parentElement?.getAttribute("data-checked")).toBe("false");
    expect(getComputedStyle(primaryPresentation).textDecoration).not.toContain(
      "line-through",
    );
    expect(
      fixture.editor.getBlock(id("fd-check-unchecked"))?.metadata?.checked,
    ).toBe(false);
    expectCanonicalEndpoints(fixture.editor, endpointsBefore);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(
      onChange.mock.calls.slice(0, 2).map(([change]) => ({
        kind: change.kind,
        historyAction: change.historyAction,
      })),
    ).toEqual([
      { kind: "block-metadata", historyAction: "command" },
      { kind: "block-metadata", historyAction: "command" },
    ]);

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(
      fixture.editor.getBlock(id("fd-check-unchecked"))?.metadata?.checked,
    ).toBe(true);
    expect(checkbox.parentElement?.getAttribute("data-checked")).toBe("true");
    expect(getComputedStyle(primaryPresentation).textDecoration).toContain(
      "line-through",
    );
    expectCanonicalEndpoints(fixture.editor, endpointsBefore);
    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(
      fixture.editor.getBlock(id("fd-check-unchecked"))?.metadata?.checked,
    ).toBe(false);
    expect(checkbox.parentElement?.getAttribute("data-checked")).toBe("false");
    expect(getComputedStyle(primaryPresentation).textDecoration).not.toContain(
      "line-through",
    );
    expect(fixture.editor.canUndo).toBe(false);
    expect(fixture.editor.canRedo).toBe(true);
    expectCanonicalEndpoints(fixture.editor, endpointsBefore);

    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(
      fixture.editor.getBlock(id("fd-check-unchecked"))?.metadata?.checked,
    ).toBe(true);
    expect(getComputedStyle(primaryPresentation).textDecoration).toContain(
      "line-through",
    );
    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(
      fixture.editor.getBlock(id("fd-check-unchecked"))?.metadata?.checked,
    ).toBe(false);
    expect(getComputedStyle(primaryPresentation).textDecoration).not.toContain(
      "line-through",
    );
    expect(fixture.editor.canUndo).toBe(true);
    expect(fixture.editor.canRedo).toBe(false);
    expectCanonicalEndpoints(fixture.editor, endpointsBefore);
    expect(onChange.mock.calls.map(([change]) => change.historyAction)).toEqual(
      ["command", "command", "undo", "undo", "redo", "redo"],
    );
  });

  it("styles only a checked checklist item's mandatory first paragraph", () => {
    const secondId = id("checked-second-paragraph");
    const nestedListId = id("checked-nested-checklist");
    const nestedItemId = id("checked-nested-item");
    const nestedTextId = id("checked-nested-text");
    const fixture = renderFirstDraft({
      prepare(editor) {
        expect(
          editor.insertBlock({
            blockId: id("fd-check-checked-text"),
            blockType: "paragraph",
            plainText: "Later direct paragraph",
            createBlockId: () => secondId,
          }).ok,
        ).toBe(true);
        const nestedIds = [nestedListId, nestedItemId, nestedTextId];
        expect(
          editor.insertBlock({
            blockId: secondId,
            blockType: "checklist",
            plainText: "Nested unchecked item",
            createBlockId: () => nestedIds.shift()!,
          }).ok,
        ).toBe(true);
      },
    });
    const item = shell(fixture.container, "fd-check-checked").querySelector<HTMLElement>(
      ":scope > .checklist-block__item",
    )!;
    const firstPresentation = shell(
      fixture.container,
      "fd-check-checked-text",
    ).querySelector<HTMLElement>(":scope > .paragraph-block__paragraph")!;
    const secondPresentation = shell(
      fixture.container,
      secondId,
    ).querySelector<HTMLElement>(":scope > .paragraph-block__paragraph")!;
    const nestedPresentation = shell(
      fixture.container,
      nestedTextId,
    ).querySelector<HTMLElement>(":scope > .paragraph-block__paragraph")!;
    const nestedItem = shell(fixture.container, nestedItemId).querySelector<HTMLElement>(
      ":scope > .checklist-block__item",
    )!;

    expect(item.dataset.checked).toBe("true");
    expect(item.children).toHaveLength(4);
    expect(item.children[0]?.matches("input[type='checkbox']")).toBe(true);
    expect(item.children[1]).toBe(shell(fixture.container, "fd-check-checked-text"));
    expect(getComputedStyle(firstPresentation).textDecoration).toContain(
      "line-through",
    );
    expect(getComputedStyle(firstPresentation).color).not.toBe(
      getComputedStyle(secondPresentation).color,
    );
    expect(getComputedStyle(secondPresentation).textDecoration).not.toContain(
      "line-through",
    );
    expect(getComputedStyle(nestedPresentation).textDecoration).not.toContain(
      "line-through",
    );
    expect(nestedItem.dataset.checked).toBe("false");
    expect(getComputedStyle(nestedPresentation).color).toBe(
      getComputedStyle(secondPresentation).color,
    );
  });

  it("delegates either paragraph or heading first callout children but not later children", () => {
    const paragraphFixture = renderFirstDraft({
      prepare(editor) {
        expect(
          editor.insertBlock({
            blockId: id("fd-callout-text"),
            blockType: "paragraph",
            plainText: "Second callout child",
          }).ok,
        ).toBe(true);
      },
    });
    const calloutChildren = paragraphFixture.editor.getChildBlockIds(
      id("fd-callout"),
    );
    expectHoverOwner(
      paragraphFixture.container,
      calloutChildren[0]!,
      "fd-callout",
    );
    expectHoverOwner(
      paragraphFixture.container,
      calloutChildren[1]!,
      calloutChildren[1]!,
    );
    paragraphFixture.unmount();

    const headingFixture = renderFirstDraft({
      prepare(editor) {
        expect(
          editor.replaceBlock({
            blockId: id("fd-callout-text"),
            blockType: "heading",
            plainText: "Heading summary",
          }).ok,
        ).toBe(true);
      },
    });
    const headingId = headingFixture.editor.getChildBlockIds(
      id("fd-callout"),
    )[0]!;
    expect(headingFixture.editor.getBlock(headingId)?.type).toBe("heading");
    expectHoverOwner(headingFixture.container, headingId, "fd-callout");
  });

  it("routes three callout children and their hover zones without publishing or remounting", () => {
    const onChange = vi.fn();
    let hoverStore: FirstDraftBlockHoverStore | null = null;
    const rendererExecutions = new Map<BlockId, number>();
    const fixture = renderFirstDraft({
      onChange,
      captureHoverStore(store) {
        hoverStore = store;
      },
      prepare(editor) {
        expect(
          editor.replaceBlock({
            blockId: id("fd-callout-text"),
            blockType: "paragraph",
            plainText: "Short first child.",
          }).ok,
        ).toBe(true);
        const firstId = editor.getChildBlockIds(id("fd-callout"))[0]!;
        expect(
          editor.insertBlock({
            blockId: firstId,
            blockType: "paragraph",
            plainText:
              "Second callout child wraps across multiple lines so its content and transparent gutter bridge share one owner.",
          }).ok,
        ).toBe(true);
        const secondId = editor.getChildBlockIds(id("fd-callout"))[1]!;
        expect(
          editor.insertBlock({
            blockId: secondId,
            blockType: "paragraph",
            plainText:
              "Third callout child is also multiline and must keep its own controls while the pointer crosses its hover zone.",
          }).ok,
        ).toBe(true);
      },
      definition(viewState) {
        const base = createFirstDraftEditorDefinition(viewState);
        function CountingCalloutRenderer(props: FirstDraftBlockRendererProps) {
          rendererExecutions.set(
            props.block.id,
            (rendererExecutions.get(props.block.id) ?? 0) + 1,
          );
          return <CalloutRenderer {...props} />;
        }
        function CountingParagraphRenderer(props: FirstDraftBlockRendererProps) {
          rendererExecutions.set(
            props.block.id,
            (rendererExecutions.get(props.block.id) ?? 0) + 1,
          );
          return <ParagraphRenderer {...props} />;
        }
        return {
          ...base,
          blocks: {
            ...base.blocks,
            callout: {
              ...base.blocks.callout!,
              renderer: CountingCalloutRenderer,
            },
            paragraph: {
              ...base.blocks.paragraph,
              renderer: CountingParagraphRenderer,
            },
          },
        } as EditableEditorDefinition;
      },
    });
    if (!hoverStore) throw new Error("Hover store was not captured");
    const store: FirstDraftBlockHoverStore = hoverStore;
    const calloutId = id("fd-callout");
    const childIds = fixture.editor.getChildBlockIds(calloutId);
    expect(childIds).toHaveLength(3);
    const [firstId, secondId, thirdId] = childIds as readonly [
      BlockId,
      BlockId,
      BlockId,
    ];
    const calloutShell = shell(fixture.container, calloutId);
    const childShells = childIds.map((blockId) =>
      shell(fixture.container, blockId),
    );
    const childTextRoots = childIds.map((blockId) =>
      textRoot(fixture.container, blockId),
    );
    const childZones = childIds.map((blockId) =>
      zoneFor(fixture.container, blockId),
    );
    expect(childZones.every(Boolean)).toBe(true);
    const baselineExecutions = new Map(rendererExecutions);
    const canonicalBefore = fixture.editor.readSnapshot();
    const historyBefore = fixture.editor.canUndo;
    onChange.mockClear();
    const canonicalPublications = vi.fn();
    const selectionPublications = vi.fn();
    const unsubscribeCanonical = [
      fixture.editor.subscribeRootBlockIds(canonicalPublications),
      fixture.editor.subscribeBlock(calloutId, canonicalPublications),
      fixture.editor.subscribeChildBlockIds(calloutId, canonicalPublications),
      ...childIds.map((blockId) =>
        fixture.editor.subscribeBlock(blockId, canonicalPublications),
      ),
    ];
    const unsubscribeSelection =
      fixture.editor.selectionController.subscribeStandaloneSettlements(
        selectionPublications,
      );
    const calloutHover = vi.fn();
    const secondHover = vi.fn();
    const thirdHover = vi.fn();
    const unsubscribeHover = [
      store.subscribeBlock(calloutId, calloutHover),
      store.subscribeBlock(secondId, secondHover),
      store.subscribeBlock(thirdId, thirdHover),
    ];

    fireEvent.pointerMove(childTextRoots[0]!);
    expect(controlsOwner(fixture.container)).toBe(calloutId);
    expect(store.getHoveredBlockId()).toBe(calloutId);
    fireEvent.pointerMove(childZones[0]!);
    expect(controlsOwner(fixture.container)).toBe(calloutId);

    fireEvent.pointerMove(childTextRoots[1]!);
    expect(controlsOwner(fixture.container)).toBe(secondId);
    expect(store.getHoveredBlockId()).toBe(secondId);
    fireEvent.pointerMove(childZones[1]!);
    expect(controlsOwner(fixture.container)).toBe(secondId);

    fireEvent.pointerMove(childTextRoots[2]!);
    expect(controlsOwner(fixture.container)).toBe(thirdId);
    expect(store.getHoveredBlockId()).toBe(thirdId);
    fireEvent.pointerMove(childZones[2]!);
    expect(controlsOwner(fixture.container)).toBe(thirdId);

    fireEvent.pointerMove(childTextRoots[1]!);
    calloutHover.mockClear();
    secondHover.mockClear();
    thirdHover.mockClear();
    fireEvent.pointerMove(childZones[2]!);
    expect(controlsOwner(fixture.container)).toBe(thirdId);
    expect(calloutHover).not.toHaveBeenCalled();
    expect(secondHover).toHaveBeenCalledOnce();
    expect(thirdHover).toHaveBeenCalledOnce();
    fireEvent.pointerMove(childZones[1]!);
    expect(controlsOwner(fixture.container)).toBe(secondId);
    expect(calloutHover).not.toHaveBeenCalled();
    expect(secondHover).toHaveBeenCalledTimes(2);
    expect(thirdHover).toHaveBeenCalledTimes(2);

    expect(
      fixture.container.querySelectorAll(
        "[data-first-draft-block-controls='true']",
      ),
    ).toHaveLength(1);
    expect(shell(fixture.container, calloutId)).toBe(calloutShell);
    for (const [index, blockId] of childIds.entries()) {
      expect(shell(fixture.container, blockId)).toBe(childShells[index]);
      expect(textRoot(fixture.container, blockId)).toBe(childTextRoots[index]);
      expect(zoneFor(fixture.container, blockId)).toBe(childZones[index]);
      expect(rendererExecutions.get(blockId)).toBe(
        baselineExecutions.get(blockId),
      );
    }
    expect(rendererExecutions.get(calloutId)).toBe(
      baselineExecutions.get(calloutId),
    );
    expect(firstId).not.toBe(secondId);
    expect(secondId).not.toBe(thirdId);
    expect(fixture.editor.readSnapshot()).toEqual(canonicalBefore);
    expect(fixture.editor.canUndo).toBe(historyBefore);
    expect(canonicalPublications).not.toHaveBeenCalled();
    expect(selectionPublications).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    for (const unsubscribe of unsubscribeHover) unsubscribe();
    unsubscribeSelection();
    for (const unsubscribe of unsubscribeCanonical) unsubscribe();
  });

  it("keeps structural columns and lanes chrome-free while lane blocks own controls", () => {
    const fixture = renderFirstDraft();
    for (const blockId of ["fd-columns", "fd-column-left", "fd-column-right"]) {
      expect(zoneFor(fixture.container, blockId)).toBeNull();
      fireEvent.pointerMove(shell(fixture.container, blockId));
      expect(singleControls(fixture.container)).toBeNull();
    }
    const lane = fixture.container.querySelector<HTMLElement>(
      ".columns-block__lane",
    )!;
    fireEvent.pointerMove(lane);
    expect(singleControls(fixture.container)).toBeNull();
    expectHoverOwner(
      fixture.container,
      "fd-column-left-text",
      "fd-column-left-text",
    );
  });

  it("renders weighted column shells side by side initially and synchronizes tracks without executing ColumnsRenderer", () => {
    let columnsExecutions = 0;
    const fixture = renderFirstDraft({
      definition(viewState) {
        const base = createFirstDraftEditorDefinition(viewState);
        function CountingColumnsRenderer(props: FirstDraftBlockRendererProps) {
          columnsExecutions += 1;
          return <ColumnsRenderer {...props} />;
        }
        return {
          ...base,
          blocks: {
            ...base.blocks,
            columns: {
              ...base.blocks.columns!,
              renderer: CountingColumnsRenderer,
            },
          },
        } as EditableEditorDefinition;
      },
    });
    const columnsShell = shell(fixture.container, "fd-columns");
    const grid = columnsShell.querySelector<HTMLElement>(
      ":scope > .columns-block__grid",
    )!;
    const directColumnShells = () => [
      ...grid.querySelectorAll<HTMLElement>(
        ':scope > [data-editor-block-shell="true"][data-editor-block-type="column"]',
      ),
    ];
    const initialShells = directColumnShells();
    const initialTextRoot = textRoot(fixture.container, "fd-column-left-text");
    const initialTracks = grid.style.getPropertyValue(
      "--columns-block-tracks",
    );
    const overlay = grid.querySelector<HTMLElement>(
      ":scope > .columns-block__resize-overlay",
    )!;
    const boundaries = () => [
      ...overlay.querySelectorAll<HTMLElement>(
        ":scope > .columns-block__boundary",
      ),
    ];
    const baseline = columnsExecutions;

    expect(initialShells).toHaveLength(2);
    expect(initialShells.map((element) => element.dataset.editorBlockType)).toEqual([
      "column",
      "column",
    ]);
    expect(initialShells.every((element) =>
      element.querySelector(":scope > .columns-block__lane") !== null,
    )).toBe(true);
    expect(grid.querySelector(":scope > .columns-block__lane")).toBeNull();
    expect(initialTracks).toBe(
      "minmax(0, 1000000fr) minmax(0, 1000000fr)",
    );
    expect(initialTracks).not.toBe("none");
    expect(overlay.style.getPropertyValue("--columns-block-tracks")).toBe(
      initialTracks,
    );
    expect(boundaries()).toHaveLength(1);
    expect(
      boundaries()[0]!.querySelectorAll(":scope > .columns-block__divider"),
    ).toHaveLength(1);
    expect(
      boundaries()[0]!.querySelectorAll(
        ":scope > .columns-block__resize-handle",
      ),
    ).toHaveLength(1);
    expect(
      grid.querySelectorAll(":scope > .columns-block__divider"),
    ).toHaveLength(0);

    act(() => {
      expect(fixture.editor.updateBlockMetadata([
        { blockId: id("fd-column-left"), values: { layoutWeight: 750_000 } },
        { blockId: id("fd-column-right"), values: { layoutWeight: 1_250_000 } },
      ])).toBe(true);
    });
    expect(grid.style.getPropertyValue("--columns-block-tracks")).toBe(
      "minmax(0, 750000fr) minmax(0, 1250000fr)",
    );
    expect(overlay.style.getPropertyValue("--columns-block-tracks")).toBe(
      grid.style.getPropertyValue("--columns-block-tracks"),
    );
    expect(boundaries()).toHaveLength(1);
    expect(columnsExecutions).toBe(baseline);
    expect(directColumnShells()).toEqual(initialShells);
    expect(textRoot(fixture.container, "fd-column-left-text")).toBe(
      initialTextRoot,
    );

    const thirdColumnId = id("fd-column-third-runtime");
    const thirdTextId = id("fd-column-third-runtime-text");
    const content = createBlockRichTextContentFromPlainText(
      "paragraph",
      "Third column",
    );
    act(() => {
      expect(fixture.editor.executeStructuralTransaction({
        origin: "columns-layout-test-insert",
        operations: [insertBlocks({
          placement: { parentId: id("fd-columns"), childIndex: 2 },
          blocks: [
            createCanonicalBlockRecord({
              id: thirdColumnId,
              type: "column",
              parentId: id("fd-columns"),
              metadata: createDefaultColumnMetadata(),
            }),
            createCanonicalBlockRecord({
              id: thirdTextId,
              type: "paragraph",
              parentId: thirdColumnId,
              content,
              plainText: extractPlainTextFromRichTextDocument(content),
            }),
          ],
        })],
      }).ok).toBe(true);
    });
    expect(grid.style.getPropertyValue("--columns-block-tracks")).toBe(
      "minmax(0, 750000fr) minmax(0, 1250000fr) minmax(0, 1000000fr)",
    );
    expect(overlay.style.getPropertyValue("--columns-block-tracks")).toBe(
      grid.style.getPropertyValue("--columns-block-tracks"),
    );
    expect(boundaries()).toHaveLength(2);
    expect(
      boundaries().every(
        (boundary) =>
          boundary.querySelectorAll(":scope > .columns-block__divider").length === 1 &&
          boundary.querySelectorAll(":scope > .columns-block__resize-handle").length === 1,
      ),
    ).toBe(true);
    const [firstColumn, secondColumn, thirdColumn] = directColumnShells();
    if (!firstColumn || !secondColumn || !thirdColumn)
      throw new Error("Missing three-column resize fixture");
    Object.defineProperty(firstColumn, "getBoundingClientRect", {
      configurable: true,
      value: () => domRect(0, 0, 220, 240),
    });
    Object.defineProperty(secondColumn, "getBoundingClientRect", {
      configurable: true,
      value: () => domRect(236, 0, 340, 240),
    });
    Object.defineProperty(thirdColumn, "getBoundingClientRect", {
      configurable: true,
      value: () => domRect(592, 0, 260, 240),
    });
    const weightsBeforeResize = [
      fixture.editor.getBlock(id("fd-column-left"))!.metadata!.layoutWeight,
      fixture.editor.getBlock(id("fd-column-right"))!.metadata!.layoutWeight,
      fixture.editor.getBlock(thirdColumnId)!.metadata!.layoutWeight,
    ];
    fireEvent.keyDown(
      boundaries()[1]!.querySelector(".columns-block__resize-handle")!,
      { key: "ArrowRight" },
    );
    const weightsAfterResize = [
      fixture.editor.getBlock(id("fd-column-left"))!.metadata!.layoutWeight,
      fixture.editor.getBlock(id("fd-column-right"))!.metadata!.layoutWeight,
      fixture.editor.getBlock(thirdColumnId)!.metadata!.layoutWeight,
    ];
    expect(weightsAfterResize[0]).toBe(weightsBeforeResize[0]);
    expect(weightsAfterResize[1]).not.toBe(weightsBeforeResize[1]);
    expect(weightsAfterResize[2]).not.toBe(weightsBeforeResize[2]);
    expect(Number(weightsAfterResize[1]) + Number(weightsAfterResize[2])).toBe(
      Number(weightsBeforeResize[1]) + Number(weightsBeforeResize[2]),
    );
    expect(overlay.style.getPropertyValue("--columns-block-tracks")).toBe(
      grid.style.getPropertyValue("--columns-block-tracks"),
    );
    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(grid.style.getPropertyValue("--columns-block-tracks")).toBe(
      "minmax(0, 750000fr) minmax(0, 1250000fr) minmax(0, 1000000fr)",
    );
    expect(columnsExecutions).toBe(baseline);
    expect(directColumnShells().slice(0, 2)).toEqual(initialShells);

    act(() => {
      expect(fixture.editor.executeStructuralTransaction({
        origin: "columns-layout-test-reorder",
        operations: [moveBlocks({
          blockIds: [thirdColumnId],
          sourcePlacement: { parentId: id("fd-columns"), childIndex: 2 },
          destinationPlacement: { parentId: id("fd-columns"), childIndex: 0 },
        })],
      }).ok).toBe(true);
    });
    expect(directColumnShells().map((element) => element.dataset.editorBlockId)).toEqual([
      String(thirdColumnId),
      "fd-column-left",
      "fd-column-right",
    ]);
    expect(grid.style.getPropertyValue("--columns-block-tracks")).toBe(
      "minmax(0, 1000000fr) minmax(0, 750000fr) minmax(0, 1250000fr)",
    );
    expect(columnsExecutions).toBe(baseline);
    expect(directColumnShells()[1]).toBe(initialShells[0]);
    expect(directColumnShells()[2]).toBe(initialShells[1]);

    act(() => {
      expect(fixture.editor.executeStructuralTransaction({
        origin: "columns-layout-test-remove",
        operations: [removeBlocks({
          blockIds: [thirdColumnId],
          includeDescendants: true,
          expectedParents: { [thirdColumnId]: id("fd-columns") },
        })],
      }).ok).toBe(true);
    });
    expect(grid.style.getPropertyValue("--columns-block-tracks")).toBe(
      "minmax(0, 750000fr) minmax(0, 1250000fr)",
    );
    expect(boundaries()).toHaveLength(1);
    expect(columnsExecutions).toBe(baseline);
    expect(directColumnShells()).toEqual(initialShells);
    expect(textRoot(fixture.container, "fd-column-left-text")).toBe(
      initialTextRoot,
    );
  });

  it("keeps grid and overlay tracks synchronized through resize, cancellation, keyboard, undo, redo, and RTL", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange });
    const grid = shell(fixture.container, "fd-columns").querySelector<HTMLElement>(
      ":scope > .columns-block__grid",
    )!;
    const columnShells = [
      ...grid.querySelectorAll<HTMLElement>(
        ':scope > [data-editor-block-shell="true"][data-editor-block-type="column"]',
      ),
    ];
    for (const [index, element] of columnShells.entries()) {
      Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => domRect(index * 300, 0, 300, 240),
      });
    }
    const handle = grid.querySelector<HTMLElement>(
      ".columns-block__resize-handle",
    )!;
    const boundary = handle.parentElement!;
    const divider = boundary.querySelector<HTMLElement>(
      ":scope > .columns-block__divider",
    )!;
    const initialColumnIds = fixture.editor.getChildBlockIds(id("fd-columns"));
    const initialSelection = fixture.editor.selectionController.getCanonicalSnapshot();
    installPointerCapture(handle);
    const tracks = () => grid.style.getPropertyValue("--columns-block-tracks");
    const overlayTracks = () =>
      grid
        .querySelector<HTMLElement>(".columns-block__resize-overlay")!
        .style.getPropertyValue("--columns-block-tracks");
    const initialTracks = tracks();

    expect(boundary.classList.contains("columns-block__boundary")).toBe(true);
    expect(
      boundary.querySelectorAll(":scope > .columns-block__divider"),
    ).toHaveLength(1);
    expect(
      boundary.querySelectorAll(":scope > .columns-block__resize-handle"),
    ).toHaveLength(1);
    fireEvent.pointerOver(handle);
    expect(boundary.querySelector(":scope > .columns-block__divider")).toBe(
      divider,
    );
    expect(fixture.editor.selectionController.getCanonicalSnapshot()).toEqual(
      initialSelection,
    );

    fireEvent.pointerDown(handle, {
      pointerId: 31,
      clientX: 300,
      button: 0,
      buttons: 1,
      isPrimary: true,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 31,
      clientX: 360,
      buttons: 1,
      isPrimary: true,
    });
    expect(tracks()).toBe(
      "minmax(0, 1200000fr) minmax(0, 800000fr)",
    );
    expect(overlayTracks()).toBe(tracks());
    expect(
      boundary.querySelectorAll(":scope > .columns-block__divider"),
    ).toHaveLength(1);
    expect(boundary.querySelector(":scope > .columns-block__divider")).toBe(
      divider,
    );
    fireEvent.pointerCancel(handle, { pointerId: 31, isPrimary: true });
    expect(tracks()).toBe(initialTracks);
    expect(overlayTracks()).toBe(initialTracks);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, {
      pointerId: 32,
      clientX: 300,
      button: 0,
      buttons: 1,
      isPrimary: true,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 32,
      clientX: 360,
      buttons: 1,
      isPrimary: true,
    });
    fireEvent.pointerUp(handle, {
      pointerId: 32,
      clientX: 360,
      button: 0,
      buttons: 0,
      isPrimary: true,
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(tracks()).toBe(
      "minmax(0, 1200000fr) minmax(0, 800000fr)",
    );
    expect(overlayTracks()).toBe(tracks());
    expect(fixture.editor.getChildBlockIds(id("fd-columns"))).toEqual(
      initialColumnIds,
    );
    expect([
      ...grid.querySelectorAll<HTMLElement>(
        ':scope > [data-editor-block-shell="true"][data-editor-block-type="column"]',
      ),
    ]).toEqual(columnShells);
    expect(fixture.editor.selectionController.getCanonicalSnapshot()).toEqual(
      initialSelection,
    );
    expect(
      boundary.querySelectorAll(":scope > .columns-block__divider"),
    ).toHaveLength(1);
    expect(boundary.querySelector(":scope > .columns-block__divider")).toBe(
      divider,
    );

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(tracks()).toBe(initialTracks);
    expect(overlayTracks()).toBe(initialTracks);
    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(tracks()).toBe(
      "minmax(0, 1200000fr) minmax(0, 800000fr)",
    );
    expect(overlayTracks()).toBe(tracks());

    const changesBeforeKeyboard = onChange.mock.calls.length;
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledTimes(changesBeforeKeyboard + 1);
    expect(overlayTracks()).toBe(tracks());

    grid.style.direction = "rtl";
    const beforeRtl = tracks();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledTimes(changesBeforeKeyboard + 2);
    expect(tracks()).not.toBe(beforeRtl);
    expect(overlayTracks()).toBe(tracks());
  });

  it("delegates table cells and table UI to one table owner and gives no row/cell chrome", () => {
    const fixture = renderFirstDraft();
    expect(zoneFor(fixture.container, "fd-table-row-1")).toBeNull();
    expect(zoneFor(fixture.container, "fd-table-cell-1-1")).toBeNull();
    expectHoverOwner(fixture.container, "fd-table-cell-1-1", "fd-table");
    const controls = singleControls(fixture.container)!;
    const anchor = controls.parentElement!;
    const scroll = anchor.parentElement!;
    expect(anchor.classList.contains("table-block__chrome-anchor")).toBe(true);
    expect(scroll.classList.contains("table-block__scroll")).toBe(true);
    expect(anchor).toBe(scroll.querySelector(":scope > .table-block__chrome-anchor"));
    expect(scroll.querySelectorAll(".first-draft-block-controls")).toHaveLength(1);
    expect(anchor.closest(".table-block__frame")).toBeNull();
    expect(anchor.closest(".table-block__grid")).toBeNull();
    expect(anchor.closest(".table-block__row")).toBeNull();
    expect(anchor.closest(".table-block__cell")).toBeNull();
    expect(anchor.closest(".table-block__action-control-overlay")).toBeNull();
    expect(anchor.closest("[data-table-row-carrier]")).toBeNull();
    expect(anchor.closest("[data-table-column-carrier]")).toBeNull();
  });

  it("gives tabs and only the active pane their own boundary chrome", () => {
    const fixture = renderFirstDraft();
    const tabButton = shell(fixture.container, "fd-tabs").querySelector(
      ".tabs-block__tab",
    )!;
    fireEvent.pointerMove(tabButton);
    expect(controlsOwner(fixture.container)).toBe("fd-tabs");
    expectHoverOwner(
      fixture.container,
      "fd-tab-overview",
      "fd-tab-overview",
      ".tabs-block__pane-contents",
    );
    expect(zoneFor(fixture.container, "fd-tab-details")).toBeNull();
  });

  it("never mounts chrome for structural/internal block types", () => {
    const fixture = renderFirstDraft();
    const structuralTypes = [
      "bulletList",
      "orderedList",
      "checklist",
      "toggleHeadingBody",
      "toggleListItemBody",
      "columns",
      "column",
      "tableRow",
      "tableCell",
    ];
    for (const type of structuralTypes) {
      for (const blockShell of fixture.container.querySelectorAll<HTMLElement>(
        `[data-editor-block-type="${type}"]`,
      )) {
        expect(
          blockShell.querySelector(
            `:scope > [data-first-draft-block-hover-zone-for="${blockShell.dataset.editorBlockId}"]`,
          ),
        ).toBeNull();
      }
    }
  });
});

describe("First Draft block action menu", () => {
  it("opens from the real drag handle with the ordered accessible icon actions and pins only its owner", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange });
    const blockId = id("fd-paragraph-intro");
    const rootsBefore = fixture.editor.getRootBlockIds();
    fireEvent.pointerMove(textRoot(fixture.container, blockId));
    const handle = singleControls(
      fixture.container,
    )!.querySelector<HTMLButtonElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;

    expect(handle.getAttribute("aria-haspopup")).toBe("menu");
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    expect(handle.hasAttribute("aria-controls")).toBe(false);
    fireEvent.click(handle, { detail: 1 });

    const menu = document.getElementById(fixture.blockActionMenuStore.menuId)!;
    expect(menu.getAttribute("role")).toBe("menu");
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(handle.getAttribute("aria-controls")).toBe(menu.id);
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      "Delete block",
      "Insert before",
      "Insert after",
      "Duplicate block",
    ]);
    expect(
      items.map(
        (item) =>
          item.querySelector<HTMLElement>(
            "[data-first-draft-block-action-icon]",
          )?.dataset.firstDraftBlockActionIcon,
      ),
    ).toEqual([
      "Trash2",
      "ArrowUpFromLine",
      "ArrowDownFromLine",
      "Copy",
    ]);
    for (const item of items) {
      const icon = item.querySelector<HTMLElement>(
        "[data-first-draft-block-action-icon]",
      )!;
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.querySelectorAll("svg")).toHaveLength(1);
      expect(icon.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
      expect(icon.querySelector("svg")?.getAttribute("focusable")).toBe(
        "false",
      );
    }
    expect(fixture.editor.getRootBlockIds()).toEqual(rootsBefore);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerMove(menu);
    expect(controlsOwner(fixture.container)).toBe(blockId);
    expect(
      fixture.container.querySelectorAll(
        "[data-first-draft-block-controls='true']",
      ),
    ).toHaveLength(1);

    fireEvent.click(handle);
    expect(fixture.blockActionMenuStore.getSnapshot()).toEqual({
      kind: "closed",
    });
    expect(document.getElementById(menu.id)).toBeNull();
  });

  it("supports keyboard opening, roving navigation, dismissal, and focus restoration", () => {
    const previousScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const fixture = renderFirstDraft();
    const blockId = id("fd-paragraph-intro");
    fireEvent.pointerMove(textRoot(fixture.container, blockId));
    const handle = singleControls(
      fixture.container,
    )!.querySelector<HTMLButtonElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowDown" });

    const menu = document.getElementById(fixture.blockActionMenuStore.menuId)!;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(document.activeElement).toBe(items[0]);
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1, -1]);

    fireEvent.keyDown(items[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[3]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    fireEvent.keyDown(items[3]!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "End" });
    expect(document.activeElement).toBe(items[3]);
    fireEvent.pointerEnter(items[1]!);
    expect(items[1]?.getAttribute("data-active")).toBe("true");
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[3]!, { key: "Escape" });
    expect(fixture.blockActionMenuStore.getSnapshot()).toEqual({
      kind: "closed",
    });
    expect(document.activeElement).toBe(handle);

    fireEvent.keyDown(handle, { key: " " });
    const reopened = document.getElementById(
      fixture.blockActionMenuStore.menuId,
    )!;
    const first = reopened.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab" });
    expect(fixture.blockActionMenuStore.getSnapshot()).toEqual({
      kind: "closed",
    });

    handle.focus();
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(fixture.blockActionMenuStore.getSnapshot().kind).toBe("open");
    fireEvent.pointerDown(document.body);
    expect(fixture.blockActionMenuStore.getSnapshot()).toEqual({
      kind: "closed",
    });
    if (previousScrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        previousScrollIntoView,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("activates the current action with Enter and Space", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange });
    const sourceId = id("fd-paragraph-intro");
    const rootsBefore = fixture.editor.getRootBlockIds();
    const sourceIndex = rootsBefore.indexOf(sourceId);

    fireEvent.pointerMove(textRoot(fixture.container, sourceId));
    let handle = singleControls(
      fixture.container,
    )!.querySelector<HTMLButtonElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    fireEvent.keyDown(handle, { key: "Enter" });
    let menu = document.getElementById(fixture.blockActionMenuStore.menuId)!;
    let active = menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    fireEvent.keyDown(active, { key: "ArrowDown" });
    active = document.activeElement as HTMLButtonElement;
    fireEvent.keyDown(active, { key: "ArrowDown" });
    active = document.activeElement as HTMLButtonElement;
    expect(active.textContent).toBe("Insert after");
    fireEvent.keyDown(active, { key: "Enter" });

    expect(fixture.blockActionMenuStore.getSnapshot()).toEqual({
      kind: "closed",
    });
    const afterInsertion = fixture.editor.getRootBlockIds();
    const insertedId = afterInsertion[sourceIndex + 1]!;
    expect(fixture.editor.getBlock(insertedId)?.type).toBe("paragraph");
    expect(onChange).toHaveBeenCalledOnce();

    fireEvent.pointerMove(textRoot(fixture.container, sourceId));
    handle = singleControls(
      fixture.container,
    )!.querySelector<HTMLButtonElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    fireEvent.click(handle, { detail: 1 });
    menu = document.getElementById(fixture.blockActionMenuStore.menuId)!;
    active = menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    fireEvent.keyDown(active, { key: "End" });
    active = document.activeElement as HTMLButtonElement;
    expect(active.textContent).toBe("Duplicate block");
    fireEvent.keyDown(active, { key: " " });

    expect(fixture.blockActionMenuStore.getSnapshot()).toEqual({
      kind: "closed",
    });
    const roots = fixture.editor.getRootBlockIds();
    const currentSourceIndex = roots.indexOf(sourceId);
    const duplicateId = roots[currentSourceIndex + 1]!;
    expect(duplicateId).not.toBe(sourceId);
    expect(fixture.editor.getBlock(duplicateId)?.type).toBe(
      fixture.editor.getBlock(sourceId)?.type,
    );
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("keeps a rejected action open and exposes a restrained alert", () => {
    const failure = new Error("Delete was rejected");
    const fixture = renderFirstDraft({
      blockActionMenuEditor: (editor) => {
        const rejecting = Object.create(editor) as typeof editor;
        Object.defineProperty(rejecting, "deleteBlock", {
          value: () => {
            throw failure;
          },
        });
        return rejecting;
      },
    });
    const blockId = id("fd-paragraph-intro");
    fireEvent.pointerMove(textRoot(fixture.container, blockId));
    const handle = singleControls(
      fixture.container,
    )!.querySelector<HTMLButtonElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    fireEvent.click(handle);
    const menu = document.getElementById(fixture.blockActionMenuStore.menuId)!;
    fireEvent.click(menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!);

    expect(fixture.blockActionMenuStore.getSnapshot().kind).toBe("open");
    expect(menu.querySelector('[role="alert"]')?.textContent).toBe(
      "The block action could not be completed. Try again or dismiss this menu.",
    );
    expect(fixture.editor.getBlock(blockId)).not.toBeNull();
  });

  it("renders constrained adjacent insertions as disabled and inert", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange });
    const paneId = id("fd-tab-overview");
    fireEvent.pointerMove(
      shell(fixture.container, paneId).querySelector(
        ".tabs-block__pane-contents",
      )!,
    );
    expect(controlsOwner(fixture.container)).toBe(paneId);
    const handle = singleControls(
      fixture.container,
    )!.querySelector<HTMLButtonElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    fireEvent.click(handle);
    const items = [
      ...document
        .getElementById(fixture.blockActionMenuStore.menuId)!
        .querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ];

    expect(items.map((item) => item.getAttribute("aria-disabled"))).toEqual([
      null,
      "true",
      "true",
      null,
    ]);
    fireEvent.click(items[1]!);
    expect(fixture.blockActionMenuStore.getSnapshot().kind).toBe("open");
    expect(onChange).not.toHaveBeenCalled();
    expect(fixture.editor.getBlock(paneId)).not.toBeNull();
  });

  it("deletes through the canonical operation without focusing its disconnected trigger", async () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange });
    const blockId = id("fd-paragraph-intro");
    fireEvent.pointerMove(textRoot(fixture.container, blockId));
    const handle = singleControls(
      fixture.container,
    )!.querySelector<HTMLButtonElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    fireEvent.click(handle);
    const menu = document.getElementById(fixture.blockActionMenuStore.menuId)!;
    fireEvent.click(menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!);

    expect(fixture.blockActionMenuStore.getSnapshot()).toEqual({
      kind: "closed",
    });
    expect(fixture.editor.getBlock(blockId)).toBeNull();
    expect(handle.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(handle);
    expect(onChange).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-editor-text-root")).toBe(
        "true",
      ),
    );
    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.editor.getBlock(blockId)).not.toBeNull();
    expect(fixture.editor.undo()).toEqual({ status: "history-empty" });
  });

  it("closes safely when the live target is deleted", async () => {
    const fixture = renderFirstDraft();
    const blockId = id("fd-paragraph-intro");
    fireEvent.pointerMove(textRoot(fixture.container, blockId));
    const handle = singleControls(
      fixture.container,
    )!.querySelector<HTMLButtonElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    fireEvent.click(handle);
    expect(fixture.blockActionMenuStore.getSnapshot().kind).toBe("open");

    act(() => {
      expect(fixture.editor.deleteBlock({ blockId }).ok).toBe(true);
    });
    await waitFor(() =>
      expect(fixture.blockActionMenuStore.getSnapshot()).toEqual({
        kind: "closed",
      }),
    );
    expect(document.getElementById(fixture.blockActionMenuStore.menuId)).toBeNull();
  });

  it("closes on an actual drag start and suppresses its completed pointer click", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange, enableDocumentDnd: true });
    const blockId = id("fd-paragraph-intro");
    fireEvent.pointerMove(textRoot(fixture.container, blockId));
    const handle = singleControls(
      fixture.container,
    )!.querySelector<HTMLButtonElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    fireEvent.click(handle);
    expect(fixture.blockActionMenuStore.getSnapshot().kind).toBe("open");
    installDocumentDragGeometry(handle, rootTarget);

    fireEvent(handle, pointerEvent("pointerdown", 60, 24));
    fireEvent(window, pointerEvent("pointermove", 60, 104));
    expect(
      fixture.blockDragAndDrop?.captureDocumentBlockDragSession,
    ).toHaveBeenCalledOnce();
    expect(fixture.blockActionMenuStore.getSnapshot()).toEqual({
      kind: "closed",
    });
    flushAnimationFrames();
    fireEvent(window, pointerEvent("pointercancel", 60, 104));
    fireEvent.click(handle, { detail: 1 });

    expect(fixture.blockActionMenuStore.getSnapshot()).toEqual({
      kind: "closed",
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("First Draft canonical plus insertion", () => {
  it("keeps grip events content-inert while primary pointer-down clears selection", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange });
    const sourceId = id("fd-paragraph-intro");
    const sourceProjection = textRoot(fixture.container, sourceId);
    act(() => {
      expect(
        fixture.editor.focusText(sourceId, {
          offset: 3,
          preventScroll: true,
        }),
      ).toEqual({ status: "focused" });
    });
    const sourceTextRoot = activeTextRoot(fixture.container);
    expect(sourceProjection.hidden).toBe(true);
    const rootsBefore = fixture.editor.getRootBlockIds();
    const selectionSettlements = vi.fn();
    fixture.editor.selectionController.subscribeStandaloneSettlements(
      selectionSettlements,
    );
    fireEvent.pointerMove(sourceTextRoot);
    const grip = singleControls(fixture.container)!.querySelector<HTMLElement>(
      ".first-draft-block-drag-handle",
    )!;

    fireEvent.pointerDown(grip);
    fireEvent.mouseDown(grip);
    fireEvent.dragStart(grip);
    fireEvent.click(grip);

    expect(fixture.editor.getRootBlockIds()).toEqual(rootsBefore);
    expect(fixture.blockActionMenuStore.getSnapshot()).toMatchObject({
      kind: "open",
      blockId: sourceId,
    });
    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({ kind: "none" });
    expect(selectionSettlements).toHaveBeenCalledOnce();
    expect(selectionSettlements).toHaveBeenCalledWith({ kind: "none" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("creates one adjacent root paragraph transaction, focuses offset zero, and has one undo entry", async () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange });
    const sourceId = id("fd-paragraph-intro");
    const rootsBefore = fixture.editor.getRootBlockIds();
    const sourceIndex = rootsBefore.indexOf(sourceId);
    const sourceProjection = textRoot(fixture.container, sourceId);
    act(() => {
      expect(
        fixture.editor.focusText(sourceId, { offset: 0, preventScroll: true }),
      ).toEqual({ status: "focused" });
    });
    const sourceTextRoot = activeTextRoot(fixture.container);
    expect(sourceProjection.hidden).toBe(true);
    expect(document.activeElement).toBe(sourceTextRoot);

    fireEvent.pointerMove(sourceTextRoot);
    const button = singleControls(
      fixture.container,
    )!.querySelector<HTMLButtonElement>(
      "button[aria-label='Add block below']",
    )!;
    const mouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(sourceTextRoot);
    fireEvent.click(button);

    const rootsAfter = fixture.editor.getRootBlockIds();
    expect(rootsAfter).toHaveLength(rootsBefore.length + 1);
    const createdId = rootsAfter[sourceIndex + 1]!;
    expect(fixture.editor.getBlock(createdId)?.type).toBe("paragraph");
    expect(onChange).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(document.activeElement).toBe(activeTextRoot(fixture.container)),
    );
    const createdTextRoot = activeTextRoot(fixture.container);
    expect(nativeCaretOffset(createdTextRoot)).toBe(0);
    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({
      kind: "document",
      snapshot: {
        endpoints: {
          anchor: { blockId: createdId, textOffset: 0 },
          head: { blockId: createdId, textOffset: 0 },
        },
      },
    });

    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.editor.getBlock(createdId)).toBeNull();
    expect(fixture.editor.undo()).toEqual({ status: "history-empty" });
    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(fixture.editor.getBlock(createdId)?.type).toBe("paragraph");
  });

  it("uses canonical list placement without inserting a paragraph into the list container", async () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange });
    const itemId = id("fd-bullet-2");
    const primaryId = id("fd-bullet-2-text");
    act(() => {
      expect(
        fixture.editor.focusText(primaryId, {
          offset: 0,
          preventScroll: true,
        }),
      ).toEqual({ status: "focused" });
    });
    fireEvent.pointerMove(textRoot(fixture.container, primaryId));
    fireEvent.click(
      singleControls(fixture.container)!.querySelector(
        "button[aria-label='Add block below']",
      )!,
    );
    expect(onChange).toHaveBeenCalledOnce();
    expect(fixture.editor.getBlock(primaryId)?.type).toBe("paragraph");
    expect(fixture.editor.getParentId(primaryId)).not.toBe(
      id("fd-bullet-list"),
    );
    expect(
      fixture.editor
        .getChildBlockIds(id("fd-bullet-list"))
        .every(
          (childId) =>
            fixture.editor.getBlock(childId)?.type === "bulletListItem",
        ),
    ).toBe(true);
    expect(fixture.editor.getBlock(itemId)).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        textRoot(fixture.container, primaryId),
      ),
    );
    expect(nativeCaretOffset(textRoot(fixture.container, primaryId))).toBe(0);
  });
});

describe("First Draft hover and mounted-view identity", () => {
  it("keeps every registered wrapper renderer isolated from descendant text and local view state", () => {
    const counts = new Map<BlockId, number>();
    const fixture = renderFirstDraft({
      definition(viewState) {
        const base = createFirstDraftEditorDefinition(viewState);
        const blocks = Object.fromEntries(
          Object.entries(base.blocks).map(([type, definition]) => {
            if (definition.kind !== "wrapper") return [type, definition];
            const Renderer = definition.renderer;
            function CountingWrapperRenderer(
              props: FirstDraftBlockRendererProps,
            ) {
              counts.set(
                props.block.id,
                (counts.get(props.block.id) ?? 0) + 1,
              );
              return <Renderer {...props} />;
            }
            return [
              type,
              { ...definition, renderer: CountingWrapperRenderer },
            ];
          }),
        );
        return { ...base, blocks } as EditableEditorDefinition;
      },
    });
    const wrapperIds = Object.values(fixture.editor.readSnapshot().blocks)
      .filter(
        (block) =>
          fixture.editor.definition.blocks[block.type]?.kind === "wrapper",
      )
      .map((block) => block.id);
    const wrapperTypes = new Set(
      wrapperIds.map((blockId) => fixture.editor.getBlock(blockId)!.type),
    );
    expect([...wrapperTypes].sort()).toEqual(
      [
        "bulletList",
        "bulletListItem",
        "callout",
        "checklist",
        "checklistItem",
        "code",
        "column",
        "columns",
        "orderedList",
        "orderedListItem",
        "quote",
        "tabPane",
        "table",
        "tableRow",
        "tabs",
        "toggleHeading",
        "toggleHeadingBody",
        "toggleListItem",
        "toggleListItemBody",
      ].sort(),
    );
    const baseline = new Map(counts);
    const survivingShell = shell(fixture.container, "fd-paragraph-outro");
    const survivingTextRoot = textRoot(
      fixture.container,
      "fd-paragraph-outro",
    );

    for (const wrapperId of wrapperIds) {
      const textBlockId = firstTextDescendant(fixture.editor, wrapperId);
      expect(textBlockId, `text descendant of ${wrapperId}`).not.toBeNull();
      act(() => {
        expect(
          fixture.editor.insertText({
            blockId: textBlockId!,
            offset: 0,
            text: "x",
          }),
        ).toBe(true);
      });
    }
    for (const wrapperId of wrapperIds) {
      expect(counts.get(wrapperId), String(wrapperId)).toBe(
        baseline.get(wrapperId),
      );
    }

    const toggleShell = shell(fixture.container, "fd-toggle-heading");
    const toggleBodyShell = shell(
      fixture.container,
      "fd-toggle-heading-body",
    );
    act(() => fixture.viewState.toggleCollapsed(id("fd-toggle-heading")));
    expect(counts.get(id("fd-toggle-heading"))).toBe(
      baseline.get(id("fd-toggle-heading")),
    );
    expect(shell(fixture.container, "fd-toggle-heading")).toBe(toggleShell);
    expect(shell(fixture.container, "fd-toggle-heading-body")).toBe(
      toggleBodyShell,
    );
    expect(
      toggleShell.querySelector("button[aria-expanded='false']"),
    ).not.toBeNull();

    const tabsShell = shell(fixture.container, "fd-tabs");
    const overviewShell = shell(fixture.container, "fd-tab-overview");
    act(() =>
      fixture.viewState.selectTab(
        id("fd-tabs"),
        id("fd-tab-details"),
      ),
    );
    expect(counts.get(id("fd-tabs"))).toBe(baseline.get(id("fd-tabs")));
    expect(shell(fixture.container, "fd-tabs")).toBe(tabsShell);
    expect(shell(fixture.container, "fd-tab-overview")).toBe(overviewShell);

    const calloutCount = counts.get(id("fd-callout"));
    fireEvent.click(
      shell(fixture.container, "fd-callout").querySelector(
        "button[aria-label='Change callout icon']",
      )!,
    );
    expect(counts.get(id("fd-callout"))).toBe(calloutCount);
    expect(shell(fixture.container, "fd-paragraph-outro")).toBe(
      survivingShell,
    );
    expect(textRoot(fixture.container, "fd-paragraph-outro")).toBe(
      survivingTextRoot,
    );

    const calloutId = id("fd-callout");
    const calloutChildren = [...fixture.editor.getChildBlockIds(calloutId)];
    const calloutSurvivor = shell(fixture.container, calloutChildren[0]!);
    const insertedCalloutChildId = id("fd-callout-runtime-child");
    const insertedCalloutContent = createBlockRichTextContentFromPlainText(
      "paragraph",
      "Inserted callout child",
    );
    act(() => {
      expect(
        fixture.editor.executeStructuralTransaction({
          origin: "callout-isolation-insert",
          operations: [insertBlocks({
            placement: {
              parentId: calloutId,
              childIndex: calloutChildren.length,
            },
            blocks: [createCanonicalBlockRecord({
              id: insertedCalloutChildId,
              type: "paragraph",
              parentId: calloutId,
              content: insertedCalloutContent,
              plainText: extractPlainTextFromRichTextDocument(
                insertedCalloutContent,
              ),
            })],
          })],
        }).ok,
      ).toBe(true);
    });
    expect(counts.get(calloutId)).toBe(calloutCount);
    expect(shell(fixture.container, calloutChildren[0]!)).toBe(calloutSurvivor);
    act(() => {
      expect(
        fixture.editor.executeStructuralTransaction({
          origin: "callout-isolation-reorder",
          operations: [moveBlocks({
            blockIds: [insertedCalloutChildId],
            sourcePlacement: {
              parentId: calloutId,
              childIndex: calloutChildren.length,
            },
            destinationPlacement: { parentId: calloutId, childIndex: 0 },
          })],
        }).ok,
      ).toBe(true);
    });
    expect(counts.get(calloutId)).toBe(calloutCount);
    expect(shell(fixture.container, calloutChildren[0]!)).toBe(calloutSurvivor);
    act(() => {
      expect(
        fixture.editor.executeStructuralTransaction({
          origin: "callout-isolation-remove",
          operations: [removeBlocks({
            blockIds: [insertedCalloutChildId],
            includeDescendants: true,
            expectedParents: { [insertedCalloutChildId]: calloutId },
          })],
        }).ok,
      ).toBe(true);
    });
    expect(counts.get(calloutId)).toBe(calloutCount);
    expect(shell(fixture.container, calloutChildren[0]!)).toBe(calloutSurvivor);

    const nextCalloutIcon = FIRST_DRAFT_CALLOUT_ICONS.find(
      (icon) => icon.id !== fixture.editor.getBlock(calloutId)?.metadata?.icon,
    )!;
    act(() => {
      expect(
        fixture.editor.updateBlockMetadata([{
          blockId: calloutId,
          values: { icon: nextCalloutIcon.id },
        }]),
      ).toBe(true);
    });
    expect(counts.get(calloutId)).toBe((calloutCount ?? 0) + 1);

    const tableId = id("fd-table");
    const tableCount = counts.get(tableId);
    const tableObject = shell(fixture.container, tableId).querySelector(
      ".table-block__object",
    );
    const tableGrid = shell(fixture.container, tableId).querySelector(
      ".table-block__grid",
    );
    const survivingRowId = fixture.editor.getChildBlockIds(tableId)[0]!;
    const survivingRowShell = shell(fixture.container, survivingRowId);
    let insertedRowId: BlockId;
    act(() => {
      insertedRowId = insertFirstDraftTableRow(
        fixture.editor,
        tableId,
        fixture.editor.getChildBlockIds(tableId).length,
      ).rowId;
    });
    expect(counts.get(tableId)).toBe(tableCount);
    expect(shell(fixture.container, tableId).querySelector(".table-block__object")).toBe(
      tableObject,
    );
    expect(shell(fixture.container, tableId).querySelector(".table-block__grid")).toBe(
      tableGrid,
    );
    expect(shell(fixture.container, survivingRowId)).toBe(survivingRowShell);
    act(() => {
      const rowIds = fixture.editor.getChildBlockIds(tableId);
      moveFirstDraftTableRow(fixture.editor, tableId, rowIds[0]!, [
        ...rowIds.slice(1),
        rowIds[0]!,
      ]);
    });
    expect(counts.get(tableId)).toBe(tableCount);
    expect(shell(fixture.container, survivingRowId)).toBe(survivingRowShell);
    act(() => {
      deleteFirstDraftTableRow(fixture.editor, tableId, insertedRowId!);
    });
    expect(counts.get(tableId)).toBe(tableCount);
    expect(shell(fixture.container, survivingRowId)).toBe(survivingRowShell);

    for (const block of Object.values(fixture.editor.readSnapshot().blocks)) {
      expect(
        fixture.container.querySelectorAll(
          `[data-editor-block-shell='true'][data-editor-block-id='${block.id}']`,
        ),
      ).toHaveLength(1);
      if (fixture.editor.definition.blocks[block.type]?.kind === "text") {
        expect(
          shell(fixture.container, block.id).querySelectorAll(
            "[data-editor-text-root='true']",
          ),
        ).toHaveLength(1);
      }
    }
  });

  it("does not execute unrelated renderers or remount shells/text projections across hover", () => {
    const counts = new Map<BlockId, number>();
    const fixture = renderFirstDraft({
      definition(viewState) {
        const base = createFirstDraftEditorDefinition(viewState);
        function CountingParagraphRenderer(
          props: FirstDraftBlockRendererProps,
        ) {
          counts.set(props.block.id, (counts.get(props.block.id) ?? 0) + 1);
          return <ParagraphRenderer {...props} />;
        }
        return {
          ...base,
          blocks: {
            ...base.blocks,
            paragraph: {
              ...base.blocks.paragraph,
              renderer: CountingParagraphRenderer,
            },
          },
        } as EditableEditorDefinition;
      },
    });
    const shells = fixture.container.querySelectorAll<HTMLElement>(
      "[data-editor-block-shell='true']",
    );
    expect(shells.length).toBeGreaterThanOrEqual(100);
    const unrelatedId = id("fd-paragraph-outro");
    const unrelatedCount = counts.get(unrelatedId);
    const unrelatedShell = shell(fixture.container, unrelatedId);
    const unrelatedText = textRoot(fixture.container, unrelatedId);
    const zoneA = zoneFor(fixture.container, "fd-paragraph-intro");
    const zoneB = zoneFor(fixture.container, "fd-paragraph-byline");
    const shellA = shell(fixture.container, "fd-paragraph-intro");
    const shellB = shell(fixture.container, "fd-paragraph-byline");
    const textA = textRoot(fixture.container, "fd-paragraph-intro");
    const textB = textRoot(fixture.container, "fd-paragraph-byline");

    fireEvent.pointerMove(textA);
    fireEvent.pointerMove(textB);

    expect(counts.get(unrelatedId)).toBe(unrelatedCount);
    expect(shell(fixture.container, unrelatedId)).toBe(unrelatedShell);
    expect(textRoot(fixture.container, unrelatedId)).toBe(unrelatedText);
    expect(zoneFor(fixture.container, "fd-paragraph-intro")).toBe(zoneA);
    expect(zoneFor(fixture.container, "fd-paragraph-byline")).toBe(zoneB);
    expect(shell(fixture.container, "fd-paragraph-intro")).toBe(shellA);
    expect(shell(fixture.container, "fd-paragraph-byline")).toBe(shellB);
    expect(textRoot(fixture.container, "fd-paragraph-intro")).toBe(textA);
    expect(textRoot(fixture.container, "fd-paragraph-byline")).toBe(textB);
  });

  it("preserves unrelated renderer, shell, and text-view identities during plus insertion", () => {
    const counts = new Map<BlockId, number>();
    const fixture = renderFirstDraft({
      definition(viewState) {
        const base = createFirstDraftEditorDefinition(viewState);
        function CountingParagraphRenderer(
          props: FirstDraftBlockRendererProps,
        ) {
          counts.set(props.block.id, (counts.get(props.block.id) ?? 0) + 1);
          return <ParagraphRenderer {...props} />;
        }
        return {
          ...base,
          blocks: {
            ...base.blocks,
            paragraph: {
              ...base.blocks.paragraph,
              renderer: CountingParagraphRenderer,
            },
          },
        } as EditableEditorDefinition;
      },
    });
    const unrelatedId = id("fd-paragraph-outro");
    const unrelatedCount = counts.get(unrelatedId);
    const unrelatedShell = shell(fixture.container, unrelatedId);
    const unrelatedText = textRoot(fixture.container, unrelatedId);
    fireEvent.pointerMove(
      textRoot(fixture.container, id("fd-paragraph-intro")),
    );
    fireEvent.click(
      singleControls(fixture.container)!.querySelector(
        "button[aria-label='Add block below']",
      )!,
    );
    expect(counts.get(unrelatedId)).toBe(unrelatedCount);
    expect(shell(fixture.container, unrelatedId)).toBe(unrelatedShell);
    expect(textRoot(fixture.container, unrelatedId)).toBe(unrelatedText);
  });

  it("moves a real canonical block through the installed document DnD provider once", () => {
    const onChange = vi.fn();
    const fixture = renderFirstDraft({ onChange, enableDocumentDnd: true });
    const sourceId = id("fd-paragraph-outro");
    const sourceShell = shell(fixture.container, sourceId);
    const sourceTextRoot = textRoot(fixture.container, sourceId);
    const sourceText = sourceTextRoot.textContent;
    expect(sourceText).not.toBe("");
    fireEvent.pointerMove(sourceTextRoot);
    const handle = singleControls(fixture.container)!.querySelector<HTMLElement>(
      "button[aria-label='Drag block or open block actions']",
    )!;
    const rootTarget = fixture.container.querySelector<HTMLElement>(
      "[data-testid='first-draft-root-start-target']",
    )!;
    const originalTarget = rootTarget;
    const originalRootIds = fixture.editor.getRootBlockIds();
    expect(originalRootIds[0]).not.toBe(sourceId);

    const rectangle = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this === handle) return domRect(20, 20, 24, 24);
        if (this === sourceShell) return domRect(-40, 12, 660, 84);
        if (this === rootTarget) return domRect(20, 100, 600, 8);
        if (this.classList.contains("first-draft-document-block-drag-overlay")) {
          return domRect(-40, 12, 660, 84);
        }
        return domRect(20, 500, 600, 8);
      });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    fireEvent(handle, pointerEvent("pointerdown", 1, 24));
    fireEvent(window, pointerEvent("pointermove", 1, 104));
    const overlay = document.body.querySelector<HTMLElement>(
      ".first-draft-document-block-drag-overlay",
    )!;
    expect(overlay).not.toBeNull();
    expect(overlay.style.width).toBe("660px");
    expect(overlay.style.minHeight).toBe("84px");
    expect(overlay.style.transform).toBe("translate3d(-60px, -8px, 0)");
    expect(overlay.parentElement?.style.position).toBe("fixed");
    expect(overlay.parentElement?.style.pointerEvents).toBe("none");
    expect(overlay.parentElement?.firstElementChild).toBe(overlay);
    expect(overlay.hasAttribute("inert")).toBe(true);
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.textContent).toContain(sourceText);
    expect(
      overlay.querySelectorAll(
        "[data-editor-block-shell='true'], [data-editor-block-id], [data-editor-text-root], [contenteditable='true'], .ProseMirror, .first-draft-block-drop-target, .first-draft-block-controls, .first-draft-block-drag-handle",
      ),
    ).toHaveLength(0);
    expect(shell(fixture.container, sourceId)).toBe(sourceShell);
    expect(textRoot(fixture.container, sourceId)).toBe(sourceTextRoot);
    expect(overlay.contains(document.activeElement)).toBe(false);
    expect(
      fixture.blockDragAndDrop?.captureDocumentBlockDragSession,
    ).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    for (const callback of frames.splice(0)) callback(performance.now());
    expect(rootTarget.dataset.firstDraftBlockDropTargetActive).toBe("true");

    fireEvent(window, pointerEvent("pointermove", 1, 116));
    fireEvent(window, pointerEvent("pointermove", 1, 128));
    expect(
      fixture.blockDragAndDrop?.captureDocumentBlockDragSession,
    ).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    for (const callback of frames.splice(0)) callback(performance.now());
    fireEvent(window, pointerEvent("pointerup", 1, 104));

    expect(fixture.editor.getRootBlockIds()[0]).toBe(sourceId);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(rootTarget).toBe(originalTarget);
    expect(sourceShell.isConnected).toBe(true);
    expect(sourceTextRoot.isConnected).toBe(true);
    expect(shell(fixture.container, sourceId)).toBe(sourceShell);
    expect(textRoot(fixture.container, sourceId)).toBe(sourceTextRoot);
    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getRootBlockIds()).toEqual(originalRootIds);
    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getRootBlockIds()[0]).toBe(sourceId);
    expect(onChange).toHaveBeenCalledTimes(3);
    rectangle.mockRestore();
  });
});

function renderFirstDraft(
  options: {
    readonly onChange?: EditorChangeCallback;
    readonly prepare?: (
      editor: ReturnType<typeof addEditorBlockOperations>,
    ) => void;
    readonly definition?: (
      viewState: ReturnType<typeof createFirstDraftViewStateStore>,
    ) => EditableEditorDefinition;
    readonly enableDocumentDnd?: boolean;
    readonly captureHoverStore?: (store: FirstDraftBlockHoverStore) => void;
    readonly blockActionMenuEditor?: (
      editor: ReturnType<typeof addEditorBlockOperations>,
    ) => ReturnType<typeof addEditorBlockOperations>;
  } = {},
) {
  const viewState = createFirstDraftViewStateStore({
    selectedTabs: { [id("fd-tabs")]: id("fd-tab-overview") },
  });
  const definition = options.definition
    ? options.definition(viewState)
    : createFirstDraftEditorDefinition(viewState);
  const editor = addEditorBlockOperations(
    initializeEditableEditor({
      definition,
      snapshot: createFirstDraftSnapshot(),
      onChange: options.onChange,
    }),
  );
  disposables.push(editor);
  options.prepare?.(editor);
  const blockActionMenuEditor = options.blockActionMenuEditor?.(editor) ?? editor;
  const documentMove = vi.fn<FirstDraftBlockDragAndDropBridge["moveDocumentBlock"]>(
    (expectedSource, position) =>
      moveFirstDraftDocumentBlock(editor, expectedSource, position),
  );
  const blockActionMenuStore = createFirstDraftBlockActionMenuStore();
  const blockDragAndDrop = options.enableDocumentDnd
    ? createDocumentDndBridge(
        editor,
        viewState,
        documentMove,
        blockActionMenuStore,
      )
    : undefined;
  const result = render(
    <div className="first-draft-example">
      <FirstDraftViewStateProvider store={viewState}>
        <FirstDraftTableActionMenuProvider
          store={createFirstDraftTableActionMenuStore()}
        >
          <FirstDraftBlockHoverProvider
            enabled={editor.editable}
            blockDragAndDrop={blockDragAndDrop}
            blockActionMenuStore={blockActionMenuStore}
          >
            {options.captureHoverStore ? (
              <FirstDraftBlockHoverStoreCapture
                capture={options.captureHoverStore}
              />
            ) : null}
            <EditorDocument
              editor={editor}
              renderDocumentLayers={(context) => (
                <FirstDraftBlockActionMenuLayer
                  editor={blockActionMenuEditor}
                  geometry={context.editor.geometry}
                  interactions={context.interactions}
                  store={blockActionMenuStore}
                  viewState={viewState}
                />
              )}
            >
              {options.enableDocumentDnd ? (
                <FirstDraftRootDropTargetRefContext.Consumer>
                  {(rootTargetRef) => (
                    <div
                      ref={rootTargetRef}
                      data-testid="first-draft-root-start-target"
                      className="first-draft-block-drop-target"
                      data-first-draft-block-drop-target-active="false"
                      data-editor-ui="true"
                      aria-hidden="true"
                    />
                  )}
                </FirstDraftRootDropTargetRefContext.Consumer>
              ) : null}
            </EditorDocument>
          </FirstDraftBlockHoverProvider>
        </FirstDraftTableActionMenuProvider>
      </FirstDraftViewStateProvider>
    </div>,
  );
  return {
    ...result,
    editor,
    viewState,
    documentMove,
    blockDragAndDrop,
    blockActionMenuStore,
  };
}

function createDocumentDndBridge(
  editor: ReturnType<typeof addEditorBlockOperations>,
  viewState: ReturnType<typeof createFirstDraftViewStateStore>,
  moveDocumentBlock: FirstDraftBlockDragAndDropBridge["moveDocumentBlock"],
  blockActionMenuStore: FirstDraftBlockActionMenuStore,
): FirstDraftBlockDragAndDropBridge {
  return {
    placementRegistry: createFirstDraftBlockPlacementRegistry(editor),
    captureDocumentBlockDragSession: vi.fn((blockId) =>
      captureFirstDraftDocumentBlockDragSession(editor, viewState, blockId),
    ),
    moveDocumentBlock,
    closeBlockActionMenuForDocumentDrag: (blockId) =>
      blockActionMenuStore.closeForDocumentDrag(blockId),
    startDocumentBlockAutoScroll: () => undefined,
    updateDocumentBlockAutoScrollPoint: () => undefined,
    stopDocumentBlockAutoScroll: () => undefined,
    startTableDragAutoScroll: () => false,
    updateTableDragAutoScrollPoint: () => undefined,
    stopTableDragAutoScroll: () => undefined,
    registerAutoScrollSynchronization: () => undefined,
  };
}

function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  pointerId: number,
  clientY: number,
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    clientX: 24,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  Object.defineProperty(event, "isPrimary", { value: true });
  return event as PointerEvent;
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

let pendingDocumentDragFrames: FrameRequestCallback[] = [];

function installDocumentDragGeometry(
  handle: HTMLElement,
  rootTarget: HTMLElement,
): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this === handle) return domRect(20, 20, 120, 28);
      if (this === rootTarget) return domRect(20, 100, 600, 8);
      return domRect(20, 500, 600, 8);
    },
  );
  pendingDocumentDragFrames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    pendingDocumentDragFrames.push(callback);
    return pendingDocumentDragFrames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
}

function flushAnimationFrames(): void {
  for (const callback of pendingDocumentDragFrames.splice(0)) {
    callback(performance.now());
  }
}

function installPointerCapture(element: HTMLElement): void {
  let captured: number | null = null;
  Object.defineProperties(element, {
    setPointerCapture: {
      configurable: true,
      value: vi.fn((pointerId: number) => {
        captured = pointerId;
      }),
    },
    hasPointerCapture: {
      configurable: true,
      value: vi.fn((pointerId: number) => captured === pointerId),
    },
    releasePointerCapture: {
      configurable: true,
      value: vi.fn((pointerId: number) => {
        if (captured === pointerId) captured = null;
      }),
    },
  });
}

function firstTextDescendant(
  editor: ReturnType<typeof addEditorBlockOperations>,
  parentId: BlockId,
): BlockId | null {
  for (const childId of editor.getChildBlockIds(parentId)) {
    const child = editor.getBlock(childId);
    if (!child) continue;
    const kind = editor.definition.blocks[child.type]?.kind;
    if (kind === "text") return child.id;
    if (kind === "wrapper") {
      const descendant = firstTextDescendant(editor, child.id);
      if (descendant) return descendant;
    }
  }
  return null;
}

function expectHoverOwner(
  container: ParentNode,
  targetBlockId: string | BlockId,
  ownerBlockId: string | BlockId,
  targetSelector = "[data-editor-text-root='true']",
): void {
  const target = shell(container, targetBlockId).querySelector(targetSelector);
  fireEvent.pointerMove(target ?? shell(container, targetBlockId));
  expect(controlsOwner(container)).toBe(ownerBlockId);
  expect(
    container.querySelectorAll("[data-first-draft-block-controls='true']"),
  ).toHaveLength(1);
}

function expectForbiddenPreviewOwnership(overlay: HTMLElement): void {
  expect(overlay.hasAttribute("inert")).toBe(true);
  expect(overlay.getAttribute("aria-hidden")).toBe("true");
  expect(
    overlay.querySelectorAll(
      "[data-editor-block-shell='true'], [data-editor-block-id], [data-editor-text-root], [contenteditable], .ProseMirror, .first-draft-block-drop-target, .first-draft-block-controls, .first-draft-block-drag-handle",
    ),
  ).toHaveLength(0);
}

function expectTransparentBackground(element: Element): void {
  expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(
    getComputedStyle(element).backgroundColor,
  );
}

function shell(container: ParentNode, blockId: string | BlockId): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-editor-block-shell='true'][data-editor-block-id='${blockId}']`,
  );
  if (!element) throw new Error(`Missing shell for ${blockId}`);
  return element;
}

function textRoot(
  container: ParentNode,
  blockId: string | BlockId,
): HTMLElement {
  const blockShell = shell(container, blockId);
  const sharedView = blockShell.querySelector<HTMLElement>(
    "[data-editor-shared-text-view='true']",
  );
  if (sharedView) return sharedView;
  const element = blockShell.querySelector<HTMLElement>(
    ":scope > * [data-editor-text-root='true'], :scope > [data-editor-text-root='true']",
  );
  if (!element) throw new Error(`Missing text root for ${blockId}`);
  return element;
}

function activeTextRoot(container: ParentNode): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    ".ProseMirror[data-editor-input-owner='true']",
  );
  if (!element) throw new Error("Missing active text root");
  return element;
}

function requiredActiveTextView(
  editor: ReturnType<typeof renderFirstDraft>["editor"],
): Parameters<typeof readEditorViewContentSize>[0] {
  const readActiveTextView = Reflect.get(editor, "readActiveTextView");
  if (typeof readActiveTextView !== "function") {
    throw new Error("Editor does not expose the active shared text view");
  }
  const view = Reflect.apply(readActiveTextView, editor, []) as
    | Parameters<typeof readEditorViewContentSize>[0]
    | null;
  if (!view) throw new Error("Missing active shared text view");
  return view;
}

function settleActiveTextRange(
  editor: ReturnType<typeof renderFirstDraft>["editor"],
  blockId: BlockId,
  anchorOffset: number,
  headOffset: number,
): void {
  const [anchor, head] = createInternalTextPoints(
    editor,
    blockId,
    anchorOffset,
    blockId,
    headOffset,
  );
  const settled = editor.selectionController.extendSelection(
    anchor,
    head,
    editor,
    editor.getSelectionGraphRevision(),
    { publication: { kind: "standalone-local" }, cause: "programmatic-edit" },
  );
  if (!settled) throw new Error("Expected the active text range to settle");
  const project = Reflect.get(editor, "projectActiveTextSelection");
  const synchronization = Reflect.get(editor, "nativeSelectionSynchronization") as
    | { reconcileTextSelection?: unknown }
    | undefined;
  const reconcile = synchronization?.reconcileTextSelection;
  if (typeof project !== "function" || typeof reconcile !== "function") {
    throw new Error("Editor does not expose mounted text selection projection");
  }
  expect(
    Reflect.apply(project, editor, [blockId, anchorOffset, headOffset]),
  ).toBe(true);
  expect(
    Reflect.apply(reconcile, synchronization, [
      blockId,
      anchorOffset,
      headOffset,
    ]),
  ).toBe(true);
}

function settleCrossBlockTextRange(
  editor: ReturnType<typeof renderFirstDraft>["editor"],
  anchor: ReturnType<typeof captureMountedTextPoint>,
  head: ReturnType<typeof captureMountedTextPoint>,
): void {
  const settled = editor.selectionController.extendSelection(
    anchor,
    head,
    editor,
    editor.getSelectionGraphRevision(),
    { publication: { kind: "standalone-local" }, cause: "programmatic-edit" },
  );
  if (!settled) throw new Error("Expected the cross-block range to settle");
}

function captureMountedTextPoint(
  editor: ReturnType<typeof renderFirstDraft>["editor"],
  blockId: BlockId,
  offset: number,
): Parameters<typeof editor.selectionController.extendSelection>[0] {
  const result = editor.focusText(blockId, { offset, preventScroll: true });
  if (result.status !== "focused") {
    throw new Error(`Could not focus ${blockId} to capture a text anchor`);
  }
  const canonical = editor.selectionController.getCanonicalSnapshot();
  if (canonical.kind !== "document") {
    throw new Error(`Missing canonical selection for ${blockId}`);
  }
  const point = canonical.snapshot.documentSelection.focus;
  if (!point?.textAnchor) {
    throw new Error(`Missing stable text anchor for ${blockId}`);
  }
  return point;
}

function createInternalTextPoints(
  editor: ReturnType<typeof renderFirstDraft>["editor"],
  anchorBlockId: BlockId,
  anchorOffset: number,
  headBlockId: BlockId,
  headOffset: number,
): readonly [
  Parameters<typeof editor.selectionController.extendSelection>[0],
  Parameters<typeof editor.selectionController.extendSelection>[1],
] {
  const createPoint = Reflect.get(editor, "createSelectionTextPoint");
  if (typeof createPoint !== "function") {
    throw new Error("Editor does not expose renderer selection points");
  }
  const anchor = Reflect.apply(createPoint, editor, [
    anchorBlockId,
    anchorOffset,
  ]) as Parameters<typeof editor.selectionController.extendSelection>[0] | null;
  const head = Reflect.apply(createPoint, editor, [
    headBlockId,
    headOffset,
  ]) as Parameters<typeof editor.selectionController.extendSelection>[1] | null;
  if (!anchor) throw new Error(`Expected a live anchor for ${anchorBlockId}`);
  if (!head) throw new Error(`Expected a live head for ${headBlockId}`);
  return [anchor, head];
}

function expectCanonicalEndpoints(
  editor: ReturnType<typeof renderFirstDraft>["editor"],
  expected: unknown,
): void {
  const selection = editor.selectionController.getCanonicalSnapshot();
  expect(selection.kind).toBe("document");
  if (selection.kind !== "document") {
    throw new Error("Expected a document selection around checklist text");
  }
  expect(selection.snapshot.endpoints).toEqual(expected);
}

function expectDocumentSelection(
  editor: ReturnType<typeof renderFirstDraft>["editor"],
  blockId: BlockId,
): void {
  const selection = editor.selection.getSnapshot();
  expect(selection.kind).toBe("document");
  if (selection.kind !== "document") {
    throw new Error("Expected a canonical document selection");
  }
  expect(selection.snapshot.documentSelection.normalizedStart).toMatchObject({
    blockId,
    textOffset: 0,
  });
  expect(selection.snapshot.documentSelection.normalizedEnd).toMatchObject({
    blockId,
    textOffset: 0,
  });
}

function zoneFor(
  container: ParentNode,
  blockId: string | BlockId,
): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-first-draft-block-hover-zone-for='${blockId}']`,
  );
}

function singleControls(container: ParentNode): HTMLElement | null {
  const controls = container.querySelectorAll<HTMLElement>(
    "[data-first-draft-block-controls='true']",
  );
  expect(controls.length).toBeLessThanOrEqual(1);
  return controls[0] ?? null;
}

function controlsOwner(container: ParentNode): string | null {
  return singleControls(container)?.dataset.firstDraftBlockControlsFor ?? null;
}

function nativeCaretOffset(root: HTMLElement): number | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.focusNode || !root.contains(selection.focusNode)) return null;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(selection.focusNode, selection.focusOffset);
  const offset = range.toString().length;
  range.detach();
  return offset;
}

function nativeSelectionOffsets(root: HTMLElement): {
  readonly anchor: number;
  readonly focus: number;
} | null {
  const selection = root.ownerDocument.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  ) {
    return null;
  }
  const offsetAt = (node: Node, offset: number) => {
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    const value = range.toString().length;
    range.detach();
    return value;
  };
  return {
    anchor: offsetAt(selection.anchorNode, selection.anchorOffset),
    focus: offsetAt(selection.focusNode, selection.focusOffset),
  };
}
