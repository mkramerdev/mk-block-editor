import { describe, expect, it } from "vitest";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import { exportCanonicalFragmentPlainText } from "@repo/editor-web/clipboard-runtime";
import { firstDraftBlockDefinitions } from "../../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../../first-draft-fixture.ts";
import {
  firstDraftTableClipboardCodecs,
  materializeFirstDraftTableCellRange,
} from "./clipboard.ts";

describe("First Draft table clipboard contribution", () => {
  it("materializes a backward 2x2 direct-cell table with fresh identities and TSV", () => {
    const snapshot = createFirstDraftSnapshot();
    const fragment = materializeFirstDraftTableCellRange({
      hostBlockId: "fd-table" as BlockId,
      selection: {
        kind: "cell-range",
        anchorCellId: "fd-table-cell-3-3",
        headCellId: "fd-table-cell-2-2",
      },
      getBlock: (id) => {
        const block = snapshot.blocks[id];
        return block
          ? ({
              ...block,
              metadataVersion: "test",
              contentVersion: "test",
            } as VersionedBlock)
          : null;
      },
      getChildBlockIds: (id) => snapshot.childIdsByParentId[id] ?? [],
      getParentId: (id) => snapshot.blocks[id]?.parentId ?? null,
      readBlockContent: (id) => snapshot.content[id] ?? null,
      blockDefinitions: firstDraftBlockDefinitions,
    });
    expect(fragment).not.toBeNull();
    const table = fragment!.blocks[0]!;
    const rows = fragment!.blocks.filter(
      (block) => block.parentId === table.id,
    );
    const cells = rows.flatMap((row) =>
      fragment!.blocks.filter((block) => block.parentId === row.id),
    );
    expect(rows).toHaveLength(2);
    expect(cells.map((cell) => cell.plainText)).toEqual([
      "Ada",
      "In progress",
      "Mina",
      "Planned",
    ]);
    expect(cells.every((cell) => cell.type === "tableCell")).toBe(true);
    expect(fragment!.blocks.some((block) => snapshot.blocks[block.id])).toBe(
      false,
    );
    const columns = table.metadata?.columnIds as string[];
    expect(columns).toHaveLength(2);
    expect(columns).not.toContain("fd-table-column-b");
    expect(table.metadata?.columnWidths).toEqual({
      [columns[0]!]: 208,
      [columns[1]!]: 208,
    });
    expect(
      exportCanonicalFragmentPlainText(fragment!, {
        blockDefinitions: firstDraftBlockDefinitions,
        defaultTextBlockType: "paragraph",
        exportHandlers: firstDraftTableClipboardCodecs.plainTextExportHandlers,
      }),
    ).toBe("Ada\tIn progress\nMina\tPlanned");
  });

  it("rejects stale and foreign-table range payloads", () => {
    const snapshot = createFirstDraftSnapshot();
    const base = {
      hostBlockId: "fd-table" as BlockId,
      getBlock: (id: BlockId) => {
        const block = snapshot.blocks[id];
        return block
          ? ({
              ...block,
              metadataVersion: "test",
              contentVersion: "test",
            } as VersionedBlock)
          : null;
      },
      getChildBlockIds: (id: BlockId) => snapshot.childIdsByParentId[id] ?? [],
      getParentId: (id: BlockId) => snapshot.blocks[id]?.parentId ?? null,
      readBlockContent: (id: BlockId) => snapshot.content[id] ?? null,
      blockDefinitions: firstDraftBlockDefinitions,
    };
    expect(
      materializeFirstDraftTableCellRange({
        ...base,
        selection: {
          kind: "cell-range",
          anchorCellId: "missing",
          headCellId: "fd-table-cell-2-2",
        },
      }),
    ).toBeNull();
    expect(
      materializeFirstDraftTableCellRange({
        ...base,
        selection: {
          kind: "cell-range",
          anchorCellId: "fd-table-cell-2-2",
          headCellId: "fd-metrics-table-cell-2-2",
        },
      }),
    ).toBeNull();
  });
});
