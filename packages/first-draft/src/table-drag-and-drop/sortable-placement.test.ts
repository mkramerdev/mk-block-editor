import { describe, expect, it } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import type { SortableDropPlacement } from "@mk-drag-and-drop/react";
import {
  projectSortableBlockOrder,
  projectSortableRecordOrder,
} from "./sortable-placement.ts";

const lane = "row-lane";
const a = "row-a" as BlockId;
const b = "row-b" as BlockId;
const c = "row-c" as BlockId;
const d = "row-d" as BlockId;
const canonical = [a, b, c, d] as const;

describe("sortable row placement projection", () => {
  it.each([
    ["before", c, placement(b, "before", a, b), [a, c, b, d]],
    ["after", b, placement(c, "after", c, d), [a, c, b, d]],
    ["first", d, placement(a, "before", null, a), [d, a, b, c]],
    ["final", a, placement(d, "after", d, null), [b, c, d, a]],
  ] as const)("projects %s placement", (_name, source, value, expected) => {
    expect(projectSortableBlockOrder(canonical, source, lane, value)).toEqual({
      ok: true,
      changed: true,
      order: expected,
    });
  });

  it("uses previous/next-only normalized anchors", () => {
    expect(
      projectSortableBlockOrder(canonical, d, lane, {
        ...basePlacement,
        previousDraggableId: a,
        nextDraggableId: b,
      }),
    ).toEqual({ ok: true, changed: true, order: [a, d, b, c] });
  });

  it("returns a semantic no-op when the source returns", () => {
    expect(
      projectSortableBlockOrder(
        canonical,
        b,
        lane,
        placement(c, "before", a, c),
      ),
    ).toEqual({ ok: true, changed: false, order: canonical });
  });

  it.each([
    ["invalid target", placement("missing", "before", a, b)],
    [
      "missing previous anchor",
      { ...basePlacement, previousDraggableId: "missing", nextDraggableId: c },
    ],
    [
      "missing next anchor",
      { ...basePlacement, previousDraggableId: a, nextDraggableId: "missing" },
    ],
    [
      "non-adjacent anchors",
      { ...basePlacement, previousDraggableId: a, nextDraggableId: d },
    ],
    [
      "wrong container",
      { ...basePlacement, sourceContainerId: "other", containerId: lane },
    ],
  ] as const)("rejects %s", (_name, value) => {
    expect(projectSortableBlockOrder(canonical, b, lane, value).ok).toBe(
      false,
    );
  });

  it("rejects a missing source", () => {
    expect(
      projectSortableBlockOrder(
        canonical,
        "missing" as BlockId,
        lane,
        placement(a, "before", null, a),
      ).ok,
    ).toBe(false);
  });
});

describe("sortable opaque record placement projection", () => {
  const records = ["token-a", "token-b", "token-c"].map((dragId) => ({
    dragId,
    logical: `logical:${dragId}`,
  }));

  it("reorders records by opaque drag token without reading logical identity", () => {
    expect(
      projectSortableRecordOrder(
        records,
        "token-a",
        lane,
        {
          ...basePlacement,
          previousDraggableId: "token-c",
          targetDraggableId: "token-c",
          side: "after",
        },
        (record) => record.dragId,
      ),
    ).toEqual({
      ok: true,
      changed: true,
      order: [records[1], records[2], records[0]],
    });
  });

  it("rejects duplicate tokens", () => {
    expect(
      projectSortableRecordOrder(
        [records[0]!, records[0]!, records[2]!],
        "token-a",
        lane,
        {
          ...basePlacement,
          previousDraggableId: "token-c",
          targetDraggableId: "token-c",
          side: "after",
        },
        (record) => record.dragId,
      ).ok,
    ).toBe(false);
  });

  it("rejects a foreign source token", () => {
    expect(
      projectSortableRecordOrder(
        records,
        "foreign-token",
        lane,
        {
          ...basePlacement,
          previousDraggableId: "token-c",
          targetDraggableId: "token-c",
          side: "after",
        },
        (record) => record.dragId,
      ).ok,
    ).toBe(false);
  });
});

const basePlacement: SortableDropPlacement = {
  sourceContainerId: lane,
  containerId: lane,
  previousDraggableId: null,
  nextDraggableId: null,
  targetDraggableId: null,
  side: null,
};

function placement(
  targetDraggableId: string,
  side: "before" | "after",
  previousDraggableId: string | null,
  nextDraggableId: string | null,
): SortableDropPlacement {
  return {
    ...basePlacement,
    previousDraggableId,
    nextDraggableId,
    targetDraggableId,
    side,
  };
}
