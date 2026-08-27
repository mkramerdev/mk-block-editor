import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  type CanonicalBlockFragment,
  type CanonicalBlockRecord,
} from "@repo/editor-core/editing";
import type { BlockId, JsonObject } from "@repo/editor-core/kernel";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  contentSelection,
  wrapperSelection,
} from "@repo/editor-core/selection";
import type { BlockType } from "@repo/editor-core/document";
import { richTextDocumentContentSize } from "@repo/editor-core/content/rich-text";
import type { StructuralEditRange } from "@repo/editor-core/editing";
import type { EditorSelectionSnapshot } from "@repo/editor-react/selection";
import type {
  EditorContentRuntimeDefinition,
  EditorContentCodecs,
  WebBlockDefinition,
} from "@repo/editor-web/document-runtime";
import type {
  EditableEditor,
  EditableEditorDefinition,
} from "@repo/editor-web/editor";
import { createYjsBlockContentRuntime } from "@repo/editor-yjs-dom";
import {
  conventionalHistoryCommands,
  conventionalHistoryKeybindings,
} from "@repo/editor-web/keybindings";
import {
  firstDraftInlineAtoms,
  firstDraftInlineMarks,
} from "./inline/definitions.ts";
import { firstDraftMentionTypingTrigger } from "./mention-menu/index.ts";
import {
  CalloutRenderer,
  ChecklistContainerRenderer,
  ChecklistItemRenderer,
  CodeRenderer,
  DividerRenderer,
  HeadingRenderer,
  ListContainerRenderer,
  ListItemRenderer,
  ParagraphRenderer,
  QuoteRenderer,
  ToggleHeadingRenderer,
  ToggleListItemRenderer,
  ToggleBodyRenderer,
} from "./blocks/core/renderers.tsx";
import {
  ColumnRenderer,
  ColumnsRenderer,
  TabPaneRenderer,
  TabsRenderer,
} from "./blocks/layout/renderers.tsx";
import {
  TableCellRenderer,
  TableRenderer,
  TableRowRenderer,
} from "./blocks/table/renderers.tsx";
import {
  tableInternalSelectionDefinition,
  tableRangeSelectionModel,
} from "./blocks/table/selection.ts";
import { firstDraftTableClipboardCodecs } from "./blocks/table/clipboard.ts";
import { validateFirstDraftTableStructure } from "./blocks/table/structural-validator.ts";
import { firstDraftBlockModelDefinitions } from "./server/block-definitions.ts";
import {
  createFirstDraftStructuralTextCommand,
  firstDraftStructuralTextKeybindings,
} from "./block-operations/structural-text-command.ts";
import { planFirstDraftStructuralRangeDeletion } from "./block-operations/structural-range-deletion.ts";
import type { FirstDraftViewStateStore } from "./blocks/view-state.tsx";
import { firstDraftSlashTypingTrigger } from "./slash-menu/trigger.ts";
import { normalizeFirstDraftHeadingLevel } from "./heading-level.ts";

export {
  firstDraftInlineAtoms,
  firstDraftInlineMarks,
} from "./inline/definitions.ts";

const paragraphDefinition = {
  ...firstDraftBlockModelDefinitions.paragraph,
  rootLayout: "normal",
  selection: contentSelection(),
  renderer: ParagraphRenderer,
} satisfies WebBlockDefinition<EditableEditor>;

const headingDefinition = {
  ...firstDraftBlockModelDefinitions.heading,
  rootLayout: "normal",
  selection: contentSelection(),
  renderer: HeadingRenderer,
} satisfies WebBlockDefinition<EditableEditor>;

function listItemDefinition(
  type: "bulletListItem" | "orderedListItem" | "checklistItem",
) {
  return {
    ...firstDraftBlockModelDefinitions[type],
    rootLayout: "normal",
    renderer:
      type === "checklistItem" ? ChecklistItemRenderer : ListItemRenderer,
    selection: firstDraftListItemSelection(),
    shellElement: "li",
  } satisfies WebBlockDefinition<EditableEditor>;
}

function listContainerDefinition(
  type: "bulletList" | "orderedList" | "checklist",
  shellElement: "ul" | "ol",
) {
  return {
    ...firstDraftBlockModelDefinitions[type],
    rootLayout: "normal",
    renderer:
      type === "checklist" ? ChecklistContainerRenderer : ListContainerRenderer,
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "selected-children" },
    }),
    shellElement,
  } satisfies WebBlockDefinition<EditableEditor>;
}

function firstDraftListItemSelection() {
  return wrapperSelection();
}

export const firstDraftBlockDefinitions: Readonly<
  Record<BlockType, WebBlockDefinition<EditableEditor>>
> = {
  paragraph: paragraphDefinition,
  heading: headingDefinition,
  bulletList: listContainerDefinition("bulletList", "ul"),
  orderedList: listContainerDefinition("orderedList", "ol"),
  checklist: listContainerDefinition("checklist", "ul"),
  bulletListItem: listItemDefinition("bulletListItem"),
  orderedListItem: listItemDefinition("orderedListItem"),
  checklistItem: listItemDefinition("checklistItem"),
  quote: {
    ...firstDraftBlockModelDefinitions.quote,
    rootLayout: "normal",
    renderer: QuoteRenderer,
  },
  code: {
    ...firstDraftBlockModelDefinitions.code,
    rootLayout: "normal",
    renderer: CodeRenderer,
  },
  callout: {
    ...firstDraftBlockModelDefinitions.callout,
    rootLayout: "normal",
    renderer: CalloutRenderer,
  },
  toggleHeading: {
    ...firstDraftBlockModelDefinitions.toggleHeading,
    rootLayout: "normal",
    selection: wrapperSelection({
      fragment: {
        kind: "wrapper",
        contentScope: "visible",
        preservedChildren: "all",
      },
    }),
    renderer: ToggleHeadingRenderer,
  },
  toggleHeadingBody: {
    ...firstDraftBlockModelDefinitions.toggleHeadingBody,
    rootLayout: "normal",
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "never" },
    }),
    renderer: ToggleBodyRenderer,
  },
  toggleListItem: {
    ...firstDraftBlockModelDefinitions.toggleListItem,
    rootLayout: "normal",
    selection: wrapperSelection({
      fragment: {
        kind: "wrapper",
        contentScope: "visible",
        preservedChildren: "all",
      },
    }),
    renderer: ToggleListItemRenderer,
  },
  toggleListItemBody: {
    ...firstDraftBlockModelDefinitions.toggleListItemBody,
    rootLayout: "normal",
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "never" },
    }),
    renderer: ToggleBodyRenderer,
  },
  divider: {
    ...firstDraftBlockModelDefinitions.divider,
    rootLayout: "normal",
    renderer: DividerRenderer,
  },
  columns: {
    ...firstDraftBlockModelDefinitions.columns,
    rootLayout: "normal",
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "multiple-selected-children" },
    }),
    renderer: ColumnsRenderer,
  },
  column: {
    ...firstDraftBlockModelDefinitions.column,
    rootLayout: "normal",
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "never" },
    }),
    renderer: ColumnRenderer,
  },
  tabs: {
    ...firstDraftBlockModelDefinitions.tabs,
    rootLayout: "normal",
    selection: wrapperSelection({
      fragment: {
        kind: "wrapper",
        contentScope: "visible",
        preservedChildren: "all",
      },
    }),
    renderer: TabsRenderer,
  },
  tabPane: {
    ...firstDraftBlockModelDefinitions.tabPane,
    rootLayout: "normal",
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "never" },
    }),
    renderer: TabPaneRenderer,
  },
  table: {
    ...firstDraftBlockModelDefinitions.table,
    rootLayout: "full",
    selection: tableRangeSelectionModel(),
    renderer: TableRenderer,
  },
  tableRow: {
    ...firstDraftBlockModelDefinitions.tableRow,
    rootLayout: "full",
    renderer: TableRowRenderer,
  },
  tableCell: {
    ...firstDraftBlockModelDefinitions.tableCell,
    rootLayout: "normal",
    selection: contentSelection(),
    renderer: TableCellRenderer,
  },
};

const firstDraftContentRuntimeDefinition: EditorContentRuntimeDefinition = {
  createRuntime: createYjsBlockContentRuntime,
};

export interface FirstDraftEditorDefinitionOptions {
  /**
   * `null` selects the editor-web canonical content runtime. Browser editing
   * otherwise uses First Draft's Yjs-backed runtime.
   */
  readonly contentRuntime?: EditorContentRuntimeDefinition | null;
}

export function createFirstDraftEditorDefinition(
  viewState: FirstDraftViewStateStore,
  options: FirstDraftEditorDefinitionOptions = {},
): EditableEditorDefinition {
  return {
    blocks: firstDraftBlockDefinitions,
    ...(options.contentRuntime === null
      ? {}
      : {
          content:
            options.contentRuntime ?? firstDraftContentRuntimeDefinition,
        }),
    inlineMarks: firstDraftInlineMarks,
    inlineAtoms: firstDraftInlineAtoms,
    typingTriggers: [
      firstDraftMentionTypingTrigger,
      firstDraftSlashTypingTrigger,
    ],
    blockInternalSelectionSubsystems: [tableInternalSelectionDefinition],
    defaultRoot: "paragraph",
    contentImport: { plainTextBlockType: "paragraph" },
    contentCodecs: createFirstDraftContentCodecs(),
    selectionFragment: {
      resolveVisibleChildBlockIds({ blockId, blockType, childBlockIds }) {
        if (blockType === "tabs") {
          const selected = viewState.getSelectedTab(blockId);
          const active =
            selected && childBlockIds.includes(selected)
              ? selected
              : childBlockIds[0];
          return active ? [active] : [];
        }
        if (
          (blockType === "toggleHeading" || blockType === "toggleListItem") &&
          viewState.isBlockCollapsed(blockId)
        ) {
          return childBlockIds.slice(0, 1);
        }
        return childBlockIds;
      },
      resolveStructuralEditRange: resolveFirstDraftStructuralEditRange,
      planStructuralRangeDeletion: (input) =>
        planFirstDraftStructuralRangeDeletion(input, viewState),
    },
    documentValidators: [validateFirstDraftTableStructure],
    commands: [
      createFirstDraftStructuralTextCommand(viewState),
      ...conventionalHistoryCommands,
    ],
    keybindings: [
      ...firstDraftStructuralTextKeybindings,
      ...conventionalHistoryKeybindings,
    ],
  };
}

function createFirstDraftContentCodecs(): EditorContentCodecs {
  return {
    htmlImportHandlers: [
      ...(firstDraftTableClipboardCodecs.htmlImportHandlers ?? []),
      createFirstDraftSemanticWrapperImportHandler(),
      {
        id: "first-draft.heading-import",
        elements: ["h1", "h2", "h3"],
        parse(node, context) {
          const match = /^h([1-3])$/u.exec(node.tagName.toLowerCase());
          return match
            ? context.parseTextBlock(node, "heading", {
                level: Number(match[1]),
              })
            : null;
        },
      },
      {
        id: "first-draft.divider-import",
        elements: ["hr"],
        parse(node, context) {
          if (node.tagName.toLowerCase() !== "hr") return null;
          const block = createCanonicalBlockRecord({ type: "divider" });
          return createCanonicalBlockFragment({
            blocks: [block],
            rootBlockIds: [block.id],
            start: { kind: "block", blockId: block.id },
            end: { kind: "block", blockId: block.id },
            blockDefinitions: context.blockDefinitions,
          });
        },
      },
      createWrapperImportHandler("blockquote", "quote"),
      createWrapperImportHandler("pre", "code"),
      {
        id: "first-draft.checklist-import",
        elements: ["ul"],
        parse(node, context) {
          return isChecklistList(node)
            ? parseFirstDraftList(node, "checklist", "checklistItem", context)
            : null;
        },
      },
      createListImportHandler("ul"),
      createListImportHandler("ol"),
    ],
    htmlExportHandlers: [
      ...(firstDraftTableClipboardCodecs.htmlExportHandlers ?? []),
      createFirstDraftSemanticWrapperExportHandler(),
      {
        id: "first-draft.heading-export",
        export(block, context) {
          if (block.type !== "heading") return null;
          const heading = context.document.createElement(
            `h${normalizeFirstDraftHeadingLevel(block.metadata?.level)}`,
          );
          const content = context.exportTextContent(block);
          if (content) heading.append(content);
          return heading;
        },
      },
      {
        id: "first-draft.divider-export",
        export(block, context) {
          return block.type === "divider"
            ? context.document.createElement("hr")
            : null;
        },
      },
      {
        id: "first-draft.quote-export",
        export(block, context) {
          if (block.type !== "quote") return null;
          const element = context.document.createElement("blockquote");
          element.append(context.exportChildren(block.id));
          return element;
        },
      },
      {
        id: "first-draft.code-export",
        export(block, context) {
          if (block.type !== "code") return null;
          const pre = context.document.createElement("pre");
          const code = context.document.createElement("code");
          code.textContent = context.fragment.blocks
            .filter((candidate) => candidate.parentId === block.id)
            .map((candidate) => candidate.plainText ?? "")
            .join("\n");
          pre.append(code);
          return pre;
        },
      },
      {
        id: "first-draft.list-container-export",
        preserveDataAttributes: ["data-editor-checklist"],
        export(block, context) {
          if (
            block.type !== "bulletList" &&
            block.type !== "orderedList" &&
            block.type !== "checklist"
          )
            return null;
          const list = context.document.createElement(
            block.type === "orderedList" ? "ol" : "ul",
          );
          if (block.type === "checklist") list.dataset.editorChecklist = "true";
          list.append(context.exportChildren(block.id));
          return list;
        },
      },
      {
        id: "first-draft.list-item-export",
        export(block, context) {
          if (
            block.type !== "bulletListItem" &&
            block.type !== "orderedListItem" &&
            block.type !== "checklistItem"
          )
            return null;
          const item = context.document.createElement("li");
          if (block.type === "checklistItem") {
            const checkbox = context.document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.disabled = true;
            checkbox.setAttribute("disabled", "");
            if (block.metadata?.checked === true) {
              checkbox.checked = true;
              checkbox.setAttribute("checked", "");
            }
            item.append(checkbox);
          }
          item.append(context.exportChildren(block.id));
          return item;
        },
      },
    ],
    plainTextImportHandlers:
      firstDraftTableClipboardCodecs.plainTextImportHandlers,
    plainTextExportHandlers:
      firstDraftTableClipboardCodecs.plainTextExportHandlers,
    internalSelectionFragmentMaterializers:
      firstDraftTableClipboardCodecs.internalSelectionFragmentMaterializers,
    internalSelectionCutHandlers:
      firstDraftTableClipboardCodecs.internalSelectionCutHandlers,
  };
}

const firstDraftListItemTypes = new Set<BlockType>([
  "bulletListItem",
  "orderedListItem",
  "checklistItem",
]);

function resolveFirstDraftStructuralEditRange(input: {
  readonly snapshot: EditorSelectionSnapshot;
  readonly range: StructuralEditRange;
  readonly graph: {
    getBlock(blockId: BlockId): import("@repo/editor-core/document").VersionedBlock | null;
    getParentId(blockId: BlockId): BlockId | null;
    getChildBlockIds(parentId: BlockId): readonly BlockId[];
    getRootBlockIds(): readonly BlockId[];
  };
  readonly readBlockContent: (
    blockId: BlockId,
    blockType: BlockType,
  ) => import("@repo/editor-core/content/rich-text").RichTextDocumentNodeJson | null;
}): StructuralEditRange | null {
  const selected = new Map(
    input.snapshot.rangeBlocks.map((entry) => [entry.blockId, entry]),
  );
  const completeItems = new Set<BlockId>();

  const completelySelected = (blockId: BlockId): boolean => {
    const block = input.graph.getBlock(blockId);
    if (!block) return false;
    const definition = firstDraftBlockDefinitions[block.type];
    const range = selected.get(blockId);
    const coverage = range?.coverage;
    if (definition?.kind !== "wrapper") {
      const content = input.readBlockContent(block.id, block.type);
      const size = content ? richTextDocumentContentSize(content) : null;
      return coverage === "complete-content" ||
        coverage === "complete-block" ||
        (coverage === "partial" &&
          size !== null &&
          (range?.startOffset ?? 0) === 0 &&
          (range?.endOffset ?? size) === size);
    }
    const children = input.graph.getChildBlockIds(blockId);
    return children.length > 0 && children.every(completelySelected);
  };

  for (const entry of input.snapshot.rangeBlocks) {
    let current = input.graph.getParentId(entry.blockId);
    while (current) {
      const block = input.graph.getBlock(current);
      if (!block) break;
      if (firstDraftListItemTypes.has(block.type)) {
        if (completelySelected(current)) completeItems.add(current);
        break;
      }
      current = input.graph.getParentId(current);
    }
  }
  if (completeItems.size === 0) return input.range;

  const emittedItems = new Set<BlockId>();
  const blocks = input.range.blocks.flatMap((entry) => {
    let current: BlockId | null = entry.blockId;
    while (current) {
      if (completeItems.has(current)) {
        if (emittedItems.has(current)) return [];
        emittedItems.add(current);
        const item = input.graph.getBlock(current);
        return item
          ? [{
              kind: "block" as const,
              blockId: item.id,
              blockType: item.type,
              parentId: item.parentId,
            }]
          : [];
      }
      current = input.graph.getParentId(current);
    }
    return [entry];
  });
  if (blocks.length === 0) return null;
  const boundary = (
    entry: (typeof blocks)[number],
    edge: "start" | "end",
  ): StructuralEditRange["start"] =>
    entry.kind === "block"
      ? { kind: "block", blockId: entry.blockId }
      : entry.kind === "text"
        ? {
            kind: "text",
            blockId: entry.blockId,
            offset: edge === "start" ? entry.from : entry.to,
          }
        : input.range[edge];
  return {
    ...input.range,
    blocks,
    start: boundary(blocks[0]!, "start"),
    end: boundary(blocks.at(-1)!, "end"),
  };
}

function createWrapperImportHandler(
  element: "blockquote" | "pre",
  wrapperType: "quote" | "code",
): NonNullable<EditorContentCodecs["htmlImportHandlers"]>[number] {
  return {
    id: `first-draft.${element}-import`,
    elements: [element],
    parse(node, context) {
      if (node.tagName.toLowerCase() !== element) return null;
      const text = context.parseTextBlock(node, "paragraph");
      if (!text || text.rootBlockIds.length !== 1) return null;
      return wrapFragment(text, wrapperType, context.blockDefinitions);
    },
  };
}

const firstDraftSemanticWrapperClasses = Object.freeze({
  "first-draft-semantic-callout": "callout",
  "first-draft-semantic-toggle-heading": "toggleHeading",
  "first-draft-semantic-toggle-heading-body": "toggleHeadingBody",
  "first-draft-semantic-toggle-list-item": "toggleListItem",
  "first-draft-semantic-toggle-list-item-body": "toggleListItemBody",
  "first-draft-semantic-columns": "columns",
  "first-draft-semantic-column": "column",
  "first-draft-semantic-tabs": "tabs",
  "first-draft-semantic-tab-pane": "tabPane",
} satisfies Readonly<Record<string, BlockType>>);

const firstDraftSemanticWrapperClassByType = new Map<BlockType, string>(
  Object.entries(firstDraftSemanticWrapperClasses).map(([className, type]) => [
    type,
    className,
  ]),
);

function createFirstDraftSemanticWrapperImportHandler(): NonNullable<
  EditorContentCodecs["htmlImportHandlers"]
>[number] {
  return {
    id: "first-draft.semantic-wrapper-import",
    parse(node, context) {
      const wrapperType = Object.entries(firstDraftSemanticWrapperClasses).find(
        ([className]) => node.classList.contains(className),
      )?.[1];
      if (!wrapperType) return null;
      const children = context.parseChildren(node);
      if (children) {
        return wrapFragment(children, wrapperType, context.blockDefinitions);
      }
      if (
        !isEmptySemanticWrapper(node) ||
        (wrapperType !== "toggleHeadingBody" &&
          wrapperType !== "toggleListItemBody" &&
          wrapperType !== "tabPane")
      ) {
        return null;
      }
      const wrapper = createCanonicalBlockRecord({ type: wrapperType });
      return createCanonicalBlockFragment({
        blocks: [wrapper],
        rootBlockIds: [wrapper.id],
        start: { kind: "block", blockId: wrapper.id },
        end: { kind: "block", blockId: wrapper.id },
        blockDefinitions: context.blockDefinitions,
      });
    },
  };
}

function isEmptySemanticWrapper(node: HTMLElement): boolean {
  return Array.from(node.childNodes).every(
    (child) => child.nodeType === 3 && !(child.textContent ?? "").trim(),
  );
}

function createFirstDraftSemanticWrapperExportHandler(): NonNullable<
  EditorContentCodecs["htmlExportHandlers"]
>[number] {
  return {
    id: "first-draft.semantic-wrapper-export",
    export(block, context) {
      const className = firstDraftSemanticWrapperClassByType.get(block.type);
      if (!className) return null;
      const tagName =
        block.type === "callout"
          ? "aside"
          : block.type === "toggleHeading" || block.type === "toggleListItem"
            ? "details"
            : "div";
      const element = context.document.createElement(tagName);
      element.className = className;
      element.append(context.exportChildren(block.id));
      return element;
    },
  };
}

function createListImportHandler(
  element: "ul" | "ol",
): NonNullable<EditorContentCodecs["htmlImportHandlers"]>[number] {
  return {
    id: `first-draft.${element}-import`,
    elements: [element],
    parse(node, context) {
      if (node.tagName.toLowerCase() !== element) return null;
      if (element === "ul" && isChecklistList(node)) return null;
      return parseFirstDraftList(
        node,
        element === "ul" ? "bulletList" : "orderedList",
        element === "ul" ? "bulletListItem" : "orderedListItem",
        context,
      );
    },
  };
}

type FirstDraftListContainerType = "bulletList" | "orderedList" | "checklist";
type FirstDraftListItemType =
  | "bulletListItem"
  | "orderedListItem"
  | "checklistItem";

function parseFirstDraftList(
  listElement: HTMLElement,
  containerType: FirstDraftListContainerType,
  itemType: FirstDraftListItemType,
  context: Parameters<
    NonNullable<EditorContentCodecs["htmlImportHandlers"]>[number]["parse"]
  >[1],
): CanonicalBlockFragment | null {
  const container = createCanonicalBlockRecord({ type: containerType });
  const blocks: CanonicalBlockRecord[] = [container];
  const itemIds: BlockId[] = [];
  for (const child of Array.from(listElement.children)) {
    if (!(child instanceof HTMLElement) || child.tagName.toLowerCase() !== "li")
      continue;
    const checkbox = directCheckbox(child);
    const textSource = child.cloneNode(true) as HTMLElement;
    for (const nested of Array.from(textSource.children)) {
      const tag = nested.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol" || tag === "input") nested.remove();
    }
    const text = context.parseTextBlock(textSource, "paragraph");
    if (!text || text.rootBlockIds.length !== 1) continue;
    const metadata: JsonObject | undefined =
      itemType === "checklistItem"
        ? { checked: checkbox?.checked === true }
        : undefined;
    const item = createCanonicalBlockRecord({
      type: itemType,
      parentId: container.id,
      ...(metadata ? { metadata } : {}),
    });
    itemIds.push(item.id);
    blocks.push(item);
    const textRoots = new Set(text.rootBlockIds);
    blocks.push(
      ...text.blocks.map((record) =>
        textRoots.has(record.id) ? { ...record, parentId: item.id } : record,
      ),
    );
    for (const nested of Array.from(child.children)) {
      const tag = nested.tagName.toLowerCase();
      const nestedTypes =
        tag === "ol"
          ? (["orderedList", "orderedListItem"] as const)
          : tag === "ul" && isChecklistList(nested as HTMLElement)
            ? (["checklist", "checklistItem"] as const)
            : tag === "ul"
              ? (["bulletList", "bulletListItem"] as const)
              : null;
      if (!nestedTypes) continue;
      const nestedFragment = parseFirstDraftList(
        nested as HTMLElement,
        nestedTypes[0],
        nestedTypes[1],
        context,
      );
      if (!nestedFragment) continue;
      const roots = new Set(nestedFragment.rootBlockIds);
      blocks.push(
        ...nestedFragment.blocks.map((record) =>
          roots.has(record.id) ? { ...record, parentId: item.id } : record,
        ),
      );
    }
  }
  if (itemIds.length === 0) return null;
  return createCanonicalBlockFragment({
    blocks,
    rootBlockIds: [container.id],
    start: { kind: "block", blockId: container.id },
    end: { kind: "block", blockId: container.id },
    blockDefinitions: context.blockDefinitions,
  });
}

function directCheckbox(item: HTMLElement): HTMLInputElement | null {
  return (
    Array.from(item.children).find(
      (child): child is HTMLInputElement =>
        child instanceof HTMLInputElement && child.type === "checkbox",
    ) ?? null
  );
}

function isChecklistList(list: HTMLElement): boolean {
  if (list.tagName.toLowerCase() !== "ul") return false;
  if (list.dataset.editorChecklist === "true") return true;
  const items = Array.from(list.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.tagName.toLowerCase() === "li",
  );
  return items.length > 0 && items.every((item) => directCheckbox(item));
}

function wrapFragment(
  fragment: CanonicalBlockFragment,
  wrapperType: BlockType,
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
): CanonicalBlockFragment | null {
  const wrapper = createCanonicalBlockRecord({ type: wrapperType });
  const roots = new Set(fragment.rootBlockIds);
  return createCanonicalBlockFragment({
    blocks: [
      wrapper,
      ...fragment.blocks.map((block) =>
        roots.has(block.id) ? { ...block, parentId: wrapper.id } : block,
      ),
    ],
    rootBlockIds: [wrapper.id],
    start: { kind: "block", blockId: wrapper.id },
    end: { kind: "block", blockId: wrapper.id },
    blockDefinitions,
  });
}
