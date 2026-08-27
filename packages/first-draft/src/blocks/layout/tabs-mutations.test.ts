import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import { initializeTestEditableEditor as initializeEditableEditor } from "../../test-editor.ts";
import { createFirstDraftEditorDefinition } from "../../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../../first-draft-fixture.ts";
import { createFirstDraftViewStateStore } from "../view-state.tsx";
import {
  addFirstDraftTab,
  chooseFirstDraftTabTitle,
  deleteFirstDraftTab,
  renameFirstDraftTab,
  resolveFirstDraftTabsTarget,
} from "./tabs-mutations.ts";

const id = (value: string) => value as BlockId;
const disposables: Array<{ dispose(): void }> = [];

afterEach(() => {
  for (const editor of disposables.splice(0)) editor.dispose();
  vi.restoreAllMocks();
});

function fixture() {
  const onChange = vi.fn();
  const viewState = createFirstDraftViewStateStore();
  const editor = addEditorBlockOperations(
    initializeEditableEditor({
      definition: createFirstDraftEditorDefinition(viewState),
      snapshot: createFirstDraftSnapshot(),
      onChange,
    }),
  );
  disposables.push(editor);
  return { editor, onChange };
}

describe("First Draft tabs mutations", () => {
  it("resolves stable direct-child identities and chooses the first unused default title", () => {
    const { editor } = fixture();
    const target = resolveFirstDraftTabsTarget(
      editor,
      id("fd-tabs"),
      id("fd-tab-details"),
    );
    expect(target).toMatchObject({
      paneIndex: 1,
      canonicalTitle: "Structure",
      displayedTitle: "Structure",
    });
    expect(chooseFirstDraftTabTitle(editor, target!.paneIds)).toBe("Tab 1");
    expect(
      resolveFirstDraftTabsTarget(
        editor,
        id("fd-tabs"),
        id("fd-paragraph-intro"),
      ),
    ).toBeNull();
  });

  it("appends one canonical empty pane in one transaction", () => {
    const { editor, onChange } = fixture();
    const before = editor.getChildBlockIds(id("fd-tabs"));
    const existingChildren = new Map(
      before.map((paneId) => [paneId, editor.getChildBlockIds(paneId)]),
    );
    const result = addFirstDraftTab(editor, id("fd-tabs"), () =>
      id("unique-tab-id"),
    );
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    const after = editor.getChildBlockIds(id("fd-tabs"));
    expect(after.slice(0, -1)).toEqual(before);
    expect(after.at(-1)).toBe(result.paneId);
    for (const paneId of before) {
      expect(editor.getChildBlockIds(paneId)).toEqual(
        existingChildren.get(paneId),
      );
    }
    expect(editor.getBlock(result.paneId)?.metadata).toMatchObject({
      tabId: "unique-tab-id",
      title: "Tab 1",
    });
    const contentIds = editor.getChildBlockIds(result.paneId);
    expect(contentIds).toEqual([]);
    expect(onChange).toHaveBeenCalledOnce();

    expect(editor.undo().status).toBe("applied");
    expect(editor.getChildBlockIds(id("fd-tabs"))).toEqual(before);
    expect(editor.redo().status).toBe("applied");
    expect(editor.getChildBlockIds(id("fd-tabs")).at(-1)).toBe(result.paneId);
    expect(editor.getChildBlockIds(result.paneId)).toEqual(contentIds);
  });

  it("skips existing default titles and retries a colliding tab identity", () => {
    const { editor, onChange } = fixture();
    editor.updateBlockMetadata(
      [
        {
          blockId: id("fd-tab-overview"),
          values: { title: "Tab 1" },
        },
      ],
      { selectionEffect: { kind: "preserve" } },
    );
    onChange.mockClear();
    const candidates = [id("writing"), id("new-tab-id")];
    const result = addFirstDraftTab(
      editor,
      id("fd-tabs"),
      () => candidates.shift()!,
    );
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(editor.getBlock(result.paneId)?.metadata).toMatchObject({
      tabId: "new-tab-id",
      title: "Tab 2",
    });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("reloads an empty pane and its subsequently inserted paragraph without changing identities", () => {
    const { editor } = fixture();
    const added = addFirstDraftTab(editor, id("fd-tabs"), () =>
      id("reload-tab-id"),
    );
    expect(added.kind).toBe("applied");
    if (added.kind !== "applied") return;

    const emptyReload = reload(editor.readSnapshot());
    expect(emptyReload.getChildBlockIds(added.paneId)).toEqual([]);

    expect(
      editor.insertBlockAt({
        placement: { parentId: added.paneId, childIndex: 0 },
        blockType: "paragraph",
        selection: true,
      }).ok,
    ).toBe(true);
    const paragraphId = editor.getChildBlockIds(added.paneId)[0]!;
    const contentReload = reload(editor.readSnapshot());
    expect(contentReload.getChildBlockIds(added.paneId)).toEqual([paragraphId]);
    expect(contentReload.getBlock(paragraphId)?.type).toBe("paragraph");
  });

  it("renames only title, preserves selection, and supports undo and redo", () => {
    const { editor, onChange } = fixture();
    const paneId = id("fd-tab-overview");
    const contentIds = editor.getChildBlockIds(paneId);
    const tabId = editor.getBlock(paneId)?.metadata?.tabId;
    const result = renameFirstDraftTab(editor, {
      tabsId: id("fd-tabs"),
      paneId,
      initialCanonicalTitle: "Writing",
      initialDisplayedTitle: "Writing",
      nextTitle: "  Drafting  ",
    });
    expect(result).toEqual({ kind: "applied", paneId });
    expect(editor.getBlock(paneId)?.metadata).toMatchObject({
      tabId,
      title: "Drafting",
    });
    expect(editor.getChildBlockIds(paneId)).toEqual(contentIds);
    expect(onChange).toHaveBeenCalledOnce();
    expect(editor.undo().status).toBe("applied");
    expect(editor.getBlock(paneId)?.metadata?.title).toBe("Writing");
    expect(editor.redo().status).toBe("applied");
    expect(editor.getBlock(paneId)?.metadata?.title).toBe("Drafting");
  });

  it("does not transact for normalized no-ops or overwrite a remotely changed title", () => {
    const { editor, onChange } = fixture();
    const input = {
      tabsId: id("fd-tabs"),
      paneId: id("fd-tab-overview"),
      initialCanonicalTitle: "Writing",
      initialDisplayedTitle: "Writing",
    } as const;
    expect(
      renameFirstDraftTab(editor, { ...input, nextTitle: " Writing " }).kind,
    ).toBe("disabled");
    expect(onChange).not.toHaveBeenCalled();
    editor.updateBlockMetadata(
      [{ blockId: input.paneId, values: { title: "Remote" } }],
      { selectionEffect: { kind: "preserve" } },
    );
    onChange.mockClear();
    expect(
      renameFirstDraftTab(editor, { ...input, nextTitle: "Local" }).kind,
    ).toBe("stale");
    expect(editor.getBlock(input.paneId)?.metadata?.title).toBe("Remote");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("treats a deleted rename target as stale without dispatching", () => {
    const { editor, onChange } = fixture();
    expect(editor.deleteBlock({ blockId: id("fd-tab-overview") }).ok).toBe(
      true,
    );
    onChange.mockClear();
    expect(
      renameFirstDraftTab(editor, {
        tabsId: id("fd-tabs"),
        paneId: id("fd-tab-overview"),
        initialCanonicalTitle: "Writing",
        initialDisplayedTitle: "Writing",
        nextTitle: "Local",
      }).kind,
    ).toBe("stale");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("deletes exactly the target subtree, returns the adjacent pane, and protects the last pane", () => {
    const { editor, onChange } = fixture();
    const paneId = id("fd-tab-details");
    const descendantIds = editor.getChildBlockIds(paneId);
    const result = deleteFirstDraftTab(editor, id("fd-tabs"), paneId);
    expect(result).toEqual({
      kind: "applied",
      paneId: id("fd-tab-collaboration"),
    });
    expect(editor.getBlock(paneId)).toBeNull();
    for (const descendantId of descendantIds) {
      expect(editor.getBlock(descendantId)).toBeNull();
    }
    expect(onChange).toHaveBeenCalledOnce();
    expect(editor.undo().status).toBe("applied");
    expect(editor.getChildBlockIds(id("fd-tabs"))).toContain(paneId);
    expect(editor.redo().status).toBe("applied");
    expect(editor.getBlock(paneId)).toBeNull();

    expect(
      deleteFirstDraftTab(editor, id("fd-tabs"), id("fd-tab-overview")).kind,
    ).toBe("applied");
    onChange.mockClear();
    expect(
      deleteFirstDraftTab(editor, id("fd-tabs"), id("fd-tab-collaboration"))
        .kind,
    ).toBe("disabled");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("chooses the previous pane when deleting the final pane", () => {
    const { editor } = fixture();
    expect(
      deleteFirstDraftTab(editor, id("fd-tabs"), id("fd-tab-collaboration")),
    ).toEqual({ kind: "applied", paneId: id("fd-tab-details") });
  });
});

function reload(snapshot: ReturnType<ReturnType<typeof fixture>["editor"]["readSnapshot"]>) {
  const viewState = createFirstDraftViewStateStore();
  const editor = addEditorBlockOperations(
    initializeEditableEditor({
      definition: createFirstDraftEditorDefinition(viewState),
      snapshot,
    }),
  );
  disposables.push(editor);
  return editor;
}
