import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { createFirstDraftTableActionMenuStore } from "./store.tsx";

const tableId = "table-1" as BlockId;
const rowId = "row-1" as BlockId;
const ownedTableRange = Object.freeze({
  kind: "cell-range" as const,
  anchorCellId: "cell-1" as BlockId,
  headCellId: "cell-2" as BlockId,
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("First Draft table action menu store", () => {
  it("starts closed and closes idempotently", () => {
    const store = createFirstDraftTableActionMenuStore();
    expect(store.getSnapshot()).toEqual({ kind: "closed" });
    expect(store.close()).toBe(false);
  });

  it("opens immutable row and column sessions and atomically replaces one", () => {
    const store = createFirstDraftTableActionMenuStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const rowTrigger = connectedButton();
    const columnTrigger = connectedButton();

    expect(
      store.open({
        kind: "open",
        tableId,
        target: { kind: "row", rowId },
        triggerElement: rowTrigger,
        ownedTableRange,
      }),
    ).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      kind: "open",
      target: { kind: "row", rowId },
    });
    expect(Object.isFrozen(store.getSnapshot())).toBe(true);

    store.open({
      kind: "open",
      tableId,
      target: {
        kind: "column",
        identity: { kind: "canonical", columnId: "column-stable-id" },
      },
      triggerElement: columnTrigger,
      ownedTableRange,
    });
    expect(store.getSnapshot()).toMatchObject({
      kind: "open",
      target: {
        kind: "column",
        identity: { kind: "canonical", columnId: "column-stable-id" },
      },
    });
    expect(listener).toHaveBeenCalledTimes(2);

    expect(store.close()).toBe(true);
    expect(store.close()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("publishes once per subscribed listener and cleans subscriptions", () => {
    const store = createFirstDraftTableActionMenuStore();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = store.subscribe(first);
    const unsubscribeSecond = store.subscribe(second);
    unsubscribeFirst();
    unsubscribeFirst();

    store.open({
      kind: "open",
      tableId,
      target: { kind: "row", rowId },
      triggerElement: connectedButton(),
      ownedTableRange,
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribeSecond();
  });

  it("closes disconnected and invalid targets without mutating its session", () => {
    const store = createFirstDraftTableActionMenuStore();
    const trigger = connectedButton();
    store.open({
      kind: "open",
      tableId,
      target: { kind: "row", rowId },
      triggerElement: trigger,
      ownedTableRange,
    });
    const session = store.getSnapshot();
    expect(store.reconcile(() => true)).toBe(true);
    expect(store.getSnapshot()).toBe(session);
    expect(store.reconcile(() => false)).toBe(false);
    expect(store.getSnapshot()).toEqual({ kind: "closed" });

    store.open({
      kind: "open",
      tableId,
      target: { kind: "row", rowId },
      triggerElement: trigger,
      ownedTableRange,
    });
    trigger.remove();
    expect(store.reconcile(() => true)).toBe(false);
    expect(store.getSnapshot()).toEqual({ kind: "closed" });
  });

  it("isolates editor instances, menu ids, and grid registrations", () => {
    const first = createFirstDraftTableActionMenuStore();
    const second = createFirstDraftTableActionMenuStore();
    const trigger = connectedButton();
    const grid = document.createElement("div");
    document.body.append(grid);
    const unregister = first.registerTableGrid(tableId, grid);
    first.open({
      kind: "open",
      tableId,
      target: { kind: "row", rowId },
      triggerElement: trigger,
      ownedTableRange,
    });

    expect(second.getSnapshot()).toEqual({ kind: "closed" });
    expect(first.menuId).not.toBe(second.menuId);
    expect(first.getTableGrid(tableId)).toBe(grid);
    expect(second.getTableGrid(tableId)).toBeNull();
    unregister();
    unregister();
    expect(first.getTableGrid(tableId)).toBeNull();
  });
});

function connectedButton(): HTMLButtonElement {
  const button = document.createElement("button");
  document.body.append(button);
  return button;
}
