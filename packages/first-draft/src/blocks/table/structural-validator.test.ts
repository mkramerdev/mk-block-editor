import { describe, expect, it } from "vitest";
import type { Block, BlockType } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { StructuralDocumentValidatorInput } from "@repo/editor-core/editing";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import { createFirstDraftEditorDefinition } from "../../first-draft-definition.tsx";
import { createFirstDraftViewStateStore } from "../view-state.tsx";
import { validateFirstDraftTableStructure } from "./structural-validator.ts";

const id = asBlockId;
const definitions = {} as Readonly<Record<BlockType, BlockDefinition>>;

describe("validateFirstDraftTableStructure", () => {
  it.each([[[1]], [[2, 2]], [[3, 3, 3]]])(
    "accepts a rectangular table with row widths %j",
    (widths) => {
      expect(
        validateFirstDraftTableStructure(tableGraph("table-a", widths)),
      ).toEqual([]);
    },
  );

  it("rejects unequal rows, empty rows, and empty tables", () => {
    expect(
      validateFirstDraftTableStructure(tableGraph("unequal", [2, 1])),
    ).toContain("table unequal rows must have equal cell counts");
    expect(
      validateFirstDraftTableStructure(tableGraph("empty-row", [1, 0])),
    ).toContain("table row empty-row-row-2 must have at least one cell");
    expect(
      validateFirstDraftTableStructure(tableGraph("empty-table", [])),
    ).toContain("table empty-table must have at least one row");
  });

  it("rejects invalid live direct child types", () => {
    const invalidTable = tableGraph("bad-table-child", [1]);
    const rowId = id("bad-table-child-row-1");
    invalidTable.blocks[rowId] = block(
      rowId,
      "paragraph",
      id("bad-table-child"),
    );
    expect(validateFirstDraftTableStructure(invalidTable)).toContain(
      "table bad-table-child may contain only table rows",
    );

    const invalidRow = tableGraph("bad-row-child", [1]);
    const cellId = id("bad-row-child-cell-1-1");
    invalidRow.blocks[cellId] = block(
      cellId,
      "paragraph",
      id("bad-row-child-row-1"),
    );
    expect(validateFirstDraftTableStructure(invalidRow)).toContain(
      "table row bad-row-child-row-1 may contain only table cells",
    );
  });

  it("validates only each affected owning table once", () => {
    const affected = tableGraph("affected", [2, 1]);
    const unrelated = tableGraph("unrelated", [3, 1]);
    const input = combine(affected, unrelated, [
      id("affected-cell-1-1"),
      id("affected-row-1"),
      id("affected-cell-1-1"),
    ]);
    const childReads = new Map<string, number>();
    input.childIdsByParentId = new Proxy(input.childIdsByParentId, {
      get(target, property, receiver) {
        if (typeof property === "string") {
          childReads.set(property, (childReads.get(property) ?? 0) + 1);
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(validateFirstDraftTableStructure(input)).toEqual([
      "table affected rows must have equal cell counts",
    ]);
    expect(childReads.get("affected")).toBe(1);
    expect(childReads.has("unrelated")).toBe(false);
  });

  it("does no table traversal for an unrelated paragraph-only candidate", () => {
    const graph = tableGraph("unrelated-table", [2, 1]);
    const paragraphId = id("paragraph");
    graph.blocks[paragraphId] = block(paragraphId, "paragraph", null);
    graph.rootBlockIds = [...graph.rootBlockIds, paragraphId];
    let childIndexReads = 0;
    graph.childIdsByParentId = new Proxy(graph.childIdsByParentId, {
      get(target, property, receiver) {
        if (typeof property === "string") childIndexReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    graph.candidateBlockIds = [paragraphId];

    expect(validateFirstDraftTableStructure(graph)).toEqual([]);
    expect(childIndexReads).toBe(0);
  });

  it("validates all live tables when candidate scope is absent", () => {
    const input = combine(
      tableGraph("first", [2, 1]),
      tableGraph("second", [1, 2]),
    );
    expect(validateFirstDraftTableStructure(input)).toEqual([
      "table first rows must have equal cell counts",
      "table second rows must have equal cell counts",
    ]);
  });

  it("is the validator registered by the editable definition", () => {
    const definition = createFirstDraftEditorDefinition(
      createFirstDraftViewStateStore(),
    );
    expect(definition.documentValidators).toEqual([
      validateFirstDraftTableStructure,
    ]);
  });
});

function tableGraph(
  tableIdValue: string,
  widths: readonly number[],
): MutableValidatorInput {
  const tableId = id(tableIdValue);
  const blocks: Record<BlockId, Block> = {
    [tableId]: block(tableId, "table", null),
  };
  const childIdsByParentId: Partial<Record<BlockId, readonly BlockId[]>> = {};
  const rowIds: BlockId[] = [];
  widths.forEach((width, rowIndex) => {
    const rowId = id(`${tableIdValue}-row-${rowIndex + 1}`);
    rowIds.push(rowId);
    blocks[rowId] = block(rowId, "tableRow", tableId);
    const cellIds: BlockId[] = [];
    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      const cellId = id(
        `${tableIdValue}-cell-${rowIndex + 1}-${columnIndex + 1}`,
      );
      cellIds.push(cellId);
      blocks[cellId] = block(cellId, "tableCell", rowId);
    }
    childIdsByParentId[rowId] = cellIds;
  });
  childIdsByParentId[tableId] = rowIds;
  return {
    blocks,
    rootBlockIds: [tableId],
    childIdsByParentId,
    blockDefinitions: definitions,
  };
}

function combine(
  first: MutableValidatorInput,
  second: MutableValidatorInput,
  candidateBlockIds?: readonly BlockId[],
): MutableValidatorInput {
  return {
    blocks: { ...first.blocks, ...second.blocks },
    rootBlockIds: [...first.rootBlockIds, ...second.rootBlockIds],
    childIdsByParentId: {
      ...first.childIdsByParentId,
      ...second.childIdsByParentId,
    },
    blockDefinitions: definitions,
    ...(candidateBlockIds === undefined ? {} : { candidateBlockIds }),
  };
}

function block(
  blockId: BlockId,
  type: BlockType,
  parentId: BlockId | null,
): Block {
  return { id: blockId, type, parentId, tombstone: null };
}

type MutableValidatorInput = Omit<
  StructuralDocumentValidatorInput,
  "blocks" | "rootBlockIds" | "childIdsByParentId" | "candidateBlockIds"
> & {
  blocks: Record<BlockId, Block>;
  rootBlockIds: BlockId[];
  childIdsByParentId: Partial<Record<BlockId, readonly BlockId[]>>;
  candidateBlockIds?: readonly BlockId[];
};
