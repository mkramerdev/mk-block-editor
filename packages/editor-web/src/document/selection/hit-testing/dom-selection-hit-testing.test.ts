import {
  contentSelection,
  wholeSelection,
  wrapperSelection,
} from "@repo/editor-core/selection";
import { asContentVersion, type BlockId } from "@repo/editor-core/kernel";
import type { EditorSelectionGraphReader } from "@repo/editor-react/selection";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEditorSelectionPointerHit } from "./dom-selection-hit-testing.ts";

describe("editor selection pointer hit testing", () => {
  afterEach(() => {
    document.body.replaceChildren();
    Reflect.deleteProperty(document, "caretPositionFromPoint");
    Reflect.deleteProperty(document, "caretRangeFromPoint");
    Reflect.deleteProperty(Range.prototype, "getClientRects");
    vi.restoreAllMocks();
  });

  it("clamps vertical drag overflow to the nearest live block shell", () => {
    const blockId = "last-root" as BlockId;
    const list = document.createElement("div");
    const shell = document.createElement("div");
    list.dataset.editorBlockListRoot = "true";
    Object.assign(shell.dataset, {
      editorBlockShell: "true",
      editorBlockId: blockId,
    });
    list.getBoundingClientRect = () => rectangle(0, 0, 100, 100);
    shell.getBoundingClientRect = () => rectangle(0, 60, 100, 20);
    list.append(shell);
    document.body.append(list);
    const graph: EditorSelectionGraphReader = {
      getBlock: (id) =>
        id === blockId
          ? {
              id: blockId,
              type: "divider",
              parentId: null,
              tombstone: null,
              metadataVersion: "1",
              contentVersion: null,
            }
          : null,
      getParentId: () => null,
      getRootBlockIds: () => [blockId],
      getChildBlockIds: () => [],
      readBlockSelectionModel: () => wholeSelection(),
    };

    const hit = resolveEditorSelectionPointerHit({
      list,
      target: list,
      clientX: 50,
      clientY: 108,
      graph,
    });

    expect(hit?.target.block.id).toBe(blockId);
    expect(hit?.textOffset).toBe(1);
  });

  it("uses semantic DOM mapping for an active projection", () => {
    const blockId = "active" as BlockId;
    const list = document.createElement("div");
    const shell = document.createElement("div");
    const root = document.createElement("div");
    list.dataset.editorBlockListRoot = "true";
    Object.assign(shell.dataset, {
      editorBlockShell: "true",
      editorBlockId: blockId,
    });
    root.dataset.editorTextRoot = "true";
    root.setAttribute("contenteditable", "true");
    root.innerHTML = "a<br>b";
    shell.append(root);
    list.append(shell);
    document.body.append(list);
    const graph: EditorSelectionGraphReader = {
      getBlock: (id) =>
        id === blockId
          ? {
              id: blockId,
              type: "paragraph",
              parentId: null,
              tombstone: null,
              metadataVersion: "1",
              contentVersion: asContentVersion("1"),
            }
          : null,
      getParentId: () => null,
      getRootBlockIds: () => [blockId],
      getChildBlockIds: () => [],
      readBlockSelectionModel: () => contentSelection(),
    };
    const caretRangeFromPoint = vi.fn(() => {
      const range = document.createRange();
      range.setStart(root, 2);
      range.collapse(true);
      return range;
    });
    Object.assign(document, { caretRangeFromPoint });
    const hit = resolveEditorSelectionPointerHit({
      list,
      target: root.firstChild,
      clientX: 10,
      clientY: 10,
      graph,
    });

    expect(hit?.textOffset).toBe(2);
    expect(caretRangeFromPoint).toHaveBeenCalledOnce();
  });

  it("preserves opposite affinities without creating a stable text anchor", () => {
    const blockId = "wrapped" as BlockId;
    const list = document.createElement("div");
    const shell = document.createElement("div");
    const root = document.createElement("div");
    const text = document.createTextNode("abcdef");
    list.dataset.editorBlockListRoot = "true";
    Object.assign(shell.dataset, {
      editorBlockShell: "true",
      editorBlockId: blockId,
    });
    root.dataset.editorTextRoot = "true";
    root.setAttribute("contenteditable", "true");
    root.append(text);
    shell.append(root);
    list.append(shell);
    document.body.append(list);
    list.getBoundingClientRect = () => rectangle(0, 0, 240, 260);
    shell.getBoundingClientRect = () => rectangle(0, 180, 240, 80);
    root.getBoundingClientRect = () => rectangle(90, 190, 140, 60);
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: vi.fn(function (this: Range) {
        const offset = this.startOffset;
        const row = offset < 3 ? 0 : 1;
        const column = offset % 3;
        return [
          rectangle(100 + column * 10, 200 + row * 20, 10, 18),
        ] as unknown as DOMRectList;
      }),
    });
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: text, offset: 3 }),
    });
    const graph: EditorSelectionGraphReader = {
      getBlock: (id) =>
        id === blockId
          ? {
              id: blockId,
              type: "paragraph",
              parentId: null,
              tombstone: null,
              metadataVersion: "1",
              contentVersion: asContentVersion("1"),
            }
          : null,
      getParentId: () => null,
      getRootBlockIds: () => [blockId],
      getChildBlockIds: () => [],
      readBlockSelectionModel: () => contentSelection(),
    };
    const resolve = (clientX: number, clientY: number) =>
      resolveEditorSelectionPointerHit({
        list,
        target: text,
        clientX,
        clientY,
        graph,
      });

    const backward = resolve(190, 209);
    const forward = resolve(101, 229);
    expect(backward).toEqual(
      expect.objectContaining({ textOffset: 3, affinity: "backward" }),
    );
    expect(backward?.target.block.id).toBe(blockId);
    expect(forward).toEqual(
      expect.objectContaining({ textOffset: 3, affinity: "forward" }),
    );
    expect(forward?.target.block.id).toBe(blockId);

    Reflect.deleteProperty(document, "caretPositionFromPoint");
    vi.restoreAllMocks();
  });

  it("rejects wrapper geometry as an origin but allows it during extension", () => {
    const wrapperId = "columns" as BlockId;
    const childId = "heading" as BlockId;
    const list = document.createElement("div");
    const wrapper = document.createElement("div");
    const control = document.createElement("div");
    const child = document.createElement("div");
    const text = document.createElement("div");
    list.dataset.editorBlockListRoot = "true";
    Object.assign(wrapper.dataset, {
      editorBlockShell: "true",
      editorBlockId: wrapperId,
    });
    Object.assign(child.dataset, {
      editorBlockShell: "true",
      editorBlockId: childId,
    });
    text.dataset.editorTextRoot = "true";
    text.textContent = "heading";
    child.append(text);
    wrapper.append(control, child);
    list.append(wrapper);
    document.body.append(list);
    wrapper.getBoundingClientRect = () => rectangle(0, 0, 200, 80);
    child.getBoundingClientRect = () => rectangle(0, 0, 90, 40);
    text.getBoundingClientRect = () => rectangle(0, 0, 90, 40);
    const graph: EditorSelectionGraphReader = {
      getBlock: (id) =>
        id === wrapperId || id === childId
          ? {
              id,
              type: id === wrapperId ? "columns" : "heading",
              parentId: id === childId ? wrapperId : null,
              tombstone: null,
              metadataVersion: "1",
              contentVersion: id === childId ? asContentVersion("1") : null,
            }
          : null,
      getParentId: (id) => (id === childId ? wrapperId : null),
      getRootBlockIds: () => [wrapperId],
      getChildBlockIds: (id) => (id === wrapperId ? [childId] : []),
      readBlockSelectionModel: (id) =>
        id === wrapperId ? wrapperSelection() : contentSelection(),
    };
    const originalElementFromPoint = Object.getOwnPropertyDescriptor(
      document,
      "elementFromPoint",
    );
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => text,
    });

    expect(
      resolveEditorSelectionPointerHit({
        list,
        target: control,
        clientX: 100,
        clientY: 20,
        graph,
        requireStartEligible: true,
      }),
    ).toBeNull();

    expect(
      resolveEditorSelectionPointerHit({
        list,
        target: control,
        clientX: 100,
        clientY: 20,
        graph,
      })?.target.block.id,
    ).toBe(childId);
    if (originalElementFromPoint) {
      Object.defineProperty(
        document,
        "elementFromPoint",
        originalElementFromPoint,
      );
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
  });

  it("stably resolves nested wrapper padding and sibling gaps to selectable descendants", () => {
    const containerId = "bullet-list" as BlockId;
    const itemAId = "item-a" as BlockId;
    const textAId = "item-a-text" as BlockId;
    const itemBId = "item-b" as BlockId;
    const textBId = "item-b-text" as BlockId;
    const list = document.createElement("div");
    const container = blockShell(containerId);
    const itemA = blockShell(itemAId);
    const textA = blockShell(textAId);
    const textRootA = document.createElement("div");
    const itemB = blockShell(itemBId);
    const textB = blockShell(textBId);
    const textRootB = document.createElement("div");
    list.dataset.editorBlockListRoot = "true";
    textRootA.dataset.editorTextRoot = "true";
    textRootA.textContent = "first item";
    textRootB.dataset.editorTextRoot = "true";
    textRootB.textContent = "second item";
    textA.append(textRootA);
    textB.append(textRootB);
    itemA.append(textA);
    itemB.append(textB);
    container.append(itemA, itemB);
    list.append(container);
    document.body.append(list);
    list.getBoundingClientRect = () => rectangle(0, 0, 240, 160);
    container.getBoundingClientRect = () => rectangle(0, 20, 240, 120);
    itemA.getBoundingClientRect = () => rectangle(0, 20, 240, 50);
    textA.getBoundingClientRect = () => rectangle(30, 30, 190, 25);
    textRootA.getBoundingClientRect = () => rectangle(30, 30, 190, 25);
    itemB.getBoundingClientRect = () => rectangle(0, 90, 240, 50);
    textB.getBoundingClientRect = () => rectangle(30, 100, 190, 25);
    textRootB.getBoundingClientRect = () => rectangle(30, 100, 190, 25);

    const blocks = new Map<
      BlockId,
      ReturnType<EditorSelectionGraphReader["getBlock"]>
    >([
      [containerId, versionedBlock(containerId, "bulletList", null, false)],
      [itemAId, versionedBlock(itemAId, "bulletListItem", containerId, false)],
      [textAId, versionedBlock(textAId, "paragraph", itemAId, true)],
      [itemBId, versionedBlock(itemBId, "bulletListItem", containerId, false)],
      [textBId, versionedBlock(textBId, "paragraph", itemBId, true)],
    ]);
    const graph: EditorSelectionGraphReader = {
      getBlock: (id) => blocks.get(id) ?? null,
      getParentId: (id) => blocks.get(id)?.parentId ?? null,
      getRootBlockIds: () => [containerId],
      getChildBlockIds: (id) =>
        id === containerId
          ? [itemAId, itemBId]
          : id === itemAId
            ? [textAId]
            : id === itemBId
              ? [textBId]
              : [],
      readBlockSelectionModel: (id) =>
        id === textAId || id === textBId
          ? contentSelection()
          : wrapperSelection(),
    };
    const resolve = (
      target: EventTarget,
      clientY: number,
      preferredBlockId: BlockId | null = null,
    ) =>
      resolveEditorSelectionPointerHit({
        list,
        target,
        clientX: 10,
        clientY,
        graph,
        preferredBlockId,
      });

    expect(resolve(itemA, 40)?.target.block.id).toBe(textAId);
    expect(resolve(container, 80)?.target.block.id).toBe(textAId);
    expect(resolve(itemB, 95)?.target.block.id).toBe(textBId);
    expect(resolve(textRootB, 110)?.target.block.id).toBe(textBId);
    expect(resolve(container, 80, textBId)?.target.block.id).toBe(textBId);
    expect(
      resolve(itemA, 40, null)?.target.selection.projection.selectable,
    ).toBe(true);
    expect(
      resolveEditorSelectionPointerHit({
        list,
        target: itemA,
        clientX: 10,
        clientY: 40,
        graph,
        requireStartEligible: true,
      }),
    ).toBeNull();
  });
});

function blockShell(blockId: BlockId): HTMLElement {
  const shell = document.createElement("div");
  Object.assign(shell.dataset, {
    editorBlockShell: "true",
    editorBlockId: blockId,
  });
  return shell;
}

function versionedBlock(
  id: BlockId,
  type: string,
  parentId: BlockId | null,
  hasContent: boolean,
) {
  return {
    id,
    type,
    parentId,
    tombstone: null,
    metadataVersion: "1",
    contentVersion: hasContent ? asContentVersion("1") : null,
  };
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
