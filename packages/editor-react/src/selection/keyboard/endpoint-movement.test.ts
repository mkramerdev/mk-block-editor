import { describe, expect, it, vi } from "vitest";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  contentSelection,
  wholeSelection,
  type BlockSelectionModel,
} from "@repo/editor-core/selection";
import type { EditorSelectionGraphReader } from "../graph/reader.ts";
import type { EditorLogicalSelectionPoint } from "../model/types.ts";
import { moveEditorKeyboardSelectionEndpoint } from "./endpoint-movement.ts";

const id = (value: string) => value as BlockId;
const anchor = {
  kind: "block-relative-text" as const,
  codec: "test",
  version: 1 as const,
  payload: { encoded: "AQ==" },
};

describe("keyboard endpoint movement", () => {
  it("moves exactly one visual row and retains the geometry preferred X", () => {
    const fixture = createFixture([{ id: "a", text: "wrapped text" }]);
    const result = fixture.move("ArrowDown", "a", 2, {
      moveVisualLine: () => ({ kind: "moved", textOffset: 7, preferredX: 48 }),
    });

    expect(result).toMatchObject({ ok: true, preferredX: 48 });
    expect(result.ok && result.point).toMatchObject({
      blockId: id("a"),
      textOffset: 7,
    });
  });

  it.each([
    ["ArrowDown" as const, "a", 3, "b", "first" as const, 4],
    ["ArrowUp" as const, "b", 4, "a", "last" as const, 2],
  ])(
    "maps %s boundaries to the adjacent directional row",
    (key, from, offset, to, line, expectedOffset) => {
      const fixture = createFixture([
        { id: "a", text: "alpha" },
        { id: "b", text: "bravo" },
      ]);
      const mapToVisualLine = vi.fn(() => ({
        kind: "mapped" as const,
        textOffset: expectedOffset,
      }));
      const result = fixture.move(key, from, offset, {
        moveVisualLine: () => ({ kind: "boundary", preferredX: 61 }),
        mapToVisualLine,
      });

      expect(result.ok && result.point).toMatchObject({
        blockId: id(to),
        textOffset: expectedOffset,
      });
      expect(result).toMatchObject({ ok: true, preferredX: 61 });
      expect(mapToVisualLine).toHaveBeenCalledWith(
        expect.objectContaining({ line, preferredX: 61 }),
      );
    },
  );

  it.each([
    ["ArrowDown" as const, "a", "b"],
    ["ArrowUp" as const, "b", "a"],
  ])(
    "reports unavailable geometry for an unmounted adjacent text block on %s without committing an edge",
    (key, from, to) => {
      const fixture = createFixture([
        { id: "a", text: "alpha" },
        { id: "b", text: "bravo" },
      ]);
      const result = fixture.move(key, from, 2, {
        moveVisualLine: () => ({ kind: "boundary", preferredX: 30 }),
        mapToVisualLine: () => ({ kind: "unavailable", reason: "unmounted" }),
      });

      expect(result).toEqual({
        ok: false,
        reason: "geometry-unavailable",
        blockId: id(to),
        message: "unmounted",
        preferredX: 30,
      });
    },
  );

  it.each([
    ["ArrowDown" as const, ["a", "empty"] as const],
    ["ArrowUp" as const, ["empty", "a"] as const],
  ])(
    "enters an empty adjacent text block at its canonical offset zero for %s",
    (key, order) => {
      const fixture = createFixture(
        order.map((blockId) => ({
          id: blockId,
          text: blockId === "empty" ? "" : "alpha",
        })),
      );
      const mapToVisualLine = vi.fn();
      const result = fixture.move(key, "a", 2, {
        moveVisualLine: () => ({ kind: "boundary", preferredX: 75 }),
        mapToVisualLine,
      });

      expect(result.ok && result.point).toMatchObject({
        blockId: id("empty"),
        textOffset: 0,
      });
      expect(result).toMatchObject({ ok: true, preferredX: 75 });
      expect(mapToVisualLine).not.toHaveBeenCalled();
    },
  );

  it.each(["ArrowDown", "ArrowUp"] as const)(
    "preserves preferred X when %s cannot measure an unmounted target",
    (key) => {
      const fixture = createFixture([
        { id: "a", text: "alpha" },
        { id: "b", text: "bravo" },
      ]);
      const result = fixture.move(key, key === "ArrowDown" ? "a" : "b", 2, {
        preferredX: 47,
        moveVisualLine: () => ({ kind: "boundary", preferredX: 83 }),
        mapToVisualLine: () => ({
          kind: "unavailable",
          reason: "text-root-unmounted",
        }),
      });

      expect(result).toMatchObject({
        ok: false,
        reason: "geometry-unavailable",
        preferredX: 83,
      });
    },
  );

  it.each(["ArrowDown", "ArrowUp"] as const)(
    "reports unsupported adjacent geometry for %s without jumping to an edge",
    (key) => {
      const fixture = createFixture([
        { id: "a", text: "alpha" },
        { id: "b", text: "bravo" },
      ]);
      const result = fixture.move(key, key === "ArrowDown" ? "a" : "b", 2, {
        moveVisualLine: () => ({ kind: "boundary", preferredX: 64 }),
        mapToVisualLine: () => ({
          kind: "unavailable",
          reason: "target-row-unmeasurable",
        }),
      });

      expect(result).toEqual({
        ok: false,
        reason: "geometry-unavailable",
        blockId: id(key === "ArrowDown" ? "b" : "a"),
        message: "target-row-unmeasurable",
        preferredX: 64,
      });
    },
  );

  it("preserves preferred X through an atomic target and into following text", () => {
    const fixture = createFixture([
      { id: "a", text: "alpha" },
      { id: "atom" },
      { id: "b", text: "bravo" },
    ]);
    const atom = fixture.move("ArrowDown", "a", 2, {
      moveVisualLine: () => ({ kind: "boundary", preferredX: 91 }),
    });
    expect(atom.ok && atom.point).toMatchObject({
      blockId: id("atom"),
      textOffset: 1,
    });
    expect(atom).toMatchObject({ ok: true, preferredX: 91 });
    if (!atom.ok) throw new Error("Expected movement into atomic target.");

    const mapToVisualLine = vi.fn(() => ({
      kind: "mapped" as const,
      textOffset: 3,
    }));
    const text = fixture.movePoint("ArrowDown", atom.point, {
      preferredX: atom.preferredX,
      mapToVisualLine,
    });
    expect(text.ok && text.point).toMatchObject({
      blockId: id("b"),
      textOffset: 3,
    });
    expect(mapToVisualLine).toHaveBeenCalledWith(
      expect.objectContaining({ preferredX: 91 }),
    );
  });

  it.each([
    ["ArrowRight" as const, "before", 6, "child", 0],
    ["ArrowLeft" as const, "child", 0, "before", 6],
    ["ArrowDown" as const, "before", 6, "child", 2],
    ["ArrowUp" as const, "child", 0, "before", 2],
  ])(
    "skips a selectable parent wrapper during %s navigation",
    (key, from, offset, expectedBlockId, expectedOffset) => {
      const fixture = createFixture([
        { id: "before", text: "before" },
        { id: "item" },
        { id: "child", parentId: "item", text: "child" },
      ]);
      const result = fixture.move(key, from, offset, {
        moveVisualLine: () => ({
          kind: "boundary",
          preferredX: 40,
        }),
        mapToVisualLine: () => ({
          kind: "mapped",
          textOffset: expectedOffset,
        }),
      });

      expect(result.ok && result.point).toMatchObject({
        blockId: id(expectedBlockId),
        textOffset: expectedOffset,
      });
    },
  );

  it.each([
    ["ArrowRight" as const, "before", 6, "after", 0],
    ["ArrowLeft" as const, "after", 0, "before", 6],
    ["ArrowDown" as const, "before", 6, "after", 2],
    ["ArrowUp" as const, "after", 0, "before", 2],
  ])(
    "skips an explicitly unavailable presentation during %s navigation",
    (key, from, offset, expectedBlockId, expectedOffset) => {
      const fixture = createFixture([
        { id: "before", text: "before" },
        { id: "hidden", text: "hidden" },
        { id: "after", text: "after" },
      ]);
      const result = fixture.move(key, from, offset, {
        canNavigateTo: (target) => target.block.id !== id("hidden"),
        moveVisualLine: () => ({
          kind: "boundary",
          preferredX: 40,
        }),
        mapToVisualLine: () => ({
          kind: "mapped",
          textOffset: expectedOffset,
        }),
      });

      expect(result.ok && result.point).toMatchObject({
        blockId: id(expectedBlockId),
        textOffset: expectedOffset,
      });
    },
  );

  it("does not interpret unavailable geometry as a visual boundary", () => {
    const fixture = createFixture([
      { id: "a", text: "alpha" },
      { id: "b", text: "bravo" },
    ]);
    const mapToVisualLine = vi.fn();
    const result = fixture.move("ArrowDown", "a", 2, {
      moveVisualLine: () => ({ kind: "unavailable", reason: "invalid-layout" }),
      mapToVisualLine,
    });

    expect(result).toMatchObject({ ok: false, reason: "geometry-unavailable" });
    expect(mapToVisualLine).not.toHaveBeenCalled();
  });

  it("returns owned no-movement at a document boundary without changing the caret", () => {
    const fixture = createFixture([{ id: "only", text: "alpha" }]);
    const result = fixture.move("ArrowDown", "only", 2, {
      moveVisualLine: () => ({ kind: "boundary", preferredX: 52 }),
    });

    expect(result).toEqual({
      ok: false,
      reason: "no-movement",
      preferredX: 52,
    });
  });

  it("resets preferred X for horizontal navigation", () => {
    const fixture = createFixture([{ id: "a", text: "alpha" }]);
    const result = fixture.move("ArrowRight", "a", 2, { preferredX: 80 });

    expect(result).toMatchObject({ ok: true, preferredX: null });
    expect(result.ok && result.point.textOffset).toBe(3);
  });
});

interface FixtureBlock {
  readonly id: string;
  readonly text?: string;
  readonly parentId?: string;
}

function createFixture(input: readonly FixtureBlock[]) {
  const roots = input
    .filter((entry) => entry.parentId === undefined)
    .map((entry) => id(entry.id));
  const textById = new Map<BlockId, string>(
    input.flatMap((entry) =>
      entry.text === undefined ? [] : [[id(entry.id), entry.text]],
    ),
  );
  const models = new Map<BlockId, BlockSelectionModel>(
    input.map((entry) => [
      id(entry.id),
      entry.text === undefined ? wholeSelection() : contentSelection(),
    ]),
  );
  const blocks = new Map<BlockId, VersionedBlock>(
    input.map((entry) => [
      id(entry.id),
      {
        id: id(entry.id),
        type: entry.text === undefined ? "atomic" : "paragraph",
        parentId: entry.parentId ? id(entry.parentId) : null,
        metadataVersion: "1",
        contentVersion: entry.text === undefined ? null : "1",
      },
    ]),
  );
  const graph: EditorSelectionGraphReader = {
    getBlock: (blockId) => blocks.get(blockId) ?? null,
    getParentId: (blockId) => blocks.get(blockId)?.parentId ?? null,
    getRootBlockIds: () => roots,
    getChildBlockIds: (parentId) =>
      input
        .filter((entry) => entry.parentId === parentId)
        .map((entry) => id(entry.id)),
    readBlockSelectionModel: (blockId) => models.get(blockId) ?? null,
  };
  const point = (
    blockId: string,
    textOffset: number,
  ): EditorLogicalSelectionPoint => {
    const block = blocks.get(id(blockId));
    const model = models.get(id(blockId));
    if (!block || !model) throw new Error(`Missing fixture block ${blockId}.`);
    const content = model.projection.endpoint.kind === "content";
    return {
      blockId: block.id,
      blockType: block.type,
      blockCategory: model.projection.category,
      textOffset,
      textAnchor: content ? anchor : null,
      affinity: null,
    };
  };
  const movePoint = (
    key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
    focus: EditorLogicalSelectionPoint,
    overrides: Partial<
      Parameters<typeof moveEditorKeyboardSelectionEndpoint>[0]
    > = {},
  ) =>
    moveEditorKeyboardSelectionEndpoint({
      key,
      focus,
      graph,
      readText: (blockId) => textById.get(blockId),
      createPoint: ({ target, textOffset, affinity }) => ({
        ...point(target.block.id, textOffset),
        affinity,
      }),
      ...overrides,
    });
  return {
    move(
      key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
      blockId: string,
      textOffset: number,
      overrides: Partial<
        Parameters<typeof moveEditorKeyboardSelectionEndpoint>[0]
      > = {},
    ) {
      return movePoint(key, point(blockId, textOffset), overrides);
    },
    movePoint,
  };
}
