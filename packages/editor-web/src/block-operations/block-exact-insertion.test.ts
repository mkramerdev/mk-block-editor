import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import type { BlockId } from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import { describe, expect, it, vi } from "vitest";
import { addEditorBlockOperations } from "./editor-extension.ts";
import { createTestEditorSnapshot } from "../tests/editor-snapshot-fixtures.ts";
import { initializeTestEditableEditor } from "../tests/test-editor-initializers.ts";
import { testEditableEditorDefinition } from "../tests/test-editor-definition.ts";

const id = (value: string) => value as BlockId;
const wrapperId = id("exact-wrapper");
const firstId = id("exact-first");
const secondId = id("exact-second");
const rootId = id("exact-root");

describe("insertBlockAt", () => {
  it("inserts and selects the first text child of an empty wrapper in one transaction", () => {
    const fixture = createEditor(nestedSnapshot([]));
    const result = fixture.editor.insertBlockAt({
      placement: { parentId: wrapperId, childIndex: 0 },
      blockType: "textBlock",
      selection: true,
    });

    expect(result).toMatchObject({ ok: true, handled: true });
    expect(fixture.onChange).toHaveBeenCalledOnce();
    const [createdId] = fixture.editor.getChildBlockIds(wrapperId);
    expect(createdId).toBeDefined();
    expect(fixture.editor.getBlock(createdId!)?.type).toBe("textBlock");
    expect(
      JSON.stringify(fixture.editor.selectionController.getCanonicalSnapshot()),
    ).toContain(createdId);

    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.editor.getChildBlockIds(wrapperId)).toEqual([]);
    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(fixture.editor.getChildBlockIds(wrapperId)).toEqual([createdId]);
    fixture.editor.dispose();
  });

  it("uses the exact beginning, middle, and end indexes", () => {
    for (const childIndex of [0, 1, 2]) {
      const fixture = createEditor(nestedSnapshot([firstId, secondId]));
      expect(
        fixture.editor.insertBlockAt({
          placement: { parentId: wrapperId, childIndex },
          blockType: "textBlock",
        }),
      ).toMatchObject({ ok: true });
      const children = fixture.editor.getChildBlockIds(wrapperId);
      const created = children.find(
        (candidate) => candidate !== firstId && candidate !== secondId,
      );
      expect(created).toBeDefined();
      const expected = [firstId, secondId];
      expected.splice(childIndex, 0, created!);
      expect(children).toEqual(expected);
      fixture.editor.dispose();
    }
  });

  it("supports an exact root placement without adjacent fallback", () => {
    const fixture = createEditor(
      createTestEditorSnapshot([{ id: rootId, type: "textBlock", text: "root" }]),
    );
    expect(
      fixture.editor.insertBlockAt({
        placement: { parentId: null, childIndex: 0 },
        blockType: "atomicBlock",
      }),
    ).toMatchObject({ ok: true });
    expect(fixture.editor.getRootBlockIds()[1]).toBe(rootId);
    expect(fixture.editor.getBlock(fixture.editor.getRootBlockIds()[0]!)?.type).toBe(
      "atomicBlock",
    );
    fixture.editor.dispose();
  });

  it("rejects invalid, stale, non-wrapper, and unacceptable placements without publication", () => {
    const fixture = createEditor(nestedSnapshot([firstId]));
    const before = fixture.editor.readSnapshot();
    const invalid = [
      { placement: { parentId: id("missing"), childIndex: 0 }, blockType: "textBlock" },
      { placement: { parentId: firstId, childIndex: 0 }, blockType: "textBlock" },
      { placement: { parentId: wrapperId, childIndex: -1 }, blockType: "textBlock" },
      { placement: { parentId: wrapperId, childIndex: 0.5 }, blockType: "textBlock" },
      { placement: { parentId: wrapperId, childIndex: 2 }, blockType: "textBlock" },
      { placement: { parentId: wrapperId, childIndex: 0 }, blockType: "parentRestrictedTextBlock" },
    ] as const;
    for (const insertion of invalid) {
      expect(fixture.editor.insertBlockAt(insertion)).toMatchObject({
        ok: false,
        reason: "invalid-input",
      });
    }
    expect(fixture.editor.readSnapshot()).toEqual(before);
    expect(fixture.onChange).not.toHaveBeenCalled();
    fixture.editor.dispose();
  });

  it("rejects a parent sequence that does not accept the proposed type", () => {
    const restrictedId = id("exact-restricted-wrapper");
    const snapshot = createTestEditorSnapshot([
      { id: restrictedId, type: "textBlockOnlyContainer" },
    ]);
    const fixture = createEditor(snapshot);
    expect(
      fixture.editor.insertBlockAt({
        placement: { parentId: restrictedId, childIndex: 0 },
        blockType: "atomicBlock",
      }),
    ).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(fixture.onChange).not.toHaveBeenCalled();
    fixture.editor.dispose();
  });

  it("rejects generated-id collisions before a transaction", () => {
    const fixture = createEditor(nestedSnapshot([]));
    expect(
      fixture.editor.insertBlockAt({
        placement: { parentId: wrapperId, childIndex: 0 },
        blockType: "textBlock",
        createBlockId: () => wrapperId,
      }),
    ).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(fixture.editor.getChildBlockIds(wrapperId)).toEqual([]);
    expect(fixture.onChange).not.toHaveBeenCalled();
    fixture.editor.dispose();
  });

  it("reports a rejected transaction without partial mutation or publication", () => {
    const fixture = createEditor(nestedSnapshot([]));
    vi.spyOn(fixture.editor, "transaction").mockReturnValue({
      ok: false,
      phase: "commit",
      message: "document changed before commit",
    });
    expect(
      fixture.editor.insertBlockAt({
        placement: { parentId: wrapperId, childIndex: 0 },
        blockType: "textBlock",
      }),
    ).toMatchObject({ ok: false, reason: "transaction-rejected" });
    expect(fixture.editor.getChildBlockIds(wrapperId)).toEqual([]);
    expect(fixture.onChange).not.toHaveBeenCalled();
    fixture.editor.dispose();
  });

  it("supports preserve and clear selection effects", () => {
    const preserved = createEditor(nestedSnapshot([]));
    expect(
      preserved.editor.insertBlockAt({
        placement: { parentId: wrapperId, childIndex: 0 },
        blockType: "textBlock",
        createBlockId: () => firstId,
        selection: true,
      }).ok,
    ).toBe(true);
    const before = preserved.editor.selectionController.getCanonicalSnapshot();
    preserved.onChange.mockClear();
    expect(
      preserved.editor.insertBlockAt({
        placement: { parentId: wrapperId, childIndex: 1 },
        blockType: "textBlock",
        selection: false,
      }).ok,
    ).toBe(true);
    expect(
      JSON.stringify(preserved.editor.selectionController.getCanonicalSnapshot()),
    ).toContain(firstId);
    expect(before).not.toBeNull();
    expect(preserved.onChange).toHaveBeenCalledOnce();
    preserved.editor.dispose();

    const cleared = createEditor(nestedSnapshot([]));
    expect(
      cleared.editor.insertBlockAt({
        placement: { parentId: wrapperId, childIndex: 0 },
        blockType: "textBlock",
        createBlockId: () => firstId,
        selection: true,
      }).ok,
    ).toBe(true);
    expect(
      cleared.editor.insertBlockAt({
        placement: { parentId: wrapperId, childIndex: 1 },
        blockType: "textBlock",
        selection: { kind: "clear" },
      }).ok,
    ).toBe(true);
    expect(cleared.editor.selectionController.getCanonicalSnapshot()).toMatchObject({
      kind: "none",
    });
    cleared.editor.dispose();
  });

  it("keeps independently enriched editor instances isolated", () => {
    const left = createEditor(nestedSnapshot([]));
    const right = createEditor(nestedSnapshot([]));
    expect(
      left.editor.insertBlockAt({
        placement: { parentId: wrapperId, childIndex: 0 },
        blockType: "textBlock",
      }).ok,
    ).toBe(true);
    expect(left.editor.getChildBlockIds(wrapperId)).toHaveLength(1);
    expect(right.editor.getChildBlockIds(wrapperId)).toEqual([]);
    expect(left.onChange).toHaveBeenCalledOnce();
    expect(right.onChange).not.toHaveBeenCalled();
    left.editor.dispose();
    right.editor.dispose();
  });
});

function nestedSnapshot(children: readonly BlockId[]): EditorInstanceSnapshot {
  const snapshot = createTestEditorSnapshot([
    { id: wrapperId, type: "emptyContainerWrapper" },
    ...children.map((blockId) => ({ id: blockId, type: "textBlock", text: blockId })),
  ]);
  return {
    ...snapshot,
    blocks: {
      ...snapshot.blocks,
      [wrapperId]: createBlockRecord({ id: wrapperId, type: "emptyContainerWrapper" }),
      ...Object.fromEntries(
        children.map((blockId) => [
          blockId,
          createBlockRecord({ id: blockId, type: "textBlock", parentId: wrapperId }),
        ]),
      ),
    },
    rootBlockIds: [wrapperId],
    childIdsByParentId: { [wrapperId]: children },
  };
}

function createEditor(snapshot: EditorInstanceSnapshot) {
  const onChange = vi.fn();
  const editor = addEditorBlockOperations(
    initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot,
      onChange,
    }),
  );
  return { editor, onChange };
}
