import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import {
  createCanonicalBlockFragment,
  materializeCanonicalBlockCreation,
  type CanonicalBlockFragment,
  type CanonicalBlockRecord,
  type MaterializedCanonicalBlockCreation,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import type { EditableEditor } from "@repo/editor-web/document-runtime";
import { createDefaultColumnMetadata } from "../blocks/columns/model.ts";
import {
  createFirstDraftTableColumnIds,
  createFirstDraftTableMetadata,
} from "../blocks/table/model.ts";
import { createFirstDraftBlockIdAllocator } from "../identity/block-id-allocator.ts";
import type { FirstDraftSlashAction } from "./catalog.ts";
import type { FirstDraftHeadingLevel } from "../heading-level.ts";

export function materializeFirstDraftSlashAction(
  action: FirstDraftSlashAction,
  editor: Pick<
    EditableEditor,
    "definition" | "getRootBlockIds" | "getChildBlockIds" | "getBlock"
  >,
): FirstDraftSlashMaterialization {
  const blockDefinitions = editor.definition.blocks;
  const reservedBlockIds = readLiveBlockIds(editor);
  const allocateBlockId = createFirstDraftBlockIdAllocator(editor, {
    reservedBlockIds,
    purpose: "First Draft block creation",
  });
  const common = {
    blockDefinitions,
    reservedBlockIds,
    createBlockId: allocateBlockId,
  } as const;
  switch (action.kind.type) {
    case "paragraph":
      return requireSelection(
        materializeCanonicalBlockCreation({
          ...common,
          type: "paragraph",
        }),
      );
    case "heading":
      return requireSelection(
        materializeCanonicalBlockCreation({
          ...common,
          type: "heading",
          metadata: { level: action.kind.level },
        }),
      );
    case "bulletList":
    case "orderedList":
    case "checklist":
    case "quote":
    case "toggleListItem":
      return requireSelection(
        materializeCanonicalBlockCreation({
          ...common,
          type: action.kind.type,
        }),
      );
    case "divider":
      return materializeDivider(
        blockDefinitions,
        reservedBlockIds,
        allocateBlockId,
      );
    case "code":
      return requireSelection(
        materializeCanonicalBlockCreation({
          ...common,
          type: "code",
          metadata: { language: "plaintext" },
        }),
      );
    case "callout":
      return requireSelection(
        materializeCanonicalBlockCreation({
          ...common,
          type: "callout",
          metadata: { icon: "idea" },
        }),
      );
    case "toggleHeading":
      return withNestedHeadingLevel(
        materializeCanonicalBlockCreation({
          ...common,
          type: "toggleHeading",
        }),
        action.kind.level,
        blockDefinitions,
      );
    case "columns":
      return materializeColumns(
        action.kind.count,
        blockDefinitions,
        reservedBlockIds,
        allocateBlockId,
      );
    case "tabs":
      return materializeTabs(
        blockDefinitions,
        reservedBlockIds,
        allocateBlockId,
      );
    case "table":
      return materializeTable(
        blockDefinitions,
        reservedBlockIds,
        allocateBlockId,
        3,
        3,
      );
  }
}

export interface FirstDraftSlashMaterialization {
  readonly fragment: CanonicalBlockFragment;
  readonly rootBlockId: BlockId;
  readonly selectionBlockId: BlockId;
}

function withNestedHeadingLevel(
  creation: MaterializedCanonicalBlockCreation,
  level: FirstDraftHeadingLevel,
  blockDefinitions: EditableEditor["definition"]["blocks"],
): FirstDraftSlashMaterialization {
  return recreateMaterialization(
    creation,
    creation.fragment.blocks.map((record) =>
      record.type === "heading" ? { ...record, metadata: { level } } : record,
    ),
    blockDefinitions,
  );
}

function materializeDivider(
  blockDefinitions: EditableEditor["definition"]["blocks"],
  reservedBlockIds: ReadonlySet<BlockId>,
  allocateBlockId: () => BlockId,
): FirstDraftSlashMaterialization {
  const common = {
    blockDefinitions,
    reservedBlockIds,
    createBlockId: allocateBlockId,
  } as const;
  const divider = materializeCanonicalBlockCreation({
    ...common,
    type: "divider",
  });
  const paragraph = requireSelection(
    materializeCanonicalBlockCreation({
      ...common,
      type: "paragraph",
    }),
  );
  return {
    fragment: createCanonicalBlockFragment({
      blocks: [...divider.fragment.blocks, ...paragraph.fragment.blocks],
      rootBlockIds: [divider.rootBlockId, paragraph.rootBlockId],
      start: { kind: "block", blockId: divider.rootBlockId },
      end: { kind: "text", blockId: paragraph.selectionBlockId },
      blockDefinitions,
    }),
    rootBlockId: divider.rootBlockId,
    selectionBlockId: paragraph.selectionBlockId,
  };
}

function materializeColumns(
  count: 2 | 3 | 4,
  blockDefinitions: EditableEditor["definition"]["blocks"],
  reservedBlockIds: ReadonlySet<BlockId>,
  allocateBlockId: () => BlockId,
): FirstDraftSlashMaterialization {
  const creation = materializeCanonicalBlockCreation({
    blockDefinitions,
    reservedBlockIds,
    createBlockId: allocateBlockId,
    type: "columns",
    defaultContentCount: count,
  });
  return recreateMaterialization(
    creation,
    creation.fragment.blocks.map((record) =>
      record.type === "column"
        ? { ...record, metadata: createDefaultColumnMetadata() }
        : record,
    ),
    blockDefinitions,
  );
}

function materializeTabs(
  blockDefinitions: EditableEditor["definition"]["blocks"],
  reservedBlockIds: ReadonlySet<BlockId>,
  allocateBlockId: () => BlockId,
): FirstDraftSlashMaterialization {
  const creation = materializeCanonicalBlockCreation({
    blockDefinitions,
    reservedBlockIds,
    createBlockId: allocateBlockId,
    type: "tabs",
    defaultContentCount: 2,
  });
  let paneIndex = 0;
  let selectionBlockId: BlockId | null = null;
  const blocks = creation.fragment.blocks.flatMap((record) => {
    if (record.type !== "tabPane") return [record];
    paneIndex += 1;
    const pane = {
      ...record,
      metadata: { tabId: `tab-${paneIndex}`, title: `Tab ${paneIndex}` },
    };
    const paragraph = createBlockRecord({
      id: allocateBlockId(),
      type: "paragraph",
      parentId: pane.id,
    });
    selectionBlockId ??= paragraph.id;
    return [
      pane,
      {
        id: paragraph.id,
        type: paragraph.type,
        parentId: paragraph.parentId,
        content: createBlockRichTextContentFromPlainText("paragraph", ""),
        plainText: "",
      },
    ];
  });
  if (!selectionBlockId) {
    throw new Error("First Draft tabs creation has no text selection target");
  }
  return {
    fragment: recreateFragment(creation.fragment, blocks, blockDefinitions),
    rootBlockId: creation.rootBlockId,
    selectionBlockId,
  };
}

function materializeTable(
  blockDefinitions: EditableEditor["definition"]["blocks"],
  reservedBlockIds: ReadonlySet<BlockId>,
  allocateBlockId: () => BlockId,
  rows: number,
  columns: number,
): FirstDraftSlashMaterialization {
  const columnIds = createFirstDraftTableColumnIds(columns);
  const base = materializeCanonicalBlockCreation({
    blockDefinitions,
    reservedBlockIds,
    createBlockId: allocateBlockId,
    type: "table",
    metadata: createFirstDraftTableMetadata(columnIds),
    defaultContentCount: rows,
  });
  const records: CanonicalBlockRecord[] = [];
  for (const record of base.fragment.blocks) {
    records.push(record);
    if (record.type !== "tableCell") continue;
    for (let index = 1; index < columns; index += 1) {
      const cell = createBlockRecord({
        id: allocateBlockId(),
        type: "tableCell",
        parentId: record.parentId,
      });
      records.push({
        id: cell.id,
        type: cell.type,
        parentId: cell.parentId,
        content: createBlockRichTextContentFromPlainText("tableCell", ""),
        plainText: "",
      });
    }
  }
  return recreateMaterialization(base, records, blockDefinitions);
}

function requireSelection(
  creation: MaterializedCanonicalBlockCreation,
): FirstDraftSlashMaterialization {
  if (!creation.selectionBlockId) {
    throw new Error("First Draft block creation has no selection target");
  }
  return creation as FirstDraftSlashMaterialization;
}

function recreateMaterialization(
  source: MaterializedCanonicalBlockCreation,
  blocks: readonly CanonicalBlockRecord[],
  blockDefinitions: EditableEditor["definition"]["blocks"],
): FirstDraftSlashMaterialization {
  const materialization = requireSelection(source);
  const fragment = recreateFragment(source.fragment, blocks, blockDefinitions);
  if (
    !fragment.blocks.some(({ id }) => id === materialization.rootBlockId) ||
    !fragment.blocks.some(({ id }) => id === materialization.selectionBlockId)
  ) {
    throw new Error(
      "First Draft fragment transformation changed creation identities",
    );
  }
  return {
    fragment,
    rootBlockId: materialization.rootBlockId,
    selectionBlockId: materialization.selectionBlockId,
  };
}

function recreateFragment(
  source: CanonicalBlockFragment,
  blocks: readonly CanonicalBlockRecord[],
  blockDefinitions: EditableEditor["definition"]["blocks"],
): CanonicalBlockFragment {
  return createCanonicalBlockFragment({
    blocks,
    rootBlockIds: source.rootBlockIds,
    start: source.start,
    end: source.end,
    blockDefinitions,
  });
}

export function readLiveBlockIds(
  editor: Pick<EditableEditor, "getRootBlockIds" | "getChildBlockIds" | "getBlock">,
): ReadonlySet<BlockId> {
  const result = new Set<BlockId>();
  const pending = [...editor.getRootBlockIds()];
  while (pending.length > 0) {
    const blockId = pending.pop()!;
    if (result.has(blockId)) continue;
    const block = editor.getBlock(blockId);
    if (!block || block.tombstone) continue;
    result.add(blockId);
    pending.push(...editor.getChildBlockIds(blockId));
  }
  return result;
}
