import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { createFirstDraftBlockActionMenuStore } from "./store.tsx";

const id = (value: string) => value as BlockId;

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("First Draft block action menu store", () => {
  it("owns an isolated stable menu id and exactly one open session", () => {
    const first = createFirstDraftBlockActionMenuStore();
    const second = createFirstDraftBlockActionMenuStore();
    const firstMenuId = first.menuId;
    expect(firstMenuId).not.toBe(second.menuId);
    const trigger = connectedTrigger();

    expect(
      first.open({
        kind: "open",
        blockId: id("first"),
        triggerElement: trigger,
        cause: "pointer",
      }),
    ).toBe(true);
    expect(first.menuId).toBe(firstMenuId);
    expect(first.getSnapshot()).toMatchObject({
      kind: "open",
      blockId: id("first"),
    });
    expect(second.getSnapshot()).toEqual({ kind: "closed" });

    first.open({
      kind: "open",
      blockId: id("replacement"),
      triggerElement: trigger,
      cause: "keyboard",
    });
    expect(first.getSnapshot()).toMatchObject({
      kind: "open",
      blockId: id("replacement"),
      cause: "keyboard",
    });
  });

  it("toggles, reconciles a stale target, and rejects a disconnected anchor", () => {
    const store = createFirstDraftBlockActionMenuStore();
    const trigger = connectedTrigger();
    const session = {
      kind: "open" as const,
      blockId: id("target"),
      triggerElement: trigger,
      cause: "pointer" as const,
    };

    expect(store.toggle(session)).toBe(true);
    expect(store.toggle(session)).toBe(false);
    expect(store.getSnapshot()).toEqual({ kind: "closed" });
    store.open(session);
    expect(store.reconcile(() => false)).toBe(false);
    expect(store.getSnapshot()).toEqual({ kind: "closed" });
    trigger.remove();
    expect(store.open(session)).toBe(false);
    expect(store.getSnapshot()).toEqual({ kind: "closed" });
  });

  it("suppresses only the completed drag's next pointer click", () => {
    const store = createFirstDraftBlockActionMenuStore();
    const sourceId = id("source");
    const otherId = id("other");
    store.open({
      kind: "open",
      blockId: sourceId,
      triggerElement: connectedTrigger(),
      cause: "pointer",
    });

    store.closeForDocumentDrag(sourceId);
    expect(store.getSnapshot()).toEqual({ kind: "closed" });
    expect(store.consumeSuppressedTriggerClick(otherId)).toBe(false);
    expect(store.consumeSuppressedTriggerClick(sourceId)).toBe(true);
    expect(store.consumeSuppressedTriggerClick(sourceId)).toBe(false);

    store.closeForDocumentDrag(sourceId);
    store.clearSuppressedTriggerClick(sourceId);
    expect(store.consumeSuppressedTriggerClick(sourceId)).toBe(false);
  });
});

function connectedTrigger(): HTMLButtonElement {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  return trigger;
}
