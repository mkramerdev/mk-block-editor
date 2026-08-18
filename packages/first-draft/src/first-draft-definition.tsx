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
  blockOperationCommands,
  blockOperationKeybindings,
} from "@repo/editor-web/block-operations";
import {
  conventionalHistoryCommands,
  conventionalHistoryKeybindings,
} from "@repo/editor-web/keybindings";
import {
  boldMarkDefinition,
  codeMarkDefinition,
  italicMarkDefinition,
  linkMarkDefinition,
  strikethroughMarkDefinition,
  underlineMarkDefinition,
} from "./inline/marks.ts";
import { firstDraftMentionDefinition } from "./inline/mentions.tsx";
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
  PlaceholderRenderer,
  QuoteRenderer,
  ToggleHeadingRenderer,
  ToggleListItemRenderer,
  TransparentWrapperRenderer,
} from "./blocks/core/renderers.tsx";
import { BookmarkRenderer } from "./blocks/media/renderers.tsx";
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
import {
  firstDraftTableCellBoundaryCommands,
  firstDraftTableCellBoundaryKeybindings,
} from "./blocks/table/table-cell-boundary-commands.ts";
import { validateFirstDraftTableStructure } from "./blocks/table/structural-validator.ts";
import { firstDraftBlockModelDefinitions } from "./server/block-definitions.ts";
import {
  COLLAPSED_TOGGLE_ENTER_COMMAND_ID,
  createCollapsedToggleEnterCommand,
} from "./blocks/toggle-list-item/collapsed-toggle-enter-command.ts";
import type { FirstDraftViewStateStore } from "./blocks/view-state.tsx";
import { firstDraftSlashTypingTrigger } from "./slash-menu/trigger.ts";

const paragraphDefinition = {
  ...firstDraftBlockModelDefinitions.paragraph,
  selection: contentSelection(),
  split: {
    default: "paragraph",
    bulletListItem: "bulletListItem",
    orderedListItem: "orderedListItem",
    checklistItem: "checklistItem",
    toggleListItem: "toggleListItem",
  },
  renderer: ParagraphRenderer,
} satisfies WebBlockDefinition<EditableEditor>;

const headingDefinition = {
  ...firstDraftBlockModelDefinitions.heading,
  selection: contentSelection(),
  split: { default: "paragraph" },
  renderer: HeadingRenderer,
} satisfies WebBlockDefinition<EditableEditor>;

function listItemDefinition(
  type: "bulletListItem" | "orderedListItem" | "checklistItem",
) {
  return {
    ...firstDraftBlockModelDefinitions[type],
    renderer:
      type === "checklistItem" ? ChecklistItemRenderer : ListItemRenderer,
    shellElement: "li",
  } satisfies WebBlockDefinition<EditableEditor>;
}

function listContainerDefinition(
  type: "bulletList" | "orderedList" | "checklist",
  shellElement: "ul" | "ol",
) {
  return {
    ...firstDraftBlockModelDefinitions[type],
    renderer:
      type === "checklist" ? ChecklistContainerRenderer : ListContainerRenderer,
    shellElement,
  } satisfies WebBlockDefinition<EditableEditor>;
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
    renderer: QuoteRenderer,
  },
  code: {
    ...firstDraftBlockModelDefinitions.code,
    renderer: CodeRenderer,
  },
  callout: {
    ...firstDraftBlockModelDefinitions.callout,
    renderer: CalloutRenderer,
  },
  toggleHeading: {
    ...firstDraftBlockModelDefinitions.toggleHeading,
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
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "never" },
    }),
    renderer: TransparentWrapperRenderer,
  },
  toggleListItem: {
    ...firstDraftBlockModelDefinitions.toggleListItem,
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
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "never" },
    }),
    renderer: TransparentWrapperRenderer,
  },
  divider: {
    ...firstDraftBlockModelDefinitions.divider,
    renderer: DividerRenderer,
  },
  bookmark: {
    ...firstDraftBlockModelDefinitions.bookmark,
    renderer: BookmarkRenderer,
  },
  columns: {
    ...firstDraftBlockModelDefinitions.columns,
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "multiple-selected-children" },
    }),
    renderer: ColumnsRenderer,
  },
  column: {
    ...firstDraftBlockModelDefinitions.column,
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "never" },
    }),
    renderer: ColumnRenderer,
  },
  tabs: {
    ...firstDraftBlockModelDefinitions.tabs,
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
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "never" },
    }),
    renderer: TabPaneRenderer,
  },
  placeholder: {
    ...firstDraftBlockModelDefinitions.placeholder,
    renderer: PlaceholderRenderer,
  },
  table: {
    ...firstDraftBlockModelDefinitions.table,
    selection: tableRangeSelectionModel(),
    renderer: TableRenderer,
  },
  tableRow: {
    ...firstDraftBlockModelDefinitions.tableRow,
    renderer: TableRowRenderer,
  },
  tableCell: {
    ...firstDraftBlockModelDefinitions.tableCell,
    selection: contentSelection(),
    renderer: TableCellRenderer,
  },
};

const firstDraftContentRuntimeDefinition: EditorContentRuntimeDefinition = {
  createRuntime: createYjsBlockContentRuntime,
};

export function createFirstDraftEditorDefinition(
  viewState: FirstDraftViewStateStore,
): EditableEditorDefinition {
  return {
    blocks: firstDraftBlockDefinitions,
    content: firstDraftContentRuntimeDefinition,
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
          const selected = viewState.getSnapshot().selectedTabs[blockId];
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
    },
    documentValidators: [validateFirstDraftTableStructure],
    commands: [
      createCollapsedToggleEnterCommand(viewState),
      ...firstDraftTableCellBoundaryCommands,
      ...conventionalHistoryCommands,
      ...blockOperationCommands,
    ],
    keybindings: [
      {
        key: "Enter",
        commandId: COLLAPSED_TOGGLE_ENTER_COMMAND_ID,
        scope: "block",
      },
      ...firstDraftTableCellBoundaryKeybindings,
      ...conventionalHistoryKeybindings,
      ...blockOperationKeybindings,
    ],
  };
}

export const firstDraftInlineMarks = Object.freeze([
  boldMarkDefinition,
  italicMarkDefinition,
  codeMarkDefinition,
  linkMarkDefinition,
  strikethroughMarkDefinition,
  underlineMarkDefinition,
]);

export const firstDraftInlineAtoms = Object.freeze([
  firstDraftMentionDefinition,
]);

function createFirstDraftContentCodecs(): EditorContentCodecs {
  return {
    htmlImportHandlers: [
      ...(firstDraftTableClipboardCodecs.htmlImportHandlers ?? []),
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
  wrapperType: "quote" | "code",
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
