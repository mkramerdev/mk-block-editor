import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  type CanonicalBlockFragment,
  type CanonicalBlockRecord,
} from "@repo/editor-core/editing";
import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  richTextDocumentWithInlineContent,
  type RichTextInlineNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockId, JsonObject } from "@repo/editor-core/kernel";
import { createDefaultColumnMetadata } from "./blocks/columns/model.ts";
import {
  TABLE_COLUMN_IDS_FIELD,
  TABLE_COLUMN_WIDTHS_FIELD,
} from "./blocks/table/model.ts";
import { firstDraftBlockModelDefinitions } from "./server/block-definitions.ts";

const id = (value: string) => value as BlockId;

/**
 * Creates the canonical, browser-safe First Draft showcase document. Stable
 * identities make seed checkpoints repeatable; live insertion must reidentify
 * this fragment before it enters an editor.
 */
export function createFirstDraftDocumentTemplate(): CanonicalBlockFragment {
  return createFirstDraftDocumentTemplateInternal(false);
}

/** Builds the broad deterministic document used by block-family integration tests. */
export function createFirstDraftFixtureDocumentTemplate(): CanonicalBlockFragment {
  return createFirstDraftDocumentTemplateInternal(true);
}

function createFirstDraftDocumentTemplateInternal(
  includeExtendedTestContent: boolean,
): CanonicalBlockFragment {
  const blocks: CanonicalBlockRecord[] = [];
  const rootBlockIds: BlockId[] = [];

  const addBlock = (
    blockId: string,
    type: BlockType,
    options: {
      readonly parentId?: string;
      readonly metadata?: JsonObject;
    } = {},
  ): BlockId => {
    const block = createCanonicalBlockRecord({
      id: id(blockId),
      type,
      parentId: options.parentId ? id(options.parentId) : null,
      ...(options.metadata ? { metadata: options.metadata } : {}),
    });
    blocks.push(block);
    if (block.parentId === null) rootBlockIds.push(block.id);
    return block.id;
  };

  const addText = (
    blockId: string,
    type: "heading" | "paragraph" | "tableCell",
    inlineContent: readonly RichTextInlineNodeJson[],
    options: {
      readonly parentId?: string;
      readonly metadata?: JsonObject;
    } = {},
  ): BlockId => {
    const content = richTextDocumentWithInlineContent(
      type,
      createBlockRichTextContentFromPlainText(type, ""),
      inlineContent,
    );
    const block = createCanonicalBlockRecord({
      id: id(blockId),
      type,
      parentId: options.parentId ? id(options.parentId) : null,
      ...(options.metadata ? { metadata: options.metadata } : {}),
      content,
      plainText: extractPlainTextFromRichTextDocument(content),
    });
    blocks.push(block);
    if (block.parentId === null) rootBlockIds.push(block.id);
    return block.id;
  };

  const addPlainText = (
    blockId: string,
    type: "heading" | "paragraph" | "tableCell",
    text: string,
    options: {
      readonly parentId?: string;
      readonly metadata?: JsonObject;
    } = {},
  ) => addText(blockId, type, text ? [{ type: "text", text }] : [], options);

  addPlainText("fd-heading-1", "heading", "Welcome to my Block Editor ✨", {
    metadata: { level: 1 },
  });
  addBlock("fd-quote", "quote");
  addText(
    "fd-quote-text",
    "paragraph",
    [
      {
        type: "text",
        text: "This is a work in progress.",
        marks: [{ type: "strong" }],
      },
      { type: "hard_break" },
      {
        type: "text",
        text: "Nonetheless, you can try it out with someone else and collaborate in real time. Just copy the URL and share it, or open it in a separate incognito tab.",
      },
    ],
    { parentId: "fd-quote" },
  );
  addText("fd-paragraph-intro", "paragraph", [
    { type: "text", text: "Start writing your thoughts here... ✏️" },
    { type: "hard_break" },
    { type: "text", text: "For example with a " },
    { type: "text", text: "code block:", marks: [{ type: "strong" }] },
  ]);
  addBlock("fd-code", "code", { metadata: { language: "csharp" } });
  addText(
    "fd-code-text",
    "paragraph",
    [
      { type: "text", text: "public sealed class EditorBlock" },
      { type: "hard_break" },
      { type: "text", text: "{" },
      { type: "hard_break" },
      { type: "text", text: "    public required string Id { get; init; }" },
      { type: "hard_break" },
      {
        type: "text",
        text: "    public string Content { get; set; } = string.Empty;",
      },
      { type: "hard_break" },
      { type: "text", text: "}" },
    ],
    { parentId: "fd-code" },
  );
  addPlainText(
    "fd-paragraph-byline",
    "paragraph",
    "Or type / to open the command menu to discover different kinds of blocks.",
  );
  addBlock("fd-divider", "divider");
  addPlainText(
    "fd-heading-2",
    "heading",
    "Customize the editor to your needs",
    {
      metadata: { level: 2 },
    },
  );

  addBlock("fd-bullet-list", "bulletList");
  const bulletItems = [
    [
      "fd-bullet-1",
      "fd-bullet-1-text",
      "Every block owns its structure and behavior, allowing features to stay isolated.",
    ],
    [
      "fd-bullet-2",
      "fd-bullet-2-text",
      "Wrapper blocks control exactly which child blocks they accept.",
    ],
    [
      "fd-bullet-nested",
      "fd-bullet-nested-text",
      "Block-level operations make content easier to move, replace, compose, and extend.",
    ],
  ] as const;
  for (const [itemId, textId, text] of bulletItems) {
    addBlock(itemId, "bulletListItem", { parentId: "fd-bullet-list" });
    addPlainText(textId, "paragraph", text, { parentId: itemId });
  }

  addBlock("fd-callout", "callout", { metadata: { icon: "note" } });
  addText(
    "fd-callout-text",
    "paragraph",
    [
      {
        type: "text",
        text: "This editor is currently being rewritten to make the package structure easier to work with and more flexible. You can check out the repo for this editor ",
      },
      {
        type: "text",
        text: "here",
        marks: [{ type: "link", attrs: { href: "https://google.com" } }],
      },
      {
        type: "text",
        text: ", but beware: it does not reflect the final version that will be released on npm.",
      },
    ],
    { parentId: "fd-callout" },
  );
  addPlainText("fd-empty-after-callout", "paragraph", "");
  addPlainText(
    "fd-heading-tables",
    "heading",
    "✅ Interactive Tables included",
    {
      metadata: { level: 2 },
    },
  );
  addPlainText(
    "fd-paragraph-tables",
    "paragraph",
    "When ready, the editor will be released with an optional block starter kit which will include tables, lists, headings, tabs, and a lot more with collaboration-ready configuration.",
  );

  const tableColumnIds = [
    "fd-table-column-a",
    "fd-table-column-b",
    "fd-table-column-c",
  ];
  addBlock("fd-table", "table", {
    metadata: {
      width: 0,
      viewId: "first-draft-showcase-table",
      [TABLE_COLUMN_IDS_FIELD]: tableColumnIds,
      [TABLE_COLUMN_WIDTHS_FIELD]: {
        [tableColumnIds[0]!]: 208,
        [tableColumnIds[1]!]: 208,
        [tableColumnIds[2]!]: 208,
      },
    },
  });
  const tableValues = [
    ["Assignment", "Assignee", "Status"],
    ["Research brief", "Maya Chen", "In progress"],
    ["Interactive prototype", "Noah Williams", "Ready for review"],
    ["Final presentation", "Ava Patel", "Not started"],
  ];
  tableValues.forEach((row, rowIndex) => {
    const rowId = `fd-table-row-${rowIndex + 1}`;
    addBlock(rowId, "tableRow", { parentId: "fd-table" });
    row.forEach((value, columnIndex) =>
      addText(
        `fd-table-cell-${rowIndex + 1}-${columnIndex + 1}`,
        "tableCell",
        [
          rowIndex === 0
            ? { type: "text", text: value, marks: [{ type: "strong" }] }
            : { type: "text", text: value },
        ],
        { parentId: rowId },
      ),
    );
  });
  addPlainText(
    "fd-paragraph-after-table",
    "paragraph",
    "Even with interactive rows and cells, the table still behaves as one top-level block that can be moved or replaced as a unit.",
  );
  addPlainText("fd-empty-after-table", "paragraph", "");

  addPlainText(
    "fd-heading-actions",
    "heading",
    "Turn ideas into actionable plans with a checklist",
    { metadata: { level: 2 } },
  );
  addBlock("fd-checklist", "checklist");
  const checklistItems = [
    [
      "fd-check-unchecked",
      "fd-check-unchecked-text",
      false,
      "Try editing a paragraph together.",
    ],
    [
      "fd-check-checked",
      "fd-check-checked-text",
      true,
      "Explore the command menu.",
    ],
    [
      "fd-check-copy",
      "fd-check-copy-text",
      false,
      "Share the URL with a collaborator.",
    ],
    [
      "fd-check-reorder",
      "fd-check-reorder-text",
      false,
      "Drag blocks into a new order.",
    ],
    [
      "fd-check-toggle",
      "fd-check-toggle-text",
      false,
      "Open a toggle to reveal more details.",
    ],
    [
      "fd-check-layouts",
      "fd-check-layouts-text",
      false,
      "Explore tables, columns, and tabs.",
    ],
  ] as const;
  for (const [itemId, textId, checked, text] of checklistItems) {
    addBlock(itemId, "checklistItem", {
      parentId: "fd-checklist",
      metadata: { checked },
    });
    addPlainText(textId, "paragraph", text, { parentId: itemId });
  }

  if (!includeExtendedTestContent) {
    return createCanonicalBlockFragment({
      blocks,
      rootBlockIds,
      start: { kind: "text", blockId: id("fd-heading-1") },
      end: { kind: "text", blockId: id("fd-check-layouts-text") },
      blockDefinitions: firstDraftBlockModelDefinitions,
    });
  }

  addBlock("fd-toggle-heading", "toggleHeading");
  addPlainText(
    "fd-toggle-heading-summary",
    "heading",
    "How does real-time collaboration work?",
    {
      parentId: "fd-toggle-heading",
      metadata: { level: 3 },
    },
  );
  addBlock("fd-toggle-heading-body", "toggleHeadingBody", {
    parentId: "fd-toggle-heading",
  });
  addPlainText(
    "fd-toggle-heading-body-text",
    "paragraph",
    "Edits travel as ordinary transactions, while selections and presence help everyone understand where the others are working.",
    { parentId: "fd-toggle-heading-body" },
  );
  addPlainText(
    "fd-toggle-heading-body-detail",
    "paragraph",
    "The shared document converges without broadcasting local presentation choices such as whether a toggle is collapsed.",
    { parentId: "fd-toggle-heading-body" },
  );
  addBlock("fd-toggle-heading-second", "toggleHeading");
  addPlainText(
    "fd-toggle-heading-second-summary",
    "heading",
    "What happens when two people edit at once?",
    {
      parentId: "fd-toggle-heading-second",
      metadata: { level: 3 },
    },
  );
  addBlock("fd-toggle-heading-second-body", "toggleHeadingBody", {
    parentId: "fd-toggle-heading-second",
  });
  addPlainText(
    "fd-toggle-heading-second-body-text",
    "paragraph",
    "Concurrent changes are merged into the shared document while each collaborator keeps their own local interface state.",
    { parentId: "fd-toggle-heading-second-body" },
  );
  addPlainText(
    "fd-paragraph-after-goals",
    "paragraph",
    "Open and close the explanation whenever you need the extra context.",
  );

  addPlainText("fd-heading-3", "heading", "Build repeatable workflows", {
    metadata: { level: 2 },
  });
  addPlainText(
    "fd-paragraph-before-rollout",
    "paragraph",
    "Ordered steps make a lightweight workflow easy to follow and easy to revise.",
  );
  addBlock("fd-ordered-list", "orderedList");
  [
    "Create content with the blocks that fit the idea.",
    "Rearrange blocks until the structure feels clear.",
    "Share the URL so someone else can collaborate.",
  ].forEach((text, index) => {
    const itemId = `fd-ordered-${index + 1}`;
    addBlock(itemId, "orderedListItem", { parentId: "fd-ordered-list" });
    addPlainText(`${itemId}-text`, "paragraph", text, { parentId: itemId });
  });
  addPlainText(
    "fd-paragraph-after-workflow",
    "paragraph",
    "Because every step is a block, the sequence can evolve without rewriting the surrounding section.",
  );
  addBlock("fd-toggle-list", "toggleListItem");
  addPlainText(
    "fd-toggle-list-summary",
    "paragraph",
    "What will the starter kit include?",
    { parentId: "fd-toggle-list" },
  );
  addBlock("fd-toggle-list-body", "toggleListItemBody", {
    parentId: "fd-toggle-list",
  });
  addPlainText(
    "fd-toggle-list-body-text",
    "paragraph",
    "The optional kit is planned to collect collaboration-ready tables, lists, headings, tabs, layouts, and other common building blocks.",
    { parentId: "fd-toggle-list-body" },
  );
  addPlainText(
    "fd-paragraph-after-toggle-list",
    "paragraph",
    "That leaves product teams free to start with familiar pieces and extend only what their experience requires.",
  );
  addBlock("fd-divider-layouts", "divider");
  addPlainText("fd-empty-before-layouts", "paragraph", "");

  addPlainText(
    "fd-heading-layouts",
    "heading",
    "Shape content with flexible layouts",
    { metadata: { level: 2 } },
  );
  addPlainText(
    "fd-paragraph-layouts",
    "paragraph",
    "Columns can place complementary ideas side by side while each side keeps an ordinary block structure.",
  );
  addBlock("fd-columns", "columns");
  addBlock("fd-column-left", "column", {
    parentId: "fd-columns",
    metadata: createDefaultColumnMetadata(),
  });
  addPlainText("fd-column-left-heading", "heading", "Structure", {
    parentId: "fd-column-left",
    metadata: { level: 3 },
  });
  addPlainText(
    "fd-column-left-text",
    "paragraph",
    "Use block relationships to express how ideas belong together.",
    { parentId: "fd-column-left" },
  );
  addBlock("fd-column-right", "column", {
    parentId: "fd-columns",
    metadata: createDefaultColumnMetadata(),
  });
  addPlainText("fd-column-right-heading", "heading", "Presentation", {
    parentId: "fd-column-right",
    metadata: { level: 3 },
  });
  addPlainText(
    "fd-column-right-text",
    "paragraph",
    "Let renderers turn that structure into a layout suited to the reader.",
    { parentId: "fd-column-right" },
  );
  addPlainText(
    "fd-paragraph-after-columns",
    "paragraph",
    "Move the whole layout as one block, or keep editing the text inside either column.",
  );

  addPlainText("fd-heading-tabs", "heading", "Switch between related views", {
    metadata: { level: 2 },
  });
  addPlainText(
    "fd-paragraph-tabs",
    "paragraph",
    "Tabs group related perspectives without making the main document longer.",
  );
  addBlock("fd-tabs", "tabs");
  const panes = [
    [
      "fd-tab-overview",
      "writing",
      "Writing",
      "Draft and refine the words while the surrounding structure stays intact.",
    ],
    [
      "fd-tab-details",
      "structure",
      "Structure",
      "Compose blocks into sections, wrappers, and layouts that communicate relationships.",
    ],
    [
      "fd-tab-collaboration",
      "collaboration",
      "Collaboration",
      "Share the same document and watch ordinary edits converge in real time.",
    ],
  ] as const;
  for (const [paneId, tabId, title, text] of panes) {
    addBlock(paneId, "tabPane", {
      parentId: "fd-tabs",
      metadata: { tabId, title },
    });
    addPlainText(`${paneId}-text`, "paragraph", text, { parentId: paneId });
  }
  addPlainText(
    "fd-paragraph-after-tabs",
    "paragraph",
    "Choose a view locally; collaborators can keep the pane that best supports their own task.",
  );

  addBlock("fd-quote-second", "quote");
  addPlainText(
    "fd-quote-second-text",
    "paragraph",
    "A flexible editor should make structure visible without getting in the writer’s way.",
    { parentId: "fd-quote-second" },
  );
  addPlainText(
    "fd-paragraph-outro",
    "paragraph",
    "Now edit the words, rearrange the blocks, and share this document to see collaboration in action.",
  );
  const finalParagraphId = addPlainText("fd-empty-final", "paragraph", "");

  return createCanonicalBlockFragment({
    blocks,
    rootBlockIds,
    start: { kind: "text", blockId: id("fd-heading-1") },
    end: { kind: "text", blockId: finalParagraphId },
    blockDefinitions: firstDraftBlockModelDefinitions,
  });
}
