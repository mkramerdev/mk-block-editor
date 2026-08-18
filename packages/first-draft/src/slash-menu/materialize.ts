import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import {
  createCanonicalBlockFragment,
  materializeCanonicalBlockCreation,
  type CanonicalBlockFragment,
  type CanonicalBlockRecord,
  type MaterializedCanonicalBlockCreation,
} from "@repo/editor-core/editing";
import { createBlockId, type BlockId } from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import type { Editor } from "@repo/editor-web/document-runtime";
import { createDefaultColumnMetadata } from "../blocks/columns/model.ts";
import {
  createFirstDraftTableColumnIds,
  createFirstDraftTableMetadata,
} from "../blocks/table/model.ts";
import { firstDraftBlockDefinitions } from "../first-draft-definition.tsx";
import type { FirstDraftSlashAction } from "./catalog.ts";

export function materializeFirstDraftSlashAction(
  action: FirstDraftSlashAction,
  editor: Pick<Editor, "getRootBlockIds" | "getChildBlockIds" | "getBlock">,
): FirstDraftSlashMaterialization {
  const reservedBlockIds = readLiveBlockIds(editor);
  const common = {
    blockDefinitions: firstDraftBlockDefinitions,
    reservedBlockIds,
  } as const;
  switch (action.kind.type) {
    case "paragraph":
      return requireSelection(materializeCanonicalBlockCreation({
        ...common,
        type: "paragraph",
      }));
    case "heading":
      return requireSelection(materializeCanonicalBlockCreation({
        ...common,
        type: "heading",
        metadata: { level: action.kind.level },
      }));
    case "bulletList":
    case "orderedList":
    case "checklist":
    case "quote":
    case "toggleListItem":
    case "divider":
      return requireSelection(materializeCanonicalBlockCreation({
        ...common,
        type: action.kind.type,
      }));
    case "code":
      return requireSelection(materializeCanonicalBlockCreation({
        ...common,
        type: "code",
        metadata: { language: "plaintext" },
      }));
    case "callout":
      return requireSelection(materializeCanonicalBlockCreation({
        ...common,
        type: "callout",
        metadata: { icon: "idea" },
      }));
    case "toggleHeading":
      return withNestedHeadingLevel(
        materializeCanonicalBlockCreation({
          ...common,
          type: "toggleHeading",
        }),
        action.kind.level,
      );
    case "bookmark":
      return requireSelection(materializeCanonicalBlockCreation({
        ...common,
        type: "bookmark",
        metadata: { url: "" },
      }));
    case "columns":
      return materializeColumns(action.kind.count, reservedBlockIds);
    case "tabs":
      return materializeTabs(reservedBlockIds);
    case "table":
      return materializeTable(reservedBlockIds, 3, 3);
  }
}

export interface FirstDraftSlashMaterialization {
  readonly fragment: CanonicalBlockFragment;
  readonly rootBlockId: BlockId;
  readonly selectionBlockId: BlockId;
}

function withNestedHeadingLevel(
  creation: MaterializedCanonicalBlockCreation,
  level: number,
): FirstDraftSlashMaterialization {
  return recreateMaterialization(
    creation,
    creation.fragment.blocks.map((record) =>
      record.type === "heading" ? { ...record, metadata: { level } } : record,
    ),
  );
}

function materializeColumns(
  count: 2 | 3 | 4,
  reservedBlockIds: ReadonlySet<BlockId>,
): FirstDraftSlashMaterialization {
  const creation = materializeCanonicalBlockCreation({
    blockDefinitions: firstDraftBlockDefinitions,
    reservedBlockIds,
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
  );
}

function materializeTabs(
  reservedBlockIds: ReadonlySet<BlockId>,
): FirstDraftSlashMaterialization {
  const creation = materializeCanonicalBlockCreation({
    blockDefinitions: firstDraftBlockDefinitions,
    reservedBlockIds,
    type: "tabs",
    defaultContentCount: 2,
  });
  let paneIndex = 0;
  return recreateMaterialization(
    creation,
    creation.fragment.blocks.map((record) => {
      if (record.type === "tabPane") {
        paneIndex += 1;
        return {
          ...record,
          metadata: { tabId: `tab-${paneIndex}`, title: `Tab ${paneIndex}` },
        };
      }
      if (record.type !== "placeholder") return record;
      return {
        ...record,
        type: "paragraph",
        content: createBlockRichTextContentFromPlainText("paragraph", ""),
        plainText: "",
      };
    }),
  );
}

function materializeTable(
  reservedBlockIds: ReadonlySet<BlockId>,
  rows: number,
  columns: number,
): FirstDraftSlashMaterialization {
  const columnIds = createFirstDraftTableColumnIds(columns);
  const base = materializeCanonicalBlockCreation({
    blockDefinitions: firstDraftBlockDefinitions,
    reservedBlockIds,
    type: "table",
    metadata: createFirstDraftTableMetadata(columnIds),
    defaultContentCount: rows,
  });
  const allocated = new Set<BlockId>([
    ...reservedBlockIds,
    ...base.fragment.blocks.map(({ id }) => id),
  ]);
  const allocate = (): BlockId => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = createBlockId();
      if (!allocated.has(id)) {
        allocated.add(id);
        return id;
      }
    }
    throw new Error("unable to allocate unique table cell ids");
  };
  const records: CanonicalBlockRecord[] = [];
  for (const record of base.fragment.blocks) {
    records.push(record);
    if (record.type !== "tableCell") continue;
    for (let index = 1; index < columns; index += 1) {
      const cell = createBlockRecord({
        id: allocate(),
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
  return recreateMaterialization(base, records);
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
): FirstDraftSlashMaterialization {
  const materialization = requireSelection(source);
  const fragment = recreateFragment(source.fragment, blocks);
  if (
    !fragment.blocks.some(({ id }) => id === materialization.rootBlockId) ||
    !fragment.blocks.some(({ id }) => id === materialization.selectionBlockId)
  ) {
    throw new Error("First Draft fragment transformation changed creation identities");
  }
  return Object.freeze({
    fragment,
    rootBlockId: materialization.rootBlockId,
    selectionBlockId: materialization.selectionBlockId,
  });
}

function recreateFragment(
  source: CanonicalBlockFragment,
  blocks: readonly CanonicalBlockRecord[],
): CanonicalBlockFragment {
  return createCanonicalBlockFragment({
    blocks,
    rootBlockIds: source.rootBlockIds,
    start: source.start,
    end: source.end,
    blockDefinitions: firstDraftBlockDefinitions,
  });
}

export function readLiveBlockIds(
  editor: Pick<Editor, "getRootBlockIds" | "getChildBlockIds" | "getBlock">,
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
