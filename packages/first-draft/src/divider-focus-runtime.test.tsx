import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import type { BlockId } from "@repo/editor-core/kernel";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import {
  EditorDocument,
  type EditorContentRuntime,
} from "@repo/editor-web/document-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstDraftBlockHoverProvider } from "./block-controls/index.ts";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
} from "./blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "./first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "./first-draft-fixture.ts";
import { FirstDraftSlashMenu } from "./slash-menu/first-draft-slash-menu.tsx";
import {
  initializeTestEditableEditor,
  type FirstDraftTestEditor,
} from "./test-editor.ts";

const sourceId = "fd-empty-final" as BlockId;
const disposables: FirstDraftTestEditor[] = [];

describe("First Draft divider focus presentation", () => {
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

  it("creates a divider with a following caret and restores both roots through history", () => {
    const onChange = vi.fn();
    const viewState = createFirstDraftViewStateStore();
    const editor = addEditorBlockOperations(
      initializeTestEditableEditor({
        definition: createFirstDraftEditorDefinition(viewState),
        snapshot: createDividerSourceSnapshot(),
        onChange,
      }),
    );
    disposables.push(editor);
    const rendered = render(
      <FirstDraftViewStateProvider store={viewState}>
        <FirstDraftBlockHoverProvider enabled>
          <EditorDocument
            editor={editor}
            renderDocumentLayers={(context) => (
              <FirstDraftSlashMenu
                editor={editor}
                geometry={editor.geometry}
                interactions={context.interactions}
              />
            )}
          />
        </FirstDraftBlockHoverProvider>
      </FirstDraftViewStateProvider>,
    );

    act(() => {
      expect(
        editor.focusText(sourceId, { offset: 0, preventScroll: true }).status,
      ).toBe("focused");
      expect(typeAtCommittedSelection(editor, "/divider")).toBe(true);
    });
    expect(editor.getTypingTriggerSession()).toMatchObject({
      triggerId: "slash",
      query: "divider",
    });

    fireEvent.click(screen.getByRole("option", { hidden: true }));

    const createdRoots = editor.getRootBlockIds();
    expect(createdRoots).toHaveLength(2);
    const dividerId = createdRoots[0]!;
    const paragraphId = createdRoots[1]!;
    expect(editor.getBlock(dividerId)?.type).toBe("divider");
    expect(editor.getBlock(paragraphId)?.type).toBe("paragraph");
    expect(editor.readBlockPlainText(paragraphId, "paragraph")).toBe("");
    expectCanonicalTextSelection(editor, paragraphId, 0);
    expect(document.activeElement).toBe(textRoot(rendered.container, paragraphId));
    expect(document.activeElement).not.toBe(divider(rendered.container, dividerId));
    expect(
      rendered.container.querySelector(
        atomicPaintSelector(dividerId),
      ),
    ).toBeNull();

    act(() => expect(editor.undo()).toEqual({ status: "applied" }));
    expect(editor.getRootBlockIds()).toEqual([sourceId]);
    expect(editor.getBlock(dividerId)).toBeNull();
    expect(editor.getBlock(paragraphId)).toBeNull();
    expect(editor.readBlockPlainText(sourceId, "paragraph")).toBe("/divider");

    act(() => expect(editor.redo()).toEqual({ status: "applied" }));
    expect(editor.getRootBlockIds()).toEqual(createdRoots);
    expect(editor.getBlock(dividerId)?.type).toBe("divider");
    expect(editor.getBlock(paragraphId)?.type).toBe("paragraph");
    expectCanonicalTextSelection(editor, paragraphId, 0);
    expect(document.activeElement).toBe(textRoot(rendered.container, paragraphId));
  });

  it("selects and natively focuses the divider after Backspace removes its atomic follower", () => {
    const viewState = createFirstDraftViewStateStore();
    const editor = addEditorBlockOperations(
      initializeTestEditableEditor({
        definition: createFirstDraftEditorDefinition(viewState),
        snapshot: createDividerFollowerSnapshot(),
        onChange: vi.fn(),
      }),
    );
    disposables.push(editor);
    const rendered = render(
      <FirstDraftViewStateProvider store={viewState}>
        <FirstDraftBlockHoverProvider enabled>
          <EditorDocument editor={editor} />
        </FirstDraftBlockHoverProvider>
      </FirstDraftViewStateProvider>,
    );
    const dividerId = "fd-divider" as BlockId;
    const followerId = "fd-divider-follower" as BlockId;

    const dividerRule = divider(rendered.container, dividerId);
    dividerRule.getBoundingClientRect = () => rectangle(20, 20, 240, 2);
    expect(dividerRule.tabIndex).toBe(-1);
    expect(dividerRule.getAttribute("aria-label")).toBe("Divider");
    expect(dividerRule.getAttribute("data-editor-object-root")).toBe("true");
    expect(
      dividerRule.getAttribute("data-editor-selection-bounds-target"),
    ).toBe("drag-visual");
    expect(
      dividerRule.getAttribute("data-editor-selection-bounds-block-id"),
    ).toBe(dividerId);
    const follower = divider(rendered.container, followerId);
    act(() => {
      expect(
        editor.focusBlock(followerId, { preventScroll: true }).status,
      ).toBe("focused");
    });
    expect(document.activeElement).toBe(follower);

    expect(
      fireEvent.keyDown(follower, {
        key: "Backspace",
      }),
    ).toBe(false);

    expect(editor.getRootBlockIds()).toEqual([dividerId]);
    expect(editor.getBlock(dividerId)?.type).toBe("divider");
    expect(editor.getBlock(followerId)).toBeNull();
    const canonical = editor.selectionController.getCanonicalSnapshot();
    expect(canonical).toMatchObject({
      kind: "document",
      snapshot: {
        documentSelection: {
          anchor: {
            blockId: dividerId,
            blockType: "divider",
            blockCategory: "object",
            textAnchor: null,
          },
          focus: {
            blockId: dividerId,
            blockType: "divider",
            blockCategory: "object",
            textAnchor: null,
          },
        },
      },
    });
    expect(
      rendered.container.querySelector(atomicPaintSelector(dividerId)),
    ).not.toBeNull();
    act(() => {
      expect(
        editor.focusBlock(dividerId, { preventScroll: true }).status,
      ).toBe("focused");
    });
    expect(document.activeElement).toBe(dividerRule);
  });
});

function createDividerSourceSnapshot(): EditorInstanceSnapshot {
  const source = createFirstDraftSnapshot();
  return {
    ...source,
    blocks: { [sourceId]: source.blocks[sourceId]! },
    rootBlockIds: [sourceId],
    childIdsByParentId: {},
    content: { [sourceId]: source.content[sourceId]! },
    opaqueContentCheckpoints: {
      [sourceId]: source.opaqueContentCheckpoints[sourceId]!,
    },
  };
}

function createDividerFollowerSnapshot(): EditorInstanceSnapshot {
  const source = createFirstDraftSnapshot();
  const dividerId = "fd-divider" as BlockId;
  const followerId = "fd-divider-follower" as BlockId;
  return {
    ...source,
    blocks: {
      [dividerId]: source.blocks[dividerId]!,
      [followerId]: { ...source.blocks[dividerId]!, id: followerId },
    },
    rootBlockIds: [dividerId, followerId],
    childIdsByParentId: {},
    content: {},
    opaqueContentCheckpoints: {},
  };
}

function typeAtCommittedSelection(
  editor: FirstDraftTestEditor,
  text: string,
): boolean {
  const canonical = editor.selectionController.getCanonicalSnapshot();
  const selection =
    canonical.kind === "document"
      ? canonical.snapshot.documentSelection
      : null;
  const head = selection?.focus ?? null;
  if (!head) throw new Error("Missing committed caret");
  const nextPoint = {
    blockId: head.blockId,
    blockType: head.blockType,
    textOffset: head.textOffset + text.length,
    affinity: "forward" as const,
  };
  const runtimeEditor = editor as FirstDraftTestEditor & {
    readonly contentRuntime: EditorContentRuntime;
  };
  const base = runtimeEditor.contentRuntime.readContentBaseToken(
    head.blockId,
    head.blockType,
    editor.getSelectionGraphRevision(),
  );
  return editor.acceptContentOperationProposal(
    {
      base,
      operations: [
        {
          kind: "insertInlineContent",
          blockId: head.blockId,
          blockType: head.blockType,
          target: { kind: "text" },
          position: {
            blockId: head.blockId,
            offset: head.textOffset,
            contentVersion: editor.getBlock(head.blockId)?.contentVersion ?? null,
          },
          content: [{ type: "text", text }],
        },
      ],
      selectionAfter: {
        direction: "forward",
        anchor: nextPoint,
        focus: nextPoint,
      },
    },
    {
      origin: "prosemirror-proposal",
      selectionPresentation: "restore-native",
      provenance: { kind: "typing", text, inputType: "text" },
    },
  ).ok;
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

function divider(container: ParentNode, blockId: BlockId): HTMLHRElement {
  const result = container.querySelector<HTMLHRElement>(
    `[data-editor-block-id="${blockId}"] .divider-block__rule`,
  );
  if (!result) throw new Error(`Missing divider ${blockId}`);
  return result;
}

function atomicPaintSelector(blockId: BlockId): string {
  return `[data-editor-selection-paint="atomic-surface"][data-editor-selection-paint-block-id="${blockId}"]`;
}

function rectangle(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}
