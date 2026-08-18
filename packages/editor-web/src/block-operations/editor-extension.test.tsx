import { renderHook } from "@testing-library/react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import { createBlockRecord } from "@repo/editor-core/metadata";
import { useTestEditor as useEditor } from "../tests/test-editor-initializers.ts";
import type { Editor } from "../runtime/document/contracts.ts";
import type { EditableEditorDefinition } from "../runtime/document/contracts.ts";
import {
  addEditorBlockOperations,
  type EditorBlockOperations,
  type EditorWithBlockOperations,
} from "./editor-extension.ts";
import { createTestEditorSnapshot } from "../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../tests/test-editor-definition.ts";
import { initializeTestEditableEditor } from "../tests/test-editor-initializers.ts";

const firstId = "01890f07-1c00-7000-8000-000000008001" as BlockId;
const secondId = "01890f07-1c00-7000-8000-000000008002" as BlockId;

function createEditor(onChange?: (transaction: unknown) => void) {
  return initializeTestEditableEditor({
    definition: testEditableEditorDefinition,
    snapshot: createTestEditorSnapshot([
      { id: firstId, type: "paragraph", text: "first" },
      { id: secondId, type: "paragraph", text: "second" },
    ]),
    onChange,
  });
}

function extend(editor: Editor): EditorWithBlockOperations {
  return addEditorBlockOperations(editor);
}

describe("block-operation editor extension", () => {
  it("returns and enriches the exact editor object with stable non-enumerable methods", () => {
    const editor = createEditor();
    const enumerableBefore = Object.keys(editor);
    const extended = extend(editor);

    expect(extended).toBe(editor);
    expect(Object.keys(extended)).toEqual(enumerableBefore);
    for (const methodName of [
      "insertBlock",
      "replaceBlock",
      "deleteBlock",
      "duplicateBlock",
      "moveBlock",
      "indentBlock",
      "outdentBlock",
    ] satisfies readonly (keyof EditorBlockOperations)[]) {
      const method = extended[methodName];
      expect(typeof method).toBe("function");
      expect(extended[methodName]).toBe(method);
      expect(
        Object.getOwnPropertyDescriptor(extended, methodName),
      ).toMatchObject({
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
    editor.dispose();
  });

  it("rejects every collision before installing any method", () => {
    const editor = createEditor();
    Object.defineProperty(editor, "insertBlock", {
      value: vi.fn(),
      configurable: true,
    });

    expect(() => extend(editor)).toThrow(/insertBlock already exists/u);
    expect(Object.prototype.hasOwnProperty.call(editor, "replaceBlock")).toBe(
      false,
    );
    editor.dispose();
  });

  it("retains base and enriched compile-time surfaces", () => {
    const plainEditor = createEditor();
    const blockEditor = extend(createEditor());
    expectTypeOf(plainEditor).toMatchTypeOf<Editor>();
    expectTypeOf(plainEditor).not.toHaveProperty("insertBlock");
    expectTypeOf(plainEditor).not.toHaveProperty("moveBlock");
    expectTypeOf(blockEditor).toMatchTypeOf<EditorWithBlockOperations>();
    expectTypeOf(blockEditor).toHaveProperty("insertBlock");
    expectTypeOf(blockEditor).toHaveProperty("replaceBlock");
    expectTypeOf(blockEditor).toHaveProperty("deleteBlock");
    expectTypeOf(blockEditor).toHaveProperty("duplicateBlock");
    expectTypeOf(blockEditor).toHaveProperty("moveBlock");
    expectTypeOf(blockEditor).toHaveProperty("indentBlock");
    expectTypeOf(blockEditor).toHaveProperty("outdentBlock");
    plainEditor.dispose();
    blockEditor.dispose();
  });

  it("infers plain and explicitly enriched editor return types", () => {
    const snapshot = createTestEditorSnapshot([
      { id: firstId, type: "paragraph", text: "first" },
    ]);
    const plain = renderHook(() =>
      useEditor({
        definition: testEditableEditorDefinition,
        snapshot,
      }),
    );
    const enriched = renderHook(() => {
      const editor = useEditor({
        definition: testEditableEditorDefinition,
        snapshot,
      });
      return addEditorBlockOperations(editor);
    });

    expectTypeOf(plain.result.current).not.toHaveProperty("insertBlock");
    expectTypeOf(enriched.result.current).toHaveProperty("insertBlock");
    expectTypeOf(enriched.result.current).toHaveProperty("moveBlock");
    plain.result.current.dispose();
    enriched.result.current.dispose();
    plain.unmount();
    enriched.unmount();
  });

  it("is idempotent and retains the enriched identity across rerenders", () => {
    const hook = renderHook(() => {
      const editor = useEditor({
        definition: testEditableEditorDefinition,
        snapshot: createTestEditorSnapshot([
          { id: firstId, type: "paragraph", text: "first" },
        ]),
      });
      return addEditorBlockOperations(addEditorBlockOperations(editor));
    });
    const editor = hook.result.current;

    hook.rerender();

    expect(hook.result.current).toBe(editor);
    hook.unmount();
    editor.dispose();
  });

  it("returns the same object when enrichment is repeated directly", () => {
    const editor = createEditor();
    const first = addEditorBlockOperations(editor);
    const descriptor = Object.getOwnPropertyDescriptor(first, "insertBlock");
    const second = addEditorBlockOperations(editor);

    expect(second).toBe(first);
    expect(Object.getOwnPropertyDescriptor(second, "insertBlock")).toEqual(
      descriptor,
    );
    editor.dispose();
  });

  it("commits insert, replace, delete, duplicate, and move once each", () => {
    const published = vi.fn();
    const editor = extend(createEditor(published));

    const inserted = editor.insertBlock({
      blockId: firstId,
      blockType: "divider",
    });
    expect(inserted).toMatchObject({ ok: true, handled: true });
    expect(published).toHaveBeenCalledTimes(1);
    const dividerId = editor.getRootBlockIds()[1]!;

    const replaced = editor.replaceBlock({
      blockId: dividerId,
      blockType: "paragraph",
    });
    expect(replaced).toMatchObject({ ok: true, handled: true });
    expect(published).toHaveBeenCalledTimes(2);
    const replacementId = editor.getRootBlockIds()[1]!;

    const duplicated = editor.duplicateBlock({ blockId: firstId });
    expect(duplicated).toMatchObject({ ok: true, handled: true });
    expect(published).toHaveBeenCalledTimes(3);
    const duplicateId = editor.getRootBlockIds()[1]!;
    expect(editor.readBlockContent(duplicateId, "paragraph")).toEqual(
      editor.readBlockContent(firstId, "paragraph"),
    );

    const moved = editor.moveBlock({
      blockId: duplicateId,
      destination: { parentId: null, childIndex: 0 },
    });
    expect(moved).toMatchObject({ ok: true, handled: true });
    expect(editor.getRootBlockIds()[0]).toBe(duplicateId);
    expect(published).toHaveBeenCalledTimes(4);

    const deleted = editor.deleteBlock({ blockId: replacementId });
    expect(deleted).toMatchObject({ ok: true, handled: true });
    expect(editor.getBlock(replacementId)).toBeNull();
    expect(published).toHaveBeenCalledTimes(5);
    editor.dispose();
  });

  it("indents and outdents the existing subtree through canonical movement", () => {
    const editor = extend(createEditor());
    const inserted = editor.insertBlock({
      blockId: firstId,
      blockType: "callout",
    });
    expect(inserted.ok).toBe(true);
    const calloutId = editor.getRootBlockIds()[1]!;
    const originalSecond = editor.getBlock(secondId);

    const indented = editor.indentBlock({ blockId: secondId, offset: 2 });
    expect(indented).toMatchObject({ ok: true, handled: true });
    expect(editor.getParentId(secondId)).toBe(calloutId);
    expect(editor.getBlock(secondId)?.id).toBe(originalSecond?.id);

    const outdented = editor.outdentBlock({ blockId: secondId, offset: 2 });
    expect(outdented).toMatchObject({ ok: true, handled: true });
    expect(editor.getParentId(secondId)).toBeNull();
    expect(editor.getBlock(secondId)?.id).toBe(originalSecond?.id);
    editor.dispose();
  });

  it("publishes nothing for invalid and no-change operations", () => {
    const published = vi.fn();
    const editor = extend(createEditor(published));

    expect(
      editor.deleteBlock({
        blockId: "01890f07-1c00-7000-8000-000000008099" as BlockId,
      }),
    ).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(
      editor.moveBlock({
        blockId: firstId,
        destination: { parentId: null, childIndex: 0 },
      }),
    ).toMatchObject({ ok: false, reason: "no-change" });
    expect(published).not.toHaveBeenCalled();
    expect(editor.canUndo).toBe(false);
    editor.dispose();
  });

  it("does not retain caller-owned mutable metadata", () => {
    const editor = extend(createEditor());
    const metadata = { nested: { label: "accepted" } };
    const inserted = editor.insertBlock({
      blockId: firstId,
      blockType: "divider",
      metadata,
    });
    expect(inserted.ok).toBe(true);
    const insertedId = editor.getRootBlockIds()[1]!;

    metadata.nested.label = "mutated";

    expect(editor.getBlock(insertedId)?.metadata).toEqual({
      nested: { label: "accepted" },
    });
    editor.dispose();
  });

  it("supports undo and redo of one accepted operation", () => {
    const editor = extend(createEditor());
    const inserted = editor.insertBlock({
      blockId: firstId,
      blockType: "divider",
      selection: true,
    });
    expect(inserted.ok).toBe(true);
    const insertedId = editor.getRootBlockIds()[1]!;

    expect(editor.undo()).toMatchObject({ status: "applied" });
    expect(editor.getBlock(insertedId)).toBeNull();
    expect(editor.redo()).toMatchObject({ status: "applied" });
    expect(editor.getBlock(insertedId)?.type).toBe("divider");
    editor.dispose();
  });

  it("applies target-owned metadata defaults during whole-list conversion", () => {
    const listId = "01890f07-1c00-7000-8000-000000008010" as BlockId;
    const itemId = "01890f07-1c00-7000-8000-000000008011" as BlockId;
    const textId = "01890f07-1c00-7000-8000-000000008012" as BlockId;
    const renderer = testEditableEditorDefinition.blocks.paragraph!.renderer;
    const definition: EditableEditorDefinition = {
      ...testEditableEditorDefinition,
      blocks: {
        paragraph: {
          ...testEditableEditorDefinition.blocks.paragraph!,
          split: {
            default: "paragraph",
            sourceItem: "sourceItem",
            targetItem: "targetItem",
          },
        },
        sourceList: {
          kind: "wrapper",
          type: "sourceList",
          rootLayout: "normal",
          renderer,
          content: { required: ["sourceItem"], additional: "sourceItem" },
          contentBoundary: false,
          defaultContent: "sourceItem",
          list: { kind: "container", itemType: "sourceItem" },
        },
        sourceItem: {
          kind: "wrapper",
          type: "sourceItem",
          rootLayout: "normal",
          renderer,
          content: { required: ["paragraph"], additional: "block" },
          contentBoundary: false,
          parents: { allowed: ["sourceList"] },
          conversion: { metadata: "target-defaults" },
          list: {
            kind: "item",
            containerType: "sourceList",
            primaryTextChildType: "paragraph",
            emptyEnter: "lift-primary-out-of-container",
          },
        },
        targetList: {
          kind: "wrapper",
          type: "targetList",
          rootLayout: "normal",
          renderer,
          content: { required: ["targetItem"], additional: "targetItem" },
          contentBoundary: false,
          defaultContent: "targetItem",
          list: { kind: "container", itemType: "targetItem" },
        },
        targetItem: {
          kind: "wrapper",
          type: "targetItem",
          rootLayout: "normal",
          renderer,
          content: { required: ["paragraph"], additional: "block" },
          contentBoundary: false,
          parents: { allowed: ["targetList"] },
          defaultMetadata: { state: false },
          conversion: { metadata: "target-defaults" },
          list: {
            kind: "item",
            containerType: "targetList",
            primaryTextChildType: "paragraph",
            emptyEnter: "lift-primary-out-of-container",
          },
        },
      },
    };
    const textSnapshot = createTestEditorSnapshot([
      { id: textId, type: "paragraph", text: "Task" },
    ]);
    const snapshot: EditorInstanceSnapshot = {
      blockGraphVersion: 1,
      blocks: {
        [listId]: createBlockRecord({ id: listId, type: "sourceList" }),
        [itemId]: createBlockRecord({
          id: itemId,
          type: "sourceItem",
          parentId: listId,
          metadata: { legacy: "remove", state: true },
        }),
        [textId]: createBlockRecord({
          id: textId,
          type: "paragraph",
          parentId: itemId,
        }),
      },
      rootBlockIds: [listId],
      childIdsByParentId: { [listId]: [itemId], [itemId]: [textId] },
      content: {
        [textId]: createBlockRichTextContentFromPlainText("paragraph", "Task"),
      },
      opaqueContentCheckpoints: textSnapshot.opaqueContentCheckpoints,
    };
    const editor = addEditorBlockOperations(
      initializeTestEditableEditor({ definition, snapshot }),
    );

    expect(
      editor.replaceBlock({ blockId: itemId, blockType: "targetItem" }),
    ).toMatchObject({ ok: true });
    expect(editor.getBlock(listId)).toMatchObject({ id: listId, type: "targetList" });
    expect(editor.getBlock(itemId)).toMatchObject({
      id: itemId,
      type: "targetItem",
      metadata: { state: false },
    });
    expect(editor.getBlock(textId)?.parentId).toBe(itemId);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.getBlock(itemId)).toMatchObject({
      type: "sourceItem",
      metadata: { legacy: "remove", state: true },
    });
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(editor.getBlock(itemId)?.metadata).toEqual({ state: false });

    expect(
      editor.replaceBlock({ blockId: itemId, blockType: "sourceItem" }),
    ).toMatchObject({ ok: true });
    expect(editor.getBlock(itemId)?.metadata).toBeUndefined();
    editor.dispose();
  });

  it("restores every enriched operation from stored transaction plans", () => {
    const insertionEditor = extend(createEditor());
    const inserted = insertionEditor.insertBlock({
      blockId: firstId,
      blockType: "divider",
      selection: true,
    });
    expect(inserted.ok).toBe(true);
    const insertedId = insertionEditor.getRootBlockIds()[1]!;
    expect(insertionEditor.undo()).toEqual({ status: "applied" });
    expect(insertionEditor.getBlock(insertedId)).toBeNull();
    expect(insertionEditor.redo()).toEqual({ status: "applied" });
    expect(insertionEditor.getBlock(insertedId)?.type).toBe("divider");
    insertionEditor.dispose();

    const replacementEditor = extend(createEditor());
    const replaced = replacementEditor.replaceBlock({
      blockId: firstId,
      blockType: "heading",
    });
    expect(replaced.ok).toBe(true);
    const replacementId = replacementEditor.getRootBlockIds()[0]!;
    expect(replacementEditor.getBlock(replacementId)?.type).toBe("heading");
    expect(replacementEditor.undo()).toEqual({ status: "applied" });
    expect(replacementEditor.getBlock(firstId)?.type).toBe("paragraph");
    expect(replacementEditor.redo()).toEqual({ status: "applied" });
    expect(replacementEditor.getBlock(replacementId)?.type).toBe("heading");
    replacementEditor.dispose();

    const deletionEditor = extend(createEditor());
    const deleted = deletionEditor.deleteBlock({ blockId: firstId });
    expect(deleted.ok).toBe(true);
    expect(deletionEditor.getBlock(firstId)).toBeNull();
    expect(deletionEditor.undo()).toEqual({ status: "applied" });
    expect(deletionEditor.getBlock(firstId)?.type).toBe("paragraph");
    expect(deletionEditor.redo()).toEqual({ status: "applied" });
    expect(deletionEditor.getBlock(firstId)).toBeNull();
    deletionEditor.dispose();

    const duplicationEditor = extend(createEditor());
    const duplicated = duplicationEditor.duplicateBlock({ blockId: firstId });
    expect(duplicated.ok).toBe(true);
    const duplicateId = duplicationEditor.getRootBlockIds()[1]!;
    expect(duplicateId).not.toBe(firstId);
    expect(duplicationEditor.undo()).toEqual({ status: "applied" });
    expect(duplicationEditor.getBlock(duplicateId)).toBeNull();
    expect(duplicationEditor.redo()).toEqual({ status: "applied" });
    expect(duplicationEditor.getBlock(duplicateId)?.id).toBe(duplicateId);
    duplicationEditor.dispose();

    const movementEditor = extend(createEditor());
    const moved = movementEditor.moveBlock({
      blockId: secondId,
      destination: { parentId: null, childIndex: 0 },
    });
    expect(moved.ok).toBe(true);
    expect(movementEditor.getRootBlockIds()).toEqual([secondId, firstId]);
    expect(movementEditor.undo()).toEqual({ status: "applied" });
    expect(movementEditor.getRootBlockIds()).toEqual([firstId, secondId]);
    expect(movementEditor.redo()).toEqual({ status: "applied" });
    expect(movementEditor.getRootBlockIds()).toEqual([secondId, firstId]);
    movementEditor.dispose();

    const indentationEditor = extend(createEditor());
    expect(
      indentationEditor.insertBlock({
        blockId: firstId,
        blockType: "callout",
      }).ok,
    ).toBe(true);
    const calloutId = indentationEditor.getRootBlockIds()[1]!;
    expect(
      indentationEditor.indentBlock({ blockId: secondId, offset: 1 }).ok,
    ).toBe(true);
    expect(indentationEditor.getParentId(secondId)).toBe(calloutId);
    expect(indentationEditor.undo()).toEqual({ status: "applied" });
    expect(indentationEditor.getParentId(secondId)).toBeNull();
    expect(indentationEditor.redo()).toEqual({ status: "applied" });
    expect(indentationEditor.getParentId(secondId)).toBe(calloutId);
    expect(
      indentationEditor.outdentBlock({ blockId: secondId, offset: 1 }).ok,
    ).toBe(true);
    expect(indentationEditor.getParentId(secondId)).toBeNull();
    expect(indentationEditor.undo()).toEqual({ status: "applied" });
    expect(indentationEditor.getParentId(secondId)).toBe(calloutId);
    expect(indentationEditor.redo()).toEqual({ status: "applied" });
    expect(indentationEditor.getParentId(secondId)).toBeNull();
    indentationEditor.dispose();
  });
});

function assertEditorTypes(
  plainEditor: Editor,
  blockEditor: EditorWithBlockOperations,
): void {
  // @ts-expect-error Optional block methods are absent from the base editor.
  plainEditor.insertBlock({ blockId: firstId, blockType: "paragraph" });
  blockEditor.insertBlock({
    blockId: firstId,
    blockType: "paragraph",
  });
  blockEditor.moveBlock({
    blockId: firstId,
    destination: { parentId: null, childIndex: 1 },
  });
}

void assertEditorTypes;
