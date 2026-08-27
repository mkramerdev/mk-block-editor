import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId, JsonValue } from "@repo/editor-core/kernel";
import { resolveColumnLayoutPresentation } from "../blocks/columns/model.ts";
import {
  resolveFirstDraftTableColumnIds,
  resolveFirstDraftTablePresentationColumnWidths,
} from "../blocks/table/model.ts";
import { firstDraftBlockModelDefinitions } from "../server/block-definitions.ts";
import type {
  FirstDraftBlockDragPresentationState,
  FirstDraftBlockDragPreviewBlock,
  FirstDraftBlockDragPreviewEditor,
  FirstDraftBlockDragPreviewNode,
  FirstDraftBlockDragPreviewViewState,
  FirstDraftBlockType,
} from "./document-drag-overlay-contracts.ts";
import { normalizeFirstDraftHeadingLevel } from "../heading-level.ts";

const knownFirstDraftBlockTypes = new Set<FirstDraftBlockType>(
  Object.keys(firstDraftBlockModelDefinitions) as FirstDraftBlockType[],
);
const textBlockTypes = new Set<FirstDraftBlockType>([
  "paragraph",
  "heading",
  "tableCell",
]);
const TABLE_MIN_WIDTH = 176;

/** Resolves one immutable, bounded visual snapshot from public synchronous reads. */
export function resolveFirstDraftBlockDragPreview(
  editor: FirstDraftBlockDragPreviewEditor,
  viewState: FirstDraftBlockDragPreviewViewState,
  blockId: BlockId,
): FirstDraftBlockDragPreviewNode | null {
  const visited = new Set<BlockId>();
  const source = editor.getBlock(blockId);
  if (!isPreviewableBlock(source)) return null;
  const externalTable = resolveExternalTablePresentation(editor, source);
  if (externalTable === "invalid") return null;

  const visit = (
    currentId: BlockId,
    expectedParentId: BlockId | null | undefined,
    orderedListOrdinal: number | null,
  ): FirstDraftBlockDragPreviewNode | null => {
    if (visited.has(currentId)) return null;
    visited.add(currentId);
    const current = currentId === blockId ? source : editor.getBlock(currentId);
    if (!isPreviewableBlock(current)) return null;
    const canonicalParentId = editor.getParentId(currentId);
    if (
      canonicalParentId !== current.parentId ||
      (expectedParentId !== undefined && canonicalParentId !== expectedParentId)
    ) {
      return null;
    }
    const childIds = [...editor.getChildBlockIds(currentId)];
    if (new Set(childIds).size !== childIds.length) return null;
    const content = textBlockTypes.has(current.type)
      ? readTextContent(editor, current)
      : null;
    if (textBlockTypes.has(current.type) && content === null) return null;

    const children: FirstDraftBlockDragPreviewNode[] = [];
    for (const [index, childId] of childIds.entries()) {
      const childOrdinal =
        current.type === "orderedList" ? index + 1 : null;
      const child = visit(childId, current.id, childOrdinal);
      if (!child) return null;
      children.push(child);
    }
    if (!hasValidFixedStructure(current.type, children)) return null;

    const block = cloneBlock(current);
    const presentation = capturePresentation({
      block,
      children,
      orderedListOrdinal,
      viewState,
      externalTable: currentId === blockId ? externalTable : null,
    });
    return Object.freeze({
      block,
      content: cloneRichText(content),
      children: Object.freeze(children),
      presentation,
    });
  };

  const externalOrdinal = resolveExternalOrderedListOrdinal(editor, source);
  if (externalOrdinal === "invalid") return null;
  return visit(blockId, undefined, externalOrdinal);
}

function readTextContent(
  editor: FirstDraftBlockDragPreviewEditor,
  block: FirstDraftBlockDragPreviewBlock,
): RichTextDocumentNodeJson | null {
  try {
    return editor.readBlockContent(block.id, block.type);
  } catch {
    return null;
  }
}

function resolveExternalOrderedListOrdinal(
  editor: FirstDraftBlockDragPreviewEditor,
  source: FirstDraftBlockDragPreviewBlock,
): number | null | "invalid" {
  if (source.type !== "orderedListItem") return null;
  if (!source.parentId) return "invalid";
  const parent = editor.getBlock(source.parentId);
  if (
    !isPreviewableBlock(parent) ||
    parent.type !== "orderedList" ||
    editor.getParentId(source.id) !== parent.id
  ) {
    return "invalid";
  }
  const siblings = editor.getChildBlockIds(parent.id);
  const index = siblings.indexOf(source.id);
  return index >= 0 && siblings.lastIndexOf(source.id) === index
    ? index + 1
    : "invalid";
}

function capturePresentation(input: {
  readonly block: FirstDraftBlockDragPreviewBlock;
  readonly children: readonly FirstDraftBlockDragPreviewNode[];
  readonly orderedListOrdinal: number | null;
  readonly viewState: FirstDraftBlockDragPreviewViewState;
  readonly externalTable: ExternalTablePresentationContext | null;
}): FirstDraftBlockDragPresentationState {
  const headingLevel =
    input.block.type === "heading"
      ? normalizeFirstDraftHeadingLevel(input.block.metadata?.level)
      : null;
  const checked =
    input.block.type === "checklistItem"
      ? input.block.metadata?.checked === true
      : null;
  const isToggle =
    input.block.type === "toggleHeading" ||
    input.block.type === "toggleListItem";
  const collapsed = isToggle
    ? input.viewState.isBlockCollapsed(input.block.id)
    : null;
  const selectedTabPaneId =
    input.block.type === "tabs"
      ? resolveSelectedPane(
          input.viewState.getSelectedTab(input.block.id),
          input.children.map((child) => child.block.id),
        )
      : null;
  const columns =
    input.block.type === "columns"
      ? resolveColumnLayoutPresentation({
          columnsId: input.block.id,
          records: input.children.map((child) => child.block),
        })
      : null;
  const table =
    input.block.type === "table"
      ? captureTablePresentation(input.block, input.children)
      : input.externalTable
        ? captureTablePresentationFromDimensions(
            input.externalTable.table,
            input.externalTable.rowCount,
            input.externalTable.columnCount,
          )
        : null;
  return Object.freeze({
    headingLevel,
    checked,
    orderedListOrdinal:
      input.block.type === "orderedListItem"
        ? input.orderedListOrdinal
        : null,
    collapsed,
    selectedTabPaneId,
    columns: columns
      ? Object.freeze({
          tracks: columns.tracks,
          orderedColumnIds: Object.freeze(
            columns.columns.map((column) => column.id),
          ),
          weights: Object.freeze(
            columns.columns.map((column) => column.weight),
          ),
        })
      : null,
    table,
  });
}

function captureTablePresentation(
  block: FirstDraftBlockDragPreviewBlock,
  rows: readonly FirstDraftBlockDragPreviewNode[],
) {
  const columnCount = rows[0]?.children.length ?? 0;
  return captureTablePresentationFromDimensions(
    block,
    rows.length,
    columnCount,
  );
}

function captureTablePresentationFromDimensions(
  block: FirstDraftBlockDragPreviewBlock,
  rowCount: number,
  columnCount: number,
) {
  const resolution = resolveFirstDraftTableColumnIds(
    block.metadata,
    columnCount,
  );
  const columnWidths = resolveFirstDraftTablePresentationColumnWidths(
    block.metadata,
    resolution,
  );
  const widths = Object.freeze({ ...columnWidths });
  return Object.freeze({
    columnIds: Object.freeze([...resolution.ids]),
    columnWidths: widths,
    tracks: resolution.ids
      .map((columnId) => `${widths[columnId] ?? TABLE_MIN_WIDTH}px`)
      .join(" "),
    rowCount,
    columnCount,
  });
}

interface ExternalTablePresentationContext {
  readonly table: FirstDraftBlockDragPreviewBlock;
  readonly rowCount: number;
  readonly columnCount: number;
}

function resolveExternalTablePresentation(
  editor: FirstDraftBlockDragPreviewEditor,
  source: FirstDraftBlockDragPreviewBlock,
): ExternalTablePresentationContext | null | "invalid" {
  if (source.type !== "tableRow" && source.type !== "tableCell") return null;
  const row =
    source.type === "tableRow"
      ? source
      : source.parentId
        ? editor.getBlock(source.parentId)
        : null;
  if (!isPreviewableBlock(row) || row.type !== "tableRow" || !row.parentId) {
    return "invalid";
  }
  const cellIds = editor.getChildBlockIds(row.id);
  if (
    cellIds.length === 0 ||
    new Set(cellIds).size !== cellIds.length ||
    (source.type === "tableCell" && !cellIds.includes(source.id))
  ) {
    return "invalid";
  }
  const table = editor.getBlock(row.parentId);
  if (!isPreviewableBlock(table) || table.type !== "table") return "invalid";
  const rowIds = editor.getChildBlockIds(table.id);
  if (
    rowIds.length === 0 ||
    new Set(rowIds).size !== rowIds.length ||
    !rowIds.includes(row.id) ||
    editor.getParentId(row.id) !== table.id
  ) {
    return "invalid";
  }
  return { table, rowCount: rowIds.length, columnCount: cellIds.length };
}

function hasValidFixedStructure(
  type: FirstDraftBlockType,
  children: readonly FirstDraftBlockDragPreviewNode[],
): boolean {
  const types = children.map((child) => child.block.type);
  switch (type) {
    case "paragraph":
    case "heading":
    case "tableCell":
    case "divider":
      return children.length === 0;
    case "bulletList":
      return children.length > 0 && types.every((value) => value === "bulletListItem");
    case "orderedList":
      return children.length > 0 && types.every((value) => value === "orderedListItem");
    case "checklist":
      return children.length > 0 && types.every((value) => value === "checklistItem");
    case "bulletListItem":
    case "orderedListItem":
    case "checklistItem":
      return types[0] === "paragraph";
    case "quote":
    case "code":
      return children.length === 1 && types[0] === "paragraph";
    case "callout":
    case "column":
      return children.length > 0;
    case "toggleHeading":
      return children.length === 2 && types[0] === "heading" && types[1] === "toggleHeadingBody";
    case "toggleListItem":
      return children.length === 2 && types[0] === "paragraph" && types[1] === "toggleListItemBody";
    case "toggleHeadingBody":
    case "toggleListItemBody":
    case "tabPane":
      return true;
    case "columns":
      return children.length >= 2 && types.every((value) => value === "column");
    case "tabs":
      return children.length > 0 && types.every((value) => value === "tabPane");
    case "table": {
      if (children.length === 0 || !types.every((value) => value === "tableRow")) return false;
      const width = children[0]?.children.length ?? 0;
      return width > 0 && children.every((row) => row.children.length === width);
    }
    case "tableRow":
      return children.length > 0 && types.every((value) => value === "tableCell");
  }
}

function isPreviewableBlock(
  block: VersionedBlock | null,
): block is FirstDraftBlockDragPreviewBlock {
  return Boolean(
    block &&
      block.tombstone === null &&
      knownFirstDraftBlockTypes.has(block.type as FirstDraftBlockType),
  );
}

function cloneBlock(
  block: FirstDraftBlockDragPreviewBlock,
): FirstDraftBlockDragPreviewBlock {
  return Object.freeze({
    ...block,
    ...(block.metadata
      ? { metadata: cloneJson(block.metadata) as FirstDraftBlockDragPreviewBlock["metadata"] }
      : {}),
    ...(block.tombstone ? { tombstone: Object.freeze({ ...block.tombstone }) } : {}),
  });
}

function cloneRichText(
  content: RichTextDocumentNodeJson | null,
): RichTextDocumentNodeJson | null {
  return content === null
    ? null
    : (cloneJson(content) as RichTextDocumentNodeJson);
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneJson));
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, cloneJson(child)]),
      ),
    );
  }
  return value;
}

function resolveSelectedPane(
  selected: BlockId | null,
  paneIds: readonly BlockId[],
): BlockId | null {
  return selected && paneIds.includes(selected) ? selected : paneIds[0] ?? null;
}
