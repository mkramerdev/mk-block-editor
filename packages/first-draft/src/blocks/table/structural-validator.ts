import type { Block, VersionedBlock } from "@repo/editor-core/document";
import type { StructuralDocumentValidator } from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";

const tableType = "table";
const tableRowType = "tableRow";
const tableCellType = "tableCell";

/** Stateless First Draft policy over the proposed final canonical block graph. */
export const validateFirstDraftTableStructure: StructuralDocumentValidator = (
  input,
) => {
  const tableIds = resolveTablesToValidate(input);
  const errors: string[] = [];
  for (const tableId of tableIds) {
    const table = liveBlock(input.blocks, tableId);
    if (!table || table.type !== tableType) continue;
    const rows = liveDirectChildren(input, table.id);
    if (rows.length === 0) {
      errors.push(`table ${table.id} must have at least one row`);
      continue;
    }
    if (rows.some((row) => row.type !== tableRowType)) {
      errors.push(`table ${table.id} may contain only table rows`);
      continue;
    }
    let expectedWidth: number | null = null;
    for (const row of rows) {
      const cells = liveDirectChildren(input, row.id);
      if (cells.length === 0) {
        errors.push(`table row ${row.id} must have at least one cell`);
        continue;
      }
      if (cells.some((cell) => cell.type !== tableCellType)) {
        errors.push(`table row ${row.id} may contain only table cells`);
        continue;
      }
      if (expectedWidth === null) {
        expectedWidth = cells.length;
      } else if (cells.length !== expectedWidth) {
        errors.push(`table ${table.id} rows must have equal cell counts`);
        break;
      }
    }
  }
  return errors;
};

function resolveTablesToValidate(
  input: Parameters<StructuralDocumentValidator>[0],
): ReadonlySet<BlockId> {
  if (input.candidateBlockIds === undefined) {
    return new Set(
      Object.values(input.blocks).flatMap((block) =>
        !block.tombstone && block.type === tableType ? [block.id] : [],
      ),
    );
  }
  const tableIds = new Set<BlockId>();
  for (const candidateId of input.candidateBlockIds) {
    let current = input.blocks[candidateId];
    const visited = new Set<BlockId>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.type === tableType) {
        if (!current.tombstone) tableIds.add(current.id);
        break;
      }
      current =
        current.parentId === null ? undefined : input.blocks[current.parentId];
    }
  }
  return tableIds;
}

function liveDirectChildren(
  input: Parameters<StructuralDocumentValidator>[0],
  parentId: BlockId,
): readonly (Block | VersionedBlock)[] {
  return (input.childIdsByParentId[parentId] ?? []).flatMap((childId) => {
    const child = liveBlock(input.blocks, childId);
    return child ? [child] : [];
  });
}

function liveBlock(
  blocks: Parameters<StructuralDocumentValidator>[0]["blocks"],
  blockId: BlockId,
): Block | VersionedBlock | null {
  const block = blocks[blockId];
  return block && !block.tombstone ? block : null;
}
