import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import type { BlockId } from "@repo/editor-core/kernel";
import { validateStructuralDocument } from "@repo/editor-core/editing";
import { createBlockRecord } from "@repo/editor-core/metadata";
import { describe, expect, it, vi } from "vitest";
import { addEditorBlockOperations } from "./editor-extension.ts";
import { createTestEditorSnapshot } from "../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../tests/test-editor-definition.ts";
import { initializeTestEditableEditor } from "../tests/test-editor-initializers.ts";

const id = (value: string) => value as BlockId;
const first = id("position-first");
const second = id("position-second");
const third = id("position-third");
const fourth = id("position-fourth");
const sourceWrapper = id("position-source-wrapper");
const sourceChild = id("position-source-child");
const sourceRemainder = id("position-source-remainder");
const destinationWrapper = id("position-destination-wrapper");
const destinationChild = id("position-destination-child");

describe("moveBlockToPosition", () => {
  it("moves upward and downward using pre-move canonical indexes", () => {
    const upward = createRootEditor();
    expect(
      upward.editor.moveBlockToPosition({
        blockId: third,
        position: { parentId: null, childIndex: 0 },
      }),
    ).toMatchObject({ ok: true, handled: true });
    expect(upward.editor.getRootBlockIds()).toEqual([
      third,
      first,
      second,
      fourth,
    ]);
    expect(upward.onChange).toHaveBeenCalledOnce();
    expectCanonicalValidity(upward.editor.readSnapshot());
    upward.editor.dispose();

    const downward = createRootEditor();
    expect(
      downward.editor.moveBlockToPosition({
        blockId: second,
        position: { parentId: null, childIndex: 4 },
      }),
    ).toMatchObject({ ok: true, handled: true });
    expect(downward.editor.getRootBlockIds()).toEqual([
      first,
      third,
      fourth,
      second,
    ]);
    expect(downward.onChange).toHaveBeenCalledOnce();
    expectCanonicalValidity(downward.editor.readSnapshot());
    downward.editor.dispose();
  });

  it("adjusts same-parent destinations and treats both current boundaries as no-ops", () => {
    const fixture = createRootEditor();
    expect(
      fixture.editor.moveBlockToPosition({
        blockId: first,
        position: { parentId: null, childIndex: 3 },
      }),
    ).toMatchObject({ ok: true });
    expect(fixture.editor.getRootBlockIds()).toEqual([
      second,
      third,
      first,
      fourth,
    ]);

    const calls = fixture.onChange.mock.calls.length;
    for (const childIndex of [2, 3]) {
      expect(
        fixture.editor.moveBlockToPosition({
          blockId: first,
          position: { parentId: null, childIndex },
        }),
      ).toMatchObject({ ok: false, reason: "no-change" });
    }
    expect(fixture.onChange).toHaveBeenCalledTimes(calls);
    expectCanonicalValidity(fixture.editor.readSnapshot());
    fixture.editor.dispose();
  });

  it("moves between accepting wrappers in one transaction", () => {
    const fixture = createNestedEditor();
    expect(
      fixture.editor.moveBlockToPosition({
        blockId: sourceChild,
        position: { parentId: destinationWrapper, childIndex: 1 },
      }),
    ).toMatchObject({ ok: true, handled: true });
    expect(fixture.editor.getChildBlockIds(sourceWrapper)).toEqual([
      sourceRemainder,
    ]);
    expect(fixture.editor.getChildBlockIds(destinationWrapper)).toEqual([
      destinationChild,
      sourceChild,
    ]);
    expect(fixture.editor.getParentId(sourceChild)).toBe(destinationWrapper);
    expect(fixture.onChange).toHaveBeenCalledOnce();
    expectCanonicalValidity(fixture.editor.readSnapshot());
    fixture.editor.dispose();
  });

  it("rejects invalid parents and own descendants without partial mutation", () => {
    const fixture = createNestedEditor();
    const before = fixture.editor.readSnapshot();

    expect(
      fixture.editor.moveBlockToPosition({
        blockId: sourceChild,
        position: { parentId: first, childIndex: 0 },
      }),
    ).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(
      fixture.editor.moveBlockToPosition({
        blockId: sourceWrapper,
        position: { parentId: sourceChild, childIndex: 0 },
      }),
    ).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(fixture.editor.readSnapshot()).toEqual(before);
    expect(fixture.onChange).not.toHaveBeenCalled();
    expectCanonicalValidity(fixture.editor.readSnapshot());
    fixture.editor.dispose();
  });
});

function createRootEditor() {
  return createEditor(
    createTestEditorSnapshot(
      [first, second, third, fourth].map((blockId) => ({
        id: blockId,
        type: "textBlock",
        text: blockId,
      })),
    ),
  );
}

function createNestedEditor() {
  const snapshot = createTestEditorSnapshot([
    { id: first, type: "textBlock", text: "root" },
    { id: sourceWrapper, type: "containerWrapper" },
    { id: sourceChild, type: "textBlock", text: "move" },
    { id: sourceRemainder, type: "textBlock", text: "remain" },
    { id: destinationWrapper, type: "containerWrapper" },
    { id: destinationChild, type: "textBlock", text: "destination" },
  ]);
  return createEditor({
    ...snapshot,
    blocks: {
      ...snapshot.blocks,
      [sourceWrapper]: createBlockRecord({
        id: sourceWrapper,
        type: "containerWrapper",
      }),
      [sourceChild]: createBlockRecord({
        id: sourceChild,
        type: "textBlock",
        parentId: sourceWrapper,
      }),
      [sourceRemainder]: createBlockRecord({
        id: sourceRemainder,
        type: "textBlock",
        parentId: sourceWrapper,
      }),
      [destinationWrapper]: createBlockRecord({
        id: destinationWrapper,
        type: "containerWrapper",
      }),
      [destinationChild]: createBlockRecord({
        id: destinationChild,
        type: "textBlock",
        parentId: destinationWrapper,
      }),
    },
    rootBlockIds: [first, sourceWrapper, destinationWrapper],
    childIdsByParentId: {
      [sourceWrapper]: [sourceChild, sourceRemainder],
      [destinationWrapper]: [destinationChild],
    },
  });
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

function expectCanonicalValidity(snapshot: EditorInstanceSnapshot): void {
  expect(
    validateStructuralDocument({
      ...snapshot,
      blockDefinitions: testEditableEditorDefinition.blocks,
    }),
  ).toEqual({ valid: true, issues: [] });
}
