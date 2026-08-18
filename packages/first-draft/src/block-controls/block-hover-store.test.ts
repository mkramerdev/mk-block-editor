import { describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { createFirstDraftBlockHoverStore } from "./block-hover-store.ts";

const blockA = "hover-a" as BlockId;
const blockB = "hover-b" as BlockId;

describe("First Draft block hover store", () => {
  it("starts without a hovered block", () => {
    expect(createFirstDraftBlockHoverStore().getHoveredBlockId()).toBeNull();
  });

  it("notifies only the old and new block subscriptions", () => {
    const store = createFirstDraftBlockHoverStore();
    const a = vi.fn();
    const b = vi.fn();
    const unrelated = vi.fn();
    store.subscribeBlock(blockA, a);
    store.subscribeBlock(blockB, b);
    store.subscribeBlock("unrelated" as BlockId, unrelated);

    store.setHoveredBlockId(blockA);
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    a.mockClear();

    store.setHoveredBlockId(blockA);
    expect(a).not.toHaveBeenCalled();

    store.setHoveredBlockId(blockB);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(unrelated).not.toHaveBeenCalled();
    b.mockClear();

    store.setHoveredBlockId(null);
    expect(b).toHaveBeenCalledOnce();
    expect(unrelated).not.toHaveBeenCalled();
  });

  it("stops notifying an unsubscribed block listener", () => {
    const store = createFirstDraftBlockHoverStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeBlock(blockA, listener);
    unsubscribe();

    store.setHoveredBlockId(blockA);
    expect(listener).not.toHaveBeenCalled();
  });
});
