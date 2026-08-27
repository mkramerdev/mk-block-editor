import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType } from "@repo/editor-core/document";
import {
  createDefaultColumnMetadata,
  validateColumnMetadata,
} from "../blocks/columns/model.ts";
import { validateFirstDraftHeadingMetadata } from "../heading-level.ts";

export const firstDraftInlineAtomModels = Object.freeze([
  Object.freeze({
    type: "mention",
    metadata: Object.freeze({
      id: Object.freeze({ type: "string" as const, required: true }),
    }),
  }),
]);

function listContainer(
  type: "bulletList" | "orderedList" | "checklist",
  itemType: "bulletListItem" | "orderedListItem" | "checklistItem",
): BlockDefinition {
  return {
    kind: "wrapper",
    type,
    content: { required: [itemType], additional: itemType },
    contentBoundary: false,
    defaultContent: itemType,
  };
}

function listItem(
  type: "bulletListItem" | "orderedListItem" | "checklistItem",
  containerType: "bulletList" | "orderedList" | "checklist",
): BlockDefinition {
  return {
    kind: "wrapper",
    type,
    content: { required: ["paragraph"], additional: "block" },
    contentBoundary: false,
    parents: { allowed: [containerType] },
    ...(type === "checklistItem"
      ? {
          defaultMetadata: { checked: false },
          validateMetadata: ({ metadata }) =>
            metadata?.checked === undefined ||
            typeof metadata.checked === "boolean"
              ? []
              : [
                  "checklist item checked metadata must be boolean when present",
                ],
        }
      : {}),
  };
}

/** Canonical renderer-free block semantics shared by storage validation and the editor. */
export const firstDraftBlockModelDefinitions = Object.freeze({
  paragraph: {
    kind: "text",
    type: "paragraph",
  },
  heading: {
    kind: "text",
    type: "heading",
    data: { level: 1 },
    validateMetadata: validateFirstDraftHeadingMetadata,
  },
  bulletList: listContainer("bulletList", "bulletListItem"),
  orderedList: listContainer("orderedList", "orderedListItem"),
  checklist: listContainer("checklist", "checklistItem"),
  bulletListItem: listItem("bulletListItem", "bulletList"),
  orderedListItem: listItem("orderedListItem", "orderedList"),
  checklistItem: listItem("checklistItem", "checklist"),
  quote: {
    kind: "wrapper",
    type: "quote",
    content: { required: ["paragraph"] },
    contentBoundary: false,
  },
  code: {
    kind: "wrapper",
    type: "code",
    content: { required: ["paragraph"] },
    contentBoundary: false,
    data: { language: "plaintext" },
  },
  callout: {
    kind: "wrapper",
    type: "callout",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "paragraph",
    data: { icon: "note" },
  },
  toggleHeading: {
    kind: "wrapper",
    type: "toggleHeading",
    content: { required: ["heading", "toggleHeadingBody"] },
    contentBoundary: false,
  },
  toggleHeadingBody: {
    kind: "wrapper",
    type: "toggleHeadingBody",
    content: { required: [], additional: "block" },
    contentBoundary: false,
  },
  toggleListItem: {
    kind: "wrapper",
    type: "toggleListItem",
    content: { required: ["paragraph", "toggleListItemBody"] },
    contentBoundary: false,
  },
  toggleListItemBody: {
    kind: "wrapper",
    type: "toggleListItemBody",
    content: { required: [], additional: "block" },
    contentBoundary: false,
  },
  divider: {
    kind: "atomic",
    type: "divider",
  },
  columns: {
    kind: "wrapper",
    type: "columns",
    content: { required: ["column", "column"], additional: "column" },
    contentBoundary: false,
    defaultContent: "column",
  },
  column: {
    kind: "wrapper",
    type: "column",
    content: { required: ["block"], additional: "block" },
    contentBoundary: true,
    defaultContent: "paragraph",
    defaultMetadata: createDefaultColumnMetadata(),
    validateMetadata: ({ metadata }) => validateColumnMetadata(metadata),
  },
  tabs: {
    kind: "wrapper",
    type: "tabs",
    content: { required: ["tabPane"], additional: "tabPane" },
    contentBoundary: false,
    defaultContent: "tabPane",
  },
  tabPane: {
    kind: "wrapper",
    type: "tabPane",
    content: { required: [], additional: "block" },
    contentBoundary: false,
    data: { tabId: "", title: "" },
  },
  table: {
    kind: "wrapper",
    type: "table",
    content: { required: ["tableRow"], additional: "tableRow" },
    contentBoundary: true,
    defaultContent: "tableRow",
    data: { width: 0, viewId: "" },
  },
  tableRow: {
    kind: "wrapper",
    type: "tableRow",
    content: { required: ["tableCell"], additional: "tableCell" },
    contentBoundary: true,
    defaultContent: "tableCell",
  },
  tableCell: {
    kind: "text",
    type: "tableCell",
  },
} satisfies Readonly<Record<BlockType, BlockDefinition>>);
