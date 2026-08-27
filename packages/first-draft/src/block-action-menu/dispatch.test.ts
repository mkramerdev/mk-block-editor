import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import type { EditorChangeCallback } from "@repo/editor-web/document-runtime";
import { createFirstDraftViewStateStore } from "../blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import { initializeTestEditableEditor } from "../test-editor.ts";
import {
  dispatchFirstDraftBlockAction,
  readFirstDraftBlockActionAvailability,
} from "./dispatch.ts";
import type { FirstDraftOpenBlockActionMenuSession } from "./store.tsx";

const id = (value: string) => value as BlockId;
const editors: Array<{ dispose(): void }> = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("First Draft block action dispatch", () => {
  it("duplicates the complete canonical subtree after the live source with new identities", () => {
    const onChange = vi.fn();
    const { editor, viewState } = createEditor(onChange);
    const sourceId = id("fd-callout");
    const sourceIds = collectSubtreeIds(editor, sourceId);
    const sourceBlocks = sourceIds.map((blockId) => editor.getBlock(blockId)!);
    const sourceContent = sourceBlocks.map((block) =>
      editor.definition.blocks[block.type]?.kind === "text"
        ? editor.readBlockContent(block.id, block.type)
        : null,
    );
    const rootsBefore = editor.getRootBlockIds();
    const sourceIndex = rootsBefore.indexOf(sourceId);

    const result = dispatchFirstDraftBlockAction(
      editor,
      viewState,
      session(sourceId),
      "duplicate-block",
    );

    expect(result.kind).toBe("applied");
    const duplicateId = editor.getRootBlockIds()[sourceIndex + 1]!;
    expect(duplicateId).not.toBe(sourceId);
    expect(editor.getBlock(sourceId)).not.toBeNull();
    expect(editor.getBlock(duplicateId)?.type).toBe("callout");
    const duplicateIds = collectSubtreeIds(editor, duplicateId);
    expect(duplicateIds).toHaveLength(sourceIds.length);
    expect(duplicateIds.every((blockId) => !sourceIds.includes(blockId))).toBe(
      true,
    );
    expect(
      duplicateIds.map((blockId) => {
        const block = editor.getBlock(blockId)!;
        return editor.definition.blocks[block.type]?.kind === "text"
          ? editor.readBlockContent(block.id, block.type)
          : null;
      }),
    ).toEqual(sourceContent);
    expect(
      duplicateIds.map((blockId) => editor.getBlock(blockId)?.metadata),
    ).toEqual(sourceBlocks.map((block) => block.metadata));
    expect(result).toMatchObject({
      kind: "applied",
      operation: {
        transaction: {
          transaction: { selection: { blockId: duplicateIds[1] } },
        },
      },
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.getBlock(duplicateId)).toBeNull();
    expect(editor.undo()).toEqual({ status: "history-empty" });
  });

  it("deletes the complete canonical subtree, cleans its view state, and retains one undo entry", () => {
    const onChange = vi.fn();
    const { editor, viewState } = createEditor(onChange);
    const sourceId = id("fd-callout");
    const sourceIds = collectSubtreeIds(editor, sourceId);
    viewState.setBlockCollapsed(sourceId, true);

    const result = dispatchFirstDraftBlockAction(
      editor,
      viewState,
      session(sourceId),
      "delete-block",
    );

    expect(result.kind).toBe("applied");
    expect(sourceIds.every((blockId) => editor.getBlock(blockId) === null)).toBe(
      true,
    );
    expect(viewState.isBlockCollapsed(sourceId)).toBe(false);
    expect(result).toMatchObject({
      kind: "applied",
      operation: { transaction: { transaction: { selection: {} } } },
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.getBlock(sourceId)).not.toBeNull();
    expect(editor.undo()).toEqual({ status: "history-empty" });
  });

  it("re-reads live placement at activation time", () => {
    const onChange = vi.fn();
    const { editor, viewState } = createEditor(onChange);
    const targetId = id("fd-paragraph-intro");
    const opened = session(targetId);
    const movedIndex = editor.getRootBlockIds().length;
    expect(
      editor.moveBlockToPosition({
        blockId: targetId,
        position: { parentId: null, childIndex: movedIndex },
      }).ok,
    ).toBe(true);
    onChange.mockClear();

    const result = dispatchFirstDraftBlockAction(
      editor,
      viewState,
      opened,
      "insert-before",
    );

    expect(result.kind).toBe("applied");
    const roots = editor.getRootBlockIds();
    const targetIndex = roots.indexOf(targetId);
    expect(editor.getBlock(roots[targetIndex - 1]!)?.type).toBe("paragraph");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("keeps structurally unavailable actions visible as disabled and inert", () => {
    const onChange = vi.fn();
    const { editor, viewState } = createEditor(onChange);
    const constrained = session(id("fd-tab-overview"));

    expect(
      readFirstDraftBlockActionAvailability(
        editor,
        constrained,
        "insert-before",
      ),
    ).toEqual({ kind: "disabled" });
    expect(
      dispatchFirstDraftBlockAction(
        editor,
        viewState,
        constrained,
        "insert-before",
      ),
    ).toEqual({ kind: "disabled" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("returns stale for a removed target and rejected for an operation failure", () => {
    const onChange = vi.fn();
    const { editor, viewState } = createEditor(onChange);
    const stale = session(id("missing-block"));
    expect(
      dispatchFirstDraftBlockAction(
        editor,
        viewState,
        stale,
        "duplicate-block",
      ),
    ).toEqual({ kind: "stale" });

    const sourceId = id("fd-paragraph-intro");
    const failure = new Error("operation failed");
    const throwingEditor = {
      getBlock: editor.getBlock.bind(editor),
      getChildBlockIds: editor.getChildBlockIds.bind(editor),
      deleteBlock: () => {
        throw failure;
      },
    } as unknown as typeof editor;
    expect(
      dispatchFirstDraftBlockAction(
        throwingEditor,
        viewState,
        session(sourceId),
        "delete-block",
      ),
    ).toEqual({ kind: "rejected", error: failure });
    expect(editor.getBlock(sourceId)).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

function createEditor(onChange: EditorChangeCallback) {
  const viewState = createFirstDraftViewStateStore();
  const editor = addEditorBlockOperations(
    initializeTestEditableEditor({
      definition: createFirstDraftEditorDefinition(viewState),
      snapshot: createFirstDraftSnapshot(),
      onChange,
    }),
  );
  editors.push(editor);
  return { editor, viewState };
}

function session(blockId: BlockId): FirstDraftOpenBlockActionMenuSession {
  const triggerElement = document.createElement("button");
  document.body.append(triggerElement);
  return {
    kind: "open",
    blockId,
    triggerElement,
    cause: "pointer",
  };
}

function collectSubtreeIds(
  editor: ReturnType<typeof createEditor>["editor"],
  rootId: BlockId,
): BlockId[] {
  const ids: BlockId[] = [];
  const visit = (blockId: BlockId): void => {
    ids.push(blockId);
    for (const childId of editor.getChildBlockIds(blockId)) visit(childId);
  };
  visit(rootId);
  return ids;
}
