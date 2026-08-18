import { assertValidCanonicalBlockFragment } from "@repo/editor-core/editing";
import { describe, expect, it } from "vitest";
import { firstDraftBlockDefinitions } from "../first-draft-definition.tsx";
import {
  filterFirstDraftSlashActions,
  firstDraftSlashActionCatalog,
} from "./catalog.ts";
import { materializeFirstDraftSlashAction } from "./materialize.ts";

const emptyEditor = {
  getRootBlockIds: () => [],
  getChildBlockIds: () => [],
  getBlock: () => null,
};

describe("First Draft slash catalog", () => {
  it("contains all 27 user-insertable actions in stable order", () => {
    expect(firstDraftSlashActionCatalog.map(({ id }) => id)).toEqual([
      "paragraph",
      "heading-1",
      "heading-2",
      "heading-3",
      "heading-4",
      "heading-5",
      "heading-6",
      "bullet-list",
      "numbered-list",
      "checklist",
      "quote",
      "code",
      "callout",
      "toggle-heading-1",
      "toggle-heading-2",
      "toggle-heading-3",
      "toggle-heading-4",
      "toggle-heading-5",
      "toggle-heading-6",
      "toggle-list",
      "divider",
      "bookmark",
      "columns-2",
      "columns-3",
      "columns-4",
      "tabs",
      "table",
    ]);
  });

  it("filters every query word case-insensitively and ranks exact/prefix matches", () => {
    expect(filterFirstDraftSlashActions("HEADING h2").map(({ id }) => id)).toEqual([
      "heading-2",
      "toggle-heading-2",
    ]);
    expect(filterFirstDraftSlashActions("table").map(({ id }) => id)).toEqual([
      "table",
    ]);
    expect(filterFirstDraftSlashActions("not present")).toEqual([]);
  });

  it("materializes every action as a definition-valid canonical fragment", () => {
    for (const candidate of firstDraftSlashActionCatalog) {
      const materialized = materializeFirstDraftSlashAction(
        candidate,
        emptyEditor,
      );
      expect(() =>
        assertValidCanonicalBlockFragment(materialized.fragment, {
          blockDefinitions: firstDraftBlockDefinitions,
        }),
      ).not.toThrow();
      expect(materialized.fragment.rootBlockIds).toHaveLength(1);
      expect(materialized.fragment.rootBlockIds).toContain(
        materialized.rootBlockId,
      );
      expect(
        materialized.fragment.blocks.some(
          ({ id }) => id === materialized.selectionBlockId,
        ),
      ).toBe(true);
    }
  });

  it("sets all heading and nested toggle-heading levels", () => {
    for (let level = 1; level <= 6; level += 1) {
      const heading = materialize(`heading-${level}`);
      expect(heading.blocks.find(({ type }) => type === "heading")?.metadata)
        .toEqual({ level });
      const toggle = materialize(`toggle-heading-${level}`);
      expect(toggle.blocks.find(({ type }) => type === "toggleHeading")?.metadata)
        .toBeUndefined();
      expect(toggle.blocks.find(({ type }) => type === "heading")?.metadata)
        .toEqual({ level });
    }
  });

  it("creates complete lists, toggle list, columns, and two editable tab panes", () => {
    expect(types(materialize("bullet-list"))).toEqual([
      "bulletList",
      "bulletListItem",
      "paragraph",
    ]);
    expect(types(materialize("numbered-list"))).toEqual([
      "orderedList",
      "orderedListItem",
      "paragraph",
    ]);
    expect(types(materialize("checklist"))).toEqual([
      "checklist",
      "checklistItem",
      "paragraph",
    ]);
    expect(types(materialize("toggle-list"))).toEqual([
      "toggleListItem",
      "paragraph",
      "toggleListItemBody",
      "placeholder",
    ]);
    for (const count of [2, 3, 4] as const) {
      const fragment = materialize(`columns-${count}`);
      expect(fragment.blocks.filter(({ type }) => type === "column")).toHaveLength(count);
      expect(fragment.blocks.filter(({ type }) => type === "paragraph")).toHaveLength(count);
      for (const column of fragment.blocks.filter(({ type }) => type === "column")) {
        expect(column.metadata).toEqual({ layoutWeight: 1_000_000 });
      }
    }
    const tabs = materialize("tabs");
    expect(tabs.blocks.filter(({ type }) => type === "tabPane")).toHaveLength(2);
    expect(tabs.blocks.filter(({ type }) => type === "paragraph")).toHaveLength(2);
  });

  it("creates a 3 by 3 table with unique column ids and empty cell content", () => {
    const fragment = materialize("table");
    const table = fragment.blocks.find(({ type }) => type === "table")!;
    const rows = fragment.blocks.filter(({ type }) => type === "tableRow");
    const cells = fragment.blocks.filter(({ type }) => type === "tableCell");
    expect(rows).toHaveLength(3);
    expect(cells).toHaveLength(9);
    for (const row of rows) {
      expect(cells.filter(({ parentId }) => parentId === row.id)).toHaveLength(3);
    }
    const columnIds = table.metadata?.columnIds as readonly string[];
    expect(columnIds).toHaveLength(3);
    expect(new Set(columnIds)).toHaveProperty("size", 3);
    expect(cells.every(({ plainText }) => plainText === "")).toBe(true);
  });

  it("preserves the creation planner's explicit selection targets", () => {
    for (const id of ["paragraph", "heading-4"] as const) {
      const result = materialization(id);
      expect(recordType(result, result.selectionBlockId)).toBe(
        id === "paragraph" ? "paragraph" : "heading",
      );
      expect(result.selectionBlockId).toBe(result.rootBlockId);
    }

    for (const [id, type] of [
      ["quote", "paragraph"],
      ["bullet-list", "paragraph"],
      ["toggle-list", "paragraph"],
    ] as const) {
      const result = materialization(id);
      expect(recordType(result, result.selectionBlockId)).toBe(type);
      expect(result.selectionBlockId).not.toBe(result.rootBlockId);
    }

    for (const id of ["divider", "bookmark"] as const) {
      const result = materialization(id);
      expect(result.selectionBlockId).toBe(result.rootBlockId);
      expect(recordType(result, result.selectionBlockId)).toBe(id);
    }

    const tabs = materialization("tabs");
    expect(recordType(tabs, tabs.selectionBlockId)).toBe("paragraph");
    expect(
      tabs.fragment.blocks.find(({ id }) => id === tabs.selectionBlockId)
        ?.parentId,
    ).toBe(
      tabs.fragment.blocks.find(({ type }) => type === "tabPane")?.id,
    );

    const table = materialization("table");
    expect(recordType(table, table.selectionBlockId)).toBe("tableCell");
    expect(table.selectionBlockId).toBe(
      table.fragment.blocks.find(({ type }) => type === "tableCell")?.id,
    );
  });
});

function materialize(id: string) {
  return materialization(id).fragment;
}

function materialization(id: string) {
  const candidate = firstDraftSlashActionCatalog.find((item) => item.id === id);
  if (!candidate) throw new Error(`missing action ${id}`);
  return materializeFirstDraftSlashAction(candidate, emptyEditor);
}

function recordType(
  result: ReturnType<typeof materialization>,
  blockId: string,
) {
  return result.fragment.blocks.find(({ id }) => id === blockId)?.type;
}

function types(fragment: ReturnType<typeof materialize>) {
  return fragment.blocks.map(({ type }) => type);
}
