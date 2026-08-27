import { describe, expect, it, vi } from "vitest";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { VersionedBlock } from "@repo/editor-core/document";
import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  createCollisionSafeBlockIdAllocator,
  reidentifyCanonicalBlockFragment,
  type CanonicalBlockFragment,
  type CanonicalBlockFragmentCandidate,
} from "@repo/editor-core/editing";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import {
  createEditorClipboardBoundary,
  exportCanonicalFragmentPlainText,
} from "@repo/editor-web/clipboard-runtime";
import { firstDraftBlockDefinitions } from "../../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../../first-draft-fixture.ts";
import {
  firstDraftTableClipboardCodecs,
  materializeFirstDraftTableCellRange,
} from "./clipboard.ts";

const validationProbe = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@repo/editor-core/editing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/editor-core/editing")>();
  return {
    ...actual,
    assertValidCanonicalBlockFragment: (...args: Parameters<
      typeof actual.assertValidCanonicalBlockFragment
    >) => {
      validationProbe.calls += 1;
      return actual.assertValidCanonicalBlockFragment(...args);
    },
  };
});

describe("First Draft table clipboard contribution", () => {
  it("materializes a backward 2x2 direct-cell table with fresh identities and TSV", () => {
    const snapshot = createFirstDraftSnapshot();
    const candidate = materializeFirstDraftTableCellRange({
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
    });
    validationProbe.calls = 0;
    const clipboard = new MemoryDataTransfer();
    const boundary = createEditorClipboardBoundary({
      blockDefinitions: firstDraftBlockDefinitions,
      plainTextImportBlockType: "paragraph",
      materializeSelection: () => candidate,
      plainTextExportHandlers:
        firstDraftTableClipboardCodecs.plainTextExportHandlers,
      htmlExportHandlers: firstDraftTableClipboardCodecs.htmlExportHandlers,
    });
    expect(
      boundary.writeSelection(
        clipboard.asDataTransfer(),
        {} as import("@repo/editor-react/selection").EditorSelectionSnapshot,
      ),
    ).toBe(true);
    expect(validationProbe.calls).toBe(1);
    expect(clipboard.writes).toEqual(["text/plain", "text/html"]);
    const fragment = finalizeCandidate(candidate);
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
      "Maya Chen",
      "In progress",
      "Noah Williams",
      "Ready for review",
    ]);
    expect(cells.every((cell) => cell.type === "tableCell")).toBe(true);
    expect(fragment!.blocks.some((block) => snapshot.blocks[block.id])).toBe(
      false,
    );
    const columns = table.metadata?.columnIds as string[];
    expect(columns).toHaveLength(2);
    expect(columns.every((columnId) => columnId.length > 0)).toBe(true);
    expect(new Set(columns).size).toBe(columns.length);
    expect(
      columns.some((columnId) =>
        fragment!.blocks.some((block) => block.id === columnId),
      ),
    ).toBe(false);
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
    ).toBe("Maya Chen\tIn progress\nNoah Williams\tReady for review");
  });

  it("materializes TSV and semantic HTML tables with table-owned column identities", () => {
    const plainTextHandler =
      firstDraftTableClipboardCodecs.plainTextImportHandlers?.[0];
    const htmlHandler = firstDraftTableClipboardCodecs.htmlImportHandlers?.[0];
    if (!plainTextHandler || !htmlHandler) {
      throw new Error("Missing First Draft table import handlers");
    }

    const tsv = plainTextHandler.importText("Ada\tIn progress\nMina\tPlanned", {
      blockDefinitions: firstDraftBlockDefinitions,
      defaultTextBlockType: "paragraph",
      limits: {
        maxCanonicalPayloadBytes: 1_000_000,
        maxHtmlBytes: 1_000_000,
        maxPlainTextBytes: 1_000_000,
        maxFragmentBlocks: 1_000,
        maxNestingDepth: 100,
        maxMetadataBytes: 1_000_000,
        maxRichTextBytes: 1_000_000,
        maxChildrenPerNode: 1_000,
      },
    });
    expectValidMaterializedTable(tsv, 2, [
      "Ada",
      "In progress",
      "Mina",
      "Planned",
    ]);

    const table = document.createElement("table");
    table.innerHTML =
      "<tbody><tr><td>Ada</td><td>In progress</td></tr><tr><td>Mina</td><td>Planned</td></tr></tbody>";
    const html = htmlHandler.parse(table, {
      blockDefinitions: firstDraftBlockDefinitions,
      plainTextBlockType: "paragraph",
      parseChildren: () => null,
      parseTextBlock(node, blockType) {
        const plainText = node.textContent ?? "";
        const record = createCanonicalBlockRecord({
          type: blockType,
          content: createBlockRichTextContentFromPlainText(
            blockType,
            plainText,
          ),
          plainText,
        });
        return createCanonicalBlockFragment({
          blocks: [record],
          rootBlockIds: [record.id],
          start: { kind: "text", blockId: record.id },
          end: { kind: "text", blockId: record.id },
          blockDefinitions: firstDraftBlockDefinitions,
        });
      },
    });
    expectValidMaterializedTable(html, 2, [
      "Ada",
      "In progress",
      "Mina",
      "Planned",
    ]);
  });

  it("reidentifies repeated table pastes without treating column ids as block ids", () => {
    const handler = firstDraftTableClipboardCodecs.plainTextImportHandlers?.[0];
    if (!handler) throw new Error("Missing First Draft TSV import handler");
    const detached = handler.importText("one\ttwo\nthree\tfour", {
      blockDefinitions: firstDraftBlockDefinitions,
      defaultTextBlockType: "paragraph",
      limits: {
        maxCanonicalPayloadBytes: 1_000_000,
        maxHtmlBytes: 1_000_000,
        maxPlainTextBytes: 1_000_000,
        maxFragmentBlocks: 1_000,
        maxNestingDepth: 100,
        maxMetadataBytes: 1_000_000,
        maxRichTextBytes: 1_000_000,
        maxChildrenPerNode: 1_000,
      },
    });
    if (!detached) throw new Error("Expected a detached TSV table");

    const first = reidentifyForPaste(detached, 100);
    const second = reidentifyForPaste(detached, 200);
    const firstIds = new Set(first.blocks.map((block) => block.id));
    const secondIds = new Set(second.blocks.map((block) => block.id));
    expect([...firstIds].some((blockId) => secondIds.has(blockId))).toBe(false);
    expect(
      [...firstIds].some((blockId) =>
        detached.blocks.some((block) => block.id === blockId),
      ),
    ).toBe(false);
    expect(
      [...secondIds].some((blockId) =>
        detached.blocks.some((block) => block.id === blockId),
      ),
    ).toBe(false);

    const firstTable = first.blocks.find((block) => block.type === "table")!;
    const secondTable = second.blocks.find((block) => block.type === "table")!;
    expect(firstTable.metadata?.columnIds).toEqual(
      secondTable.metadata?.columnIds,
    );
    expectValidMaterializedTable(first, 2, ["one", "two", "three", "four"]);
    expectValidMaterializedTable(second, 2, ["one", "two", "three", "four"]);
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

function expectValidMaterializedTable(
  fragment: CanonicalBlockFragment | null | undefined,
  columnCount: number,
  expectedCellText: readonly string[],
): void {
  expect(fragment).not.toBeNull();
  const table = fragment!.blocks.find((block) => block.type === "table");
  if (!table) throw new Error("Expected a materialized table");
  const blockIds = new Set(fragment!.blocks.map((block) => block.id));
  const columnIds = table.metadata?.columnIds as readonly string[];
  expect(columnIds).toHaveLength(columnCount);
  expect(columnIds.every((columnId) => columnId.length > 0)).toBe(true);
  expect(new Set(columnIds).size).toBe(columnIds.length);
  expect(columnIds.some((columnId) => blockIds.has(columnId as BlockId))).toBe(
    false,
  );
  expect(table.metadata).toMatchObject({ width: 0, viewId: "" });
  const widths = (table.metadata?.columnWidths ?? {}) as Readonly<
    Record<string, number>
  >;
  expect(
    Object.keys(widths).every((columnId) => columnIds.includes(columnId)),
  ).toBe(true);
  expect(
    fragment!.blocks
      .filter((block) => block.type === "tableCell")
      .map((block) => block.plainText),
  ).toEqual(expectedCellText);
}

function finalizeCandidate(
  candidate: CanonicalBlockFragmentCandidate | null,
): CanonicalBlockFragment | null {
  if (!candidate) return null;
  return createCanonicalBlockFragment({
    blocks: candidate.blocks,
    rootBlockIds: candidate.rootBlockIds,
    start: candidate.start,
    end: candidate.end,
    blockDefinitions: firstDraftBlockDefinitions,
  });
}

function reidentifyForPaste(
  fragment: CanonicalBlockFragment,
  firstSuffix: number,
): CanonicalBlockFragment {
  let suffix = firstSuffix;
  const allocator = createCollisionSafeBlockIdAllocator({
    createBlockId: () =>
      asBlockId(
        `01890f07-1c00-7000-8000-${String(suffix++).padStart(12, "0")}`,
      ),
    reservedBlockIds: new Set(fragment.blocks.map((block) => block.id)),
    isBlockIdReserved: () => false,
    purpose: "table clipboard test",
  });
  return reidentifyCanonicalBlockFragment({
    fragment,
    blockDefinitions: firstDraftBlockDefinitions,
    allocateBlockId: allocator.allocateBlockId,
  });
}

class MemoryDataTransfer {
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];

  setData(format: string, value: string): void {
    this.writes.push(format);
    this.values.set(format, value);
  }

  getData(format: string): string {
    return this.values.get(format) ?? "";
  }

  get types(): readonly string[] {
    return [...this.values.keys()];
  }

  asDataTransfer(): DataTransfer {
    return this as unknown as DataTransfer;
  }
}
