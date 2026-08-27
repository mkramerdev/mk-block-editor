import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AutoScroll,
  AutoScrollContainerValue,
  CreateAutoScrollInput,
} from "mk-autoscroll";
import type { BlockId } from "@repo/editor-core/kernel";
import { createFirstDraftAutoScrollSessionOwner } from "./autoscroll-session.ts";

afterEach(() => {
  document.body.replaceChildren();
});

describe("First Draft autoscroll session ownership", () => {
  it("creates stable document and nested table controllers with explicit containers", () => {
    const fixture = createFixture();

    expect(fixture.inputs).toHaveLength(2);
    expect(fixture.inputs[0]).toMatchObject({
      axis: "y",
      outsideBehavior: "continue",
    });
    expect(fixture.inputs[1]).toMatchObject({
      axis: "both",
      outsideBehavior: "continue",
    });

    expect(
      fixture.owner.startTableDrag(
        "columns",
        fixture.tableId,
        fixture.table,
        { x: 90, y: 20 },
      ),
    ).toBe(true);
    expect(resolveContainers(fixture.inputs[1]!)).toEqual([
      fixture.table,
      fixture.documentScroll,
    ]);
    expect(resolveContainers(fixture.inputs[1]!)).not.toContain(
      fixture.rootTableShell,
    );
    expect(fixture.table.classList.contains("table-block__scroll")).toBe(true);
    fixture.owner.updateTableDrag("columns", fixture.tableId, {
      x: 95,
      y: 25,
    });
    expect(fixture.controllers[1]!.updatePoint).toHaveBeenLastCalledWith({
      x: 95,
      y: 25,
    });
    expect(fixture.inputs).toHaveLength(2);
  });

  it("isolates owners and ignores unrelated updates and stops", () => {
    const fixture = createFixture();
    fixture.owner.startDocumentBlock("document", { x: 10, y: 10 });
    fixture.owner.updateTableDrag("columns", fixture.tableId, {
      x: 20,
      y: 20,
    });
    fixture.owner.stopTableDrag("columns", fixture.tableId);
    expect(fixture.owner.getSession()).toMatchObject({
      kind: "document-block",
      group: "document",
    });
    expect(fixture.controllers[1]!.start).not.toHaveBeenCalled();

    fixture.inputs[0]!.onScroll?.({ changes: [] });
    expect(fixture.onDragScroll).toHaveBeenCalledWith("document");
    fixture.owner.startDocumentSelection({ x: 30, y: 30 });
    fixture.inputs[0]!.onScroll?.({ changes: [] });
    expect(fixture.onDragScroll).toHaveBeenCalledTimes(1);
    fixture.owner.stopDocumentBlock("document");
    expect(fixture.owner.getSession().kind).toBe("document-selection");
  });

  it("invalidates a table session when its explicit scroller disconnects", async () => {
    const fixture = createFixture();
    fixture.owner.startTableDrag(
      "rows",
      fixture.tableId,
      fixture.table,
      { x: 20, y: 20 },
    );
    fixture.table.remove();

    expect(resolveContainers(fixture.inputs[1]!)).toEqual([]);
    await Promise.resolve();

    expect(fixture.onInvalidated).toHaveBeenCalledWith(fixture.tableId);
    expect(fixture.owner.getSession().kind).toBe("inactive");
    expect(fixture.controllers[1]!.updatePoint).toHaveBeenLastCalledWith(null);
    expect(fixture.controllers[1]!.stop).toHaveBeenCalled();
  });

  it("invalidates when the registered table scroller is replaced", async () => {
    const fixture = createFixture();
    fixture.owner.startTableDrag(
      "columns",
      fixture.tableId,
      fixture.table,
      { x: 20, y: 20 },
    );
    const replacement = document.createElement("div");
    fixture.documentScroll.append(replacement);
    fixture.replaceTable(replacement);
    expect(resolveContainers(fixture.inputs[1]!)).toEqual([]);
    await Promise.resolve();
    expect(fixture.onInvalidated).toHaveBeenCalledWith(fixture.tableId);
    expect(fixture.owner.getSession().kind).toBe("inactive");
  });

  it("stops both controllers idempotently when the document scroller changes", () => {
    const fixture = createFixture();
    fixture.owner.startDocumentSelection({ x: 10, y: 10 });
    fixture.owner.stopAll();
    fixture.owner.stopAll();
    expect(fixture.owner.getSession().kind).toBe("inactive");
    for (const controller of fixture.controllers) {
      expect(controller.stop.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(controller.updatePoint).toHaveBeenLastCalledWith(null);
    }
  });
});

function createFixture() {
  const inputs: CreateAutoScrollInput[] = [];
  const controllers: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    updatePoint: ReturnType<typeof vi.fn>;
  }> = [];
  const createController = (input: CreateAutoScrollInput): AutoScroll => {
    inputs.push(input);
    const controller = {
      start: vi.fn(),
      stop: vi.fn(),
      updatePoint: vi.fn(),
    };
    controllers.push(controller);
    return controller;
  };
  const documentScroll = document.createElement("div");
  documentScroll.className = "first-draft-example__document-scroll";
  const rootTableShell = document.createElement("div");
  rootTableShell.className = "editor-web-block";
  rootTableShell.dataset.editorRootLayout = "full";
  rootTableShell.dataset.editorBlockType = "table";
  const table = document.createElement("div");
  table.className = "table-block__scroll";
  rootTableShell.append(table);
  documentScroll.append(rootTableShell);
  document.body.append(documentScroll);
  const tableId = "table" as BlockId;
  let currentTable: HTMLElement | null = table;
  const onDragScroll = vi.fn();
  const onDragSessionStopped = vi.fn();
  const onInvalidated = vi.fn();
  const owner = createFirstDraftAutoScrollSessionOwner({
    getDocumentScrollElement: () => documentScroll,
    getTableScrollElement: () =>
      currentTable?.isConnected ? currentTable : null,
    onDragScroll,
    onDragSessionStopped,
    onTableSessionInvalidated: onInvalidated,
    createController,
  });
  return {
    controllers,
    documentScroll,
    inputs,
    onDragScroll,
    onInvalidated,
    owner,
    replaceTable(element: HTMLElement) {
      currentTable = element;
    },
    rootTableShell,
    table,
    tableId,
  };
}

function resolveContainers(
  input: CreateAutoScrollInput,
): readonly AutoScrollContainerValue[] {
  const value =
    typeof input.container === "function" ? input.container() : input.container;
  if (Array.isArray(value)) return [...value] as AutoScrollContainerValue[];
  return [value as AutoScrollContainerValue | undefined ?? null];
}
