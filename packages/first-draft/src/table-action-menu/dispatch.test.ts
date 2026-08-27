import { afterEach, describe, expect, it, vi } from "vitest";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import type { EditorSemanticChange } from "@repo/editor-web/editor";
import { createFirstDraftEditorDefinition } from "../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import {
  initializeTestEditableEditor,
  type FirstDraftTestEditor,
} from "../test-editor.ts";
import { createFirstDraftViewStateStore } from "../blocks/view-state.tsx";
import {
  deleteFirstDraftTableColumn,
  deleteFirstDraftTableRow,
} from "../blocks/table/mutations.ts";
import { resolveFirstDraftTableColumnIds } from "../blocks/table/model.ts";
import {
  materializeFirstDraftTableActionRange,
  resolveFirstDraftTableActionTarget,
} from "../blocks/table/action-target.ts";
import {
  dispatchFirstDraftTableAction,
  readFirstDraftTableActionAvailability,
} from "./dispatch.ts";
import {
  createFirstDraftTableActionMenuStore,
  type FirstDraftTableActionMenuStore,
} from "./store.tsx";

const tableId = asBlockId("fd-table");
const editors: FirstDraftTestEditor[] = [];
const triggers: HTMLElement[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose();
  for (const trigger of triggers.splice(0)) trigger.remove();
  vi.restoreAllMocks();
});

describe("First Draft table action dispatch", () => {
  it.each([
    {
      actionId: "delete-row" as const,
      axis: "row" as const,
      targetIndex: 1,
      expectedIndex: -1,
    },
    {
      actionId: "insert-row-above" as const,
      axis: "row" as const,
      targetIndex: 1,
      expectedIndex: 1,
    },
    {
      actionId: "insert-row-below" as const,
      axis: "row" as const,
      targetIndex: 1,
      expectedIndex: 2,
    },
    {
      actionId: "duplicate-row" as const,
      axis: "row" as const,
      targetIndex: 1,
      expectedIndex: 2,
    },
    {
      actionId: "delete-column" as const,
      axis: "column" as const,
      targetIndex: 1,
      expectedIndex: -1,
    },
    {
      actionId: "insert-column-left" as const,
      axis: "column" as const,
      targetIndex: 1,
      expectedIndex: 1,
    },
    {
      actionId: "insert-column-right" as const,
      axis: "column" as const,
      targetIndex: 1,
      expectedIndex: 2,
    },
    {
      actionId: "duplicate-column" as const,
      axis: "column" as const,
      targetIndex: 1,
      expectedIndex: 2,
    },
  ])(
    "$actionId dispatches by stable identity in one transaction",
    ({ actionId, axis, targetIndex, expectedIndex }) => {
      const fixture = createFixture();
      const beforeRows = fixture.editor.getChildBlockIds(tableId);
      const beforeColumns = readColumnIds(fixture.editor);
      const targetId =
        axis === "row" ? beforeRows[targetIndex]! : beforeColumns[targetIndex]!;
      const session = open(fixture.editor, fixture.store, axis, targetId);
      const transaction = vi.spyOn(fixture.editor, "transaction");

      expect(
        dispatchFirstDraftTableAction(fixture.editor, session, actionId),
      ).toEqual({ kind: "applied" });

      expect(fixture.store.getSnapshot()).toBe(session);
      expect(transaction).toHaveBeenCalledOnce();
      expect(fixture.changes).toHaveLength(1);
      if (axis === "row") {
        const afterRows = fixture.editor.getChildBlockIds(tableId);
        const expectedTargetIndex =
          actionId === "delete-row"
            ? -1
            : actionId === "insert-row-above"
              ? targetIndex + 1
              : targetIndex;
        expect(afterRows.indexOf(targetId as BlockId)).toBe(
          expectedTargetIndex,
        );
        const resultRowId =
          expectedIndex < 0 ? null : afterRows[expectedIndex]!;
        if (resultRowId) {
          expect(resultRowId).not.toBe(targetId);
        }
      } else {
        const afterColumns = readColumnIds(fixture.editor);
        const expectedTargetIndex =
          actionId === "delete-column"
            ? -1
            : actionId === "insert-column-left"
              ? targetIndex + 1
              : targetIndex;
        expect(afterColumns.indexOf(targetId as string)).toBe(
          expectedTargetIndex,
        );
        if (expectedIndex >= 0) {
          expect(afterColumns[expectedIndex]).not.toBe(targetId);
        }
      }
      expect(fixture.editor.selectionController.getCanonicalSnapshot()).toEqual(
        expect.objectContaining({ kind: "none" }),
      );
      expect(fixture.changes[0]!.selectionAfter).toEqual({ kind: "none" });
    },
  );

  it.each(["delete-row", "delete-column"] as const)(
    "keeps %s visible but disabled for the final target",
    (actionId) => {
      const fixture = createFixture();
      if (actionId === "delete-row") {
        while (fixture.editor.getChildBlockIds(tableId).length > 1) {
          deleteFirstDraftTableRow(
            fixture.editor,
            tableId,
            fixture.editor.getChildBlockIds(tableId).at(-1)!,
          );
        }
      } else {
        while (readColumnIds(fixture.editor).length > 1) {
          deleteFirstDraftTableColumn(fixture.editor, tableId, {
            kind: "canonical",
            columnId: readColumnIds(fixture.editor).at(-1)!,
          });
        }
      }
      fixture.changes.splice(0);
      const targetId =
        actionId === "delete-row"
          ? fixture.editor.getChildBlockIds(tableId)[0]!
          : readColumnIds(fixture.editor)[0]!;
      const session = open(
        fixture.editor,
        fixture.store,
        actionId === "delete-row" ? "row" : "column",
        targetId,
      );
      const transaction = vi.spyOn(fixture.editor, "transaction");

      expect(
        readFirstDraftTableActionAvailability(
          fixture.editor,
          session,
          actionId,
        ),
      ).toEqual({ kind: "disabled", targetIndex: 0 });
      expect(
        dispatchFirstDraftTableAction(fixture.editor, session, actionId),
      ).toEqual({ kind: "disabled" });
      expect(transaction).not.toHaveBeenCalled();
      expect(fixture.changes).toEqual([]);
      expect(fixture.store.getSnapshot().kind).toBe("open");
    },
  );

  it("classifies a stale session without owning menu lifecycle", () => {
    const fixture = createFixture();
    const session = open(
      fixture.editor,
      fixture.store,
      "row",
      asBlockId("missing-row"),
    );
    const transaction = vi.spyOn(fixture.editor, "transaction");

    expect(
      dispatchFirstDraftTableAction(fixture.editor, session, "duplicate-row"),
    ).toEqual({ kind: "stale" });
    expect(transaction).not.toHaveBeenCalled();
    expect(fixture.changes).toEqual([]);
    expect(fixture.store.getSnapshot()).toBe(session);
  });
});

function createFixture(): {
  readonly editor: FirstDraftTestEditor;
  readonly store: FirstDraftTableActionMenuStore;
  readonly changes: EditorSemanticChange[];
} {
  const changes: EditorSemanticChange[] = [];
  const editor = initializeTestEditableEditor({
    definition: createFirstDraftEditorDefinition(
      createFirstDraftViewStateStore(),
    ),
    snapshot: createFirstDraftSnapshot(),
    onChange(change) {
      changes.push(change);
    },
  });
  editors.push(editor);
  return {
    editor,
    store: createFirstDraftTableActionMenuStore(),
    changes,
  };
}

function open(
  editor: FirstDraftTestEditor,
  store: FirstDraftTableActionMenuStore,
  axis: "row" | "column",
  targetId: BlockId | string,
): Extract<
  ReturnType<FirstDraftTableActionMenuStore["getSnapshot"]>,
  { kind: "open" }
> {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  triggers.push(trigger);
  const target =
    axis === "row"
      ? ({ kind: "row", rowId: targetId as BlockId } as const)
      : ({
          kind: "column",
          identity: { kind: "canonical", columnId: targetId as string },
        } as const);
  let ownedTableRange = {
    kind: "cell-range" as const,
    anchorCellId: "missing-anchor" as BlockId,
    headCellId: "missing-head" as BlockId,
  };
  try {
    ownedTableRange = materializeFirstDraftTableActionRange(
      target,
      resolveFirstDraftTableActionTarget(editor, tableId, target),
    );
  } catch {
    // Stale dispatcher sessions intentionally retain an unresolved ownership token.
  }
  expect(
    store.open({
      kind: "open",
      tableId,
      target,
      triggerElement: trigger,
      ownedTableRange,
    }),
  ).toBe(true);
  const session = store.getSnapshot();
  if (session.kind !== "open") throw new Error("Missing menu session");
  return session;
}

function readColumnIds(editor: FirstDraftTestEditor): readonly string[] {
  const rowId = editor.getChildBlockIds(tableId)[0]!;
  return resolveFirstDraftTableColumnIds(
    editor.getBlock(tableId)?.metadata,
    editor.getChildBlockIds(rowId).length,
  ).ids;
}
