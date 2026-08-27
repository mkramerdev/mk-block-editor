import { describe, expect, it } from "vitest";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  createFirstDraftBlockDropTargetId,
  createFirstDraftBlockPlacementRegistry,
  parseFirstDraftBlockDropTargetId,
  resolveFirstDraftBlockDropAnchor,
  type FirstDraftBlockPlacementReader,
} from "./stable-anchors.tsx";

const id = (value: string) => value as BlockId;

function block(
  value: string,
  type: string,
  parentId: BlockId | null,
  tombstone = false,
): VersionedBlock {
  return {
    id: id(value),
    type,
    parentId,
    metadata: Object.freeze({}),
    metadataVersion: "0",
    contentVersion: null,
    tombstone: tombstone
      ? { deletedAt: 1, reason: "user-delete" }
      : null,
  };
}

function reader() {
  const blocks = new Map<BlockId, VersionedBlock>([
    [id("toggle"), block("toggle", "toggleHeading", null)],
    [id("summary"), block("summary", "heading", id("toggle"))],
    [id("body"), block("body", "toggleHeadingBody", id("toggle"))],
    [id("body-first"), block("body-first", "paragraph", id("body"))],
    [id("body-second"), block("body-second", "paragraph", id("body"))],
    [id("callout"), block("callout", "callout", null)],
    [id("callout-first"), block("callout-first", "paragraph", id("callout"))],
    [id("callout-second"), block("callout-second", "paragraph", id("callout"))],
    [id("quote"), block("quote", "quote", null)],
    [id("quote-text"), block("quote-text", "paragraph", id("quote"))],
    [id("tabs"), block("tabs", "tabs", null)],
    [id("pane"), block("pane", "tabPane", id("tabs"))],
    [id("table"), block("table", "table", null)],
    [id("row"), block("row", "tableRow", id("table"))],
    [id("cell"), block("cell", "tableCell", id("row"))],
  ]);
  let roots: readonly BlockId[] = [id("toggle"), id("callout"), id("quote"), id("tabs"), id("table")];
  const children = new Map<BlockId, readonly BlockId[]>([
    [id("toggle"), [id("summary"), id("body")]],
    [id("body"), [id("body-first"), id("body-second")]],
    [id("callout"), [id("callout-first"), id("callout-second")]],
    [id("quote"), [id("quote-text")]],
    [id("tabs"), [id("pane")]],
    [id("pane"), []],
    [id("table"), [id("row")]],
    [id("row"), [id("cell")]],
  ]);
  const value: FirstDraftBlockPlacementReader = {
    getBlock: (blockId) => blocks.get(blockId) ?? null,
    getRootBlockIds: () => roots,
    getChildBlockIds: (parentId) => children.get(parentId) ?? [],
  };
  return {
    blocks,
    value,
    setRoots: (next: readonly BlockId[]) => {
      roots = next;
    },
    setChildren: (parentId: BlockId, next: readonly BlockId[]) => {
      children.set(parentId, next);
    },
  };
}

describe("stable First Draft block drop anchors", () => {
  it("round-trips stable identities without canonical indexes", () => {
    const anchors = [
      { kind: "root-start" } as const,
      { kind: "wrapper-child-start", wrapperId: id("wrapper") } as const,
      { kind: "after-block", blockId: id("second") } as const,
    ];

    for (const anchor of anchors) {
      const encoded = createFirstDraftBlockDropTargetId(anchor);
      expect(encoded).not.toMatch(/index/i);
      expect(parseFirstDraftBlockDropTargetId(encoded)).toEqual(anchor);
    }
    expect(parseFirstDraftBlockDropTargetId("unrelated")).toBeNull();
  });

  it("resolves only product-valid child-start and after-block positions", () => {
    const fixture = reader();
    expect(resolveFirstDraftBlockDropAnchor(fixture.value, { kind: "root-start" })).toEqual({
      parentId: null,
      childIndex: 0,
    });
    expect(resolveFirstDraftBlockDropAnchor(fixture.value, {
      kind: "wrapper-child-start",
      wrapperId: id("body"),
    })).toEqual({ parentId: id("body"), childIndex: 0 });
    expect(resolveFirstDraftBlockDropAnchor(fixture.value, {
      kind: "after-block",
      blockId: id("body-first"),
    })).toEqual({ parentId: id("body"), childIndex: 1 });
    expect(resolveFirstDraftBlockDropAnchor(fixture.value, {
      kind: "wrapper-child-start",
      wrapperId: id("callout"),
    })).toEqual({ parentId: id("callout"), childIndex: 0 });
    expect(resolveFirstDraftBlockDropAnchor(fixture.value, {
      kind: "wrapper-child-start",
      wrapperId: id("pane"),
    })).toEqual({ parentId: id("pane"), childIndex: 0 });
  });

  it("re-resolves moved anchors and rejects deleted, stale, fabricated, and fixed-structure anchors", () => {
    const fixture = reader();
    const registry = createFirstDraftBlockPlacementRegistry(fixture.value);
    const targetId = createFirstDraftBlockDropTargetId({
      kind: "after-block",
      blockId: id("callout-first"),
    });

    expect(registry.get(targetId)).toEqual({
      parentId: id("callout"),
      childIndex: 1,
    });
    fixture.setChildren(id("callout"), [id("callout-second"), id("callout-first")]);
    expect(registry.get(targetId)).toEqual({
      parentId: id("callout"),
      childIndex: 2,
    });

    fixture.setChildren(id("callout"), [id("callout-second")]);
    expect(registry.get(targetId)).toBeNull();
    fixture.blocks.set(
      id("body"),
      block("body", "toggleHeadingBody", id("toggle"), true),
    );
    expect(resolveFirstDraftBlockDropAnchor(fixture.value, {
      kind: "wrapper-child-start",
      wrapperId: id("body"),
    })).toBeNull();
    for (const anchor of [
      { kind: "wrapper-child-start", wrapperId: id("toggle") } as const,
      { kind: "after-block", blockId: id("summary") } as const,
      { kind: "after-block", blockId: id("body") } as const,
      { kind: "wrapper-child-start", wrapperId: id("quote") } as const,
      { kind: "after-block", blockId: id("quote-text") } as const,
      { kind: "wrapper-child-start", wrapperId: id("table") } as const,
      { kind: "after-block", blockId: id("row") } as const,
      { kind: "after-block", blockId: id("cell") } as const,
      { kind: "after-block", blockId: id("missing") } as const,
    ]) {
      expect(resolveFirstDraftBlockDropAnchor(fixture.value, anchor)).toBeNull();
    }
  });
});
