import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import { EditorDocument } from "@repo/editor-web/document-runtime";
import { initializeTestEditableEditor as initializeEditableEditor } from "../test-editor.ts";
import type { EditableEditorDefinition } from "@repo/editor-web/editor";
import type { FirstDraftBlockRendererProps } from "../first-draft-editor-contracts.ts";
import { ParagraphRenderer } from "../blocks/core/renderers.tsx";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
} from "../blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import { FirstDraftBlockHoverProvider } from "./index.ts";

const id = (value: string) => value as BlockId;
const disposables: Array<{ dispose(): void }> = [];

afterEach(() => {
  cleanup();
  for (const editor of disposables.splice(0)) editor.dispose();
  vi.restoreAllMocks();
});

describe("First Draft semantic block-control ownership", () => {
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
      "fd-bookmark",
      "fd-table",
    ];
    for (const blockId of eligibleBlockIds) {
      expect(zoneFor(fixture.container, blockId)).not.toBeNull();
    }

    const placeholderFixture = renderFirstDraft({
      prepare(editor) {
        expect(
          editor.replaceBlock({
            blockId: id("fd-paragraph-outro"),
            blockType: "placeholder",
          }).ok,
        ).toBe(true);
      },
    });
    const placeholderShell =
      placeholderFixture.container.querySelector<HTMLElement>(
        "[data-editor-block-type='placeholder']",
      );
    expect(placeholderShell).not.toBeNull();
    expect(
      zoneFor(
        placeholderFixture.container,
        placeholderShell!.dataset.editorBlockId!,
      ),
    ).not.toBeNull();
  });

  it("uses the normalized heading level's control inset", () => {
    const fixture = renderFirstDraft();
    const cases = [
      ["fd-heading-1", "36px"],
      ["fd-heading-2", "14px"],
      ["fd-column-left-heading", "0px"],
    ] as const;
    for (const [blockId, expectedInset] of cases) {
      expectHoverOwner(fixture.container, blockId, blockId);
      expect(
        singleControls(fixture.container)?.style.getPropertyValue(
          "--first-draft-block-controls-inset-block-start",
        ),
      ).toBe(expectedInset);
    }
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
    const checkbox = shell(
      fixture.container,
      "fd-check-unchecked",
    ).querySelector<HTMLInputElement>(
      "input[aria-label='Checklist item complete']",
    )!;

    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(true);
    expect(
      fixture.editor.getBlock(id("fd-check-unchecked"))?.metadata?.checked,
    ).toBe(true);
    const selectionAfter =
      fixture.editor.selectionController.getCanonicalSnapshot();
    expect(selectionBefore.kind).toBe("document");
    expect(selectionAfter.kind).toBe("document");
    if (
      selectionBefore.kind !== "document" ||
      selectionAfter.kind !== "document"
    ) {
      throw new Error("Expected a document selection around checklist text");
    }
    expect(selectionAfter.snapshot.endpoints).toEqual(
      selectionBefore.snapshot.endpoints,
    );
    expect(onChange).toHaveBeenCalledOnce();
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

  it("delegates table cells and table UI to one table owner and gives no row/cell chrome", () => {
    const fixture = renderFirstDraft();
    expect(zoneFor(fixture.container, "fd-table-row-1")).toBeNull();
    expect(zoneFor(fixture.container, "fd-table-cell-1-1")).toBeNull();
    expectHoverOwner(fixture.container, "fd-table-cell-1-1", "fd-table");
    const controls = singleControls(fixture.container)!;
    expect(
      controls.parentElement?.classList.contains("table-block__chrome-anchor"),
    ).toBe(true);
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
    const sourceTextRoot = fixture.editor.readActiveTextView()!.dom;
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
    fireEvent.keyDown(grip, { key: "Enter" });

    expect(fixture.editor.getRootBlockIds()).toEqual(rootsBefore);
    expect(fixture.editor.selectionController.getCanonicalSnapshot()).toMatchObject(
      { kind: "none" },
    );
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
    const sourceTextRoot = fixture.editor.readActiveTextView()!.dom;
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
      expect(document.activeElement).toBe(
        fixture.editor.readActiveTextView()?.dom,
      ),
    );
    const createdTextRoot = fixture.editor.readActiveTextView()!.dom;
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
  it("does not execute unrelated renderers or remount shells/text projections across hover", () => {
    const counts = new Map<BlockId, number>();
    const projectionRegistrations = new Map<BlockId, number>();
    const fixture = renderFirstDraft({
      inspect(editor) {
        const register = editor.registerTextEditingHost.bind(editor);
        vi.spyOn(editor, "registerTextEditingHost").mockImplementation(
          (input) => {
            projectionRegistrations.set(
              input.blockId,
              (projectionRegistrations.get(input.blockId) ?? 0) + 1,
            );
            return register(input);
          },
        );
      },
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
    const unrelatedProjectionRegistrations =
      projectionRegistrations.get(unrelatedId);
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
    expect(projectionRegistrations.get(unrelatedId)).toBe(
      unrelatedProjectionRegistrations,
    );
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
    const projectionRegistrations = new Map<BlockId, number>();
    const fixture = renderFirstDraft({
      inspect(editor) {
        const register = editor.registerTextEditingHost.bind(editor);
        vi.spyOn(editor, "registerTextEditingHost").mockImplementation(
          (input) => {
            projectionRegistrations.set(
              input.blockId,
              (projectionRegistrations.get(input.blockId) ?? 0) + 1,
            );
            return register(input);
          },
        );
      },
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
    const unrelatedProjectionRegistrations =
      projectionRegistrations.get(unrelatedId);
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
    expect(projectionRegistrations.get(unrelatedId)).toBe(
      unrelatedProjectionRegistrations,
    );
    expect(shell(fixture.container, unrelatedId)).toBe(unrelatedShell);
    expect(textRoot(fixture.container, unrelatedId)).toBe(unrelatedText);
  });
});

function renderFirstDraft(
  options: {
    readonly onChange?: ReturnType<typeof vi.fn>;
    readonly prepare?: (
      editor: ReturnType<typeof addEditorBlockOperations>,
    ) => void;
    readonly definition?: (
      viewState: ReturnType<typeof createFirstDraftViewStateStore>,
    ) => EditableEditorDefinition;
    readonly inspect?: (
      editor: ReturnType<typeof addEditorBlockOperations>,
    ) => void;
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
  options.inspect?.(editor);
  const result = render(
    <FirstDraftViewStateProvider store={viewState}>
      <FirstDraftBlockHoverProvider enabled={editor.editable}>
        <EditorDocument editor={editor} />
      </FirstDraftBlockHoverProvider>
    </FirstDraftViewStateProvider>,
  );
  return { ...result, editor };
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
