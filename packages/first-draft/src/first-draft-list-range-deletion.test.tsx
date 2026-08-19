import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import { richTextDocumentContentSize } from "@repo/editor-core/content/rich-text";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorImplementation } from "@repo/editor-react/editor";
import { EditorDocument } from "@repo/editor-web/document-runtime";
import { compileCanonicalEditorDefinition } from "@repo/editor-web/editor-definition";
import { initializeEditableEditor } from "@repo/editor-web/editor";
import type { EditableEditorDefinition } from "@repo/editor-web/editor";
import {
  createYjsBlockContentRuntime,
  type YjsBlockContentRuntime,
} from "@repo/editor-yjs-dom";
import { afterEach, describe, expect, it } from "vitest";
import { FirstDraftBlockHoverProvider } from "./block-controls/index.ts";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
} from "./blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "./first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "./first-draft-fixture.ts";
import { createFirstDraftBootstrapFromSnapshot } from "./read-model/bootstrap.ts";

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
    extraTextId: id("fd-paragraph-before-checklist"),
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
    extraTextId: id("fd-paragraph-interactions"),
    renderedItemSelector: ".checklist-block__item",
    htmlListTag: "ul",
  },
];

describe("First Draft canonical list-item range deletion", () => {
  afterEach(cleanup);

  it.each(listCases)(
    "removes the complete middle $name item and preserves its siblings",
    (listCase) => {
      const fixture = renderListFixture(listCase);
      const [firstItem, removedItem, lastItem] = listCase.itemIds;
      const removedPrimary = listCase.textIds[1];
      const firstMetadata = fixture.editor.getBlock(firstItem)?.metadata;
      const lastMetadata = fixture.editor.getBlock(lastItem)?.metadata;

      const selectionHold = commitCompleteMiddleItemSelection(
        fixture,
        listCase,
      );
      fireEvent.keyDown(fixture.activeTextView, { key: "Delete" });
      selectionHold.release();

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

      fixture.dispose();
    },
  );

  it("cuts a complete item as a list-shaped fragment before removing it", () => {
    const listCase = listCases[0]!;
    const fixture = renderListFixture(listCase);
    const selectionHold = commitCompleteMiddleItemSelection(fixture, listCase);
    const clipboard = new MemoryDataTransfer();
    const event = clipboardEvent("cut", clipboard);

    act(() => fixture.activeTextView.dispatchEvent(event));
    selectionHold.release();

    expect(event.defaultPrevented).toBe(true);
    expect(clipboard.getData("text/plain")).toContain(
      "Add ten external research partners",
    );
    expect(clipboard.getData("text/html")).toContain(
      `<${listCase.htmlListTag}`,
    );
    expect(clipboard.getData("text/html")).toContain("<li");
    expect(fixture.editor.getBlock(listCase.itemIds[1])).toBeNull();
    expect(fixture.editor.getChildBlockIds(listCase.containerId)).toEqual([
      listCase.itemIds[0],
      listCase.itemIds[2],
    ]);

    fixture.dispose();
  });
});

function renderListFixture(listCase: ListCase) {
  const snapshot = createListSnapshot(listCase);
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
  if (!contentRuntime) throw new Error("Missing block content runtime");
  return {
    ...rendered,
    snapshot,
    editor: editor as unknown as EditorImplementation,
    contentRuntime,
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
) {
  const end = richTextDocumentContentSize(
    fixture.snapshot.content[listCase.extraTextId]!,
  );
  const hold = fixture.contentRuntime.acquireBlockContent(
    listCase.textIds[1],
    "paragraph",
    "canonical-transaction",
  );
  commitSelection(
    fixture.editor,
    listCase.textIds[1],
    0,
    listCase.extraTextId,
    end,
  );
  return hold;
}

function commitSelection(
  editor: EditorImplementation,
  anchorBlockId: BlockId,
  anchorOffset: number,
  focusBlockId: BlockId,
  focusOffset: number,
): void {
  act(() => {
    const anchor = captureTextPoint(editor, anchorBlockId, anchorOffset);
    const focus = captureTextPoint(editor, focusBlockId, focusOffset);
    const settlement = editor.selectionController.commitCanonicalSelection(
      { direction: "forward", anchor, focus },
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
