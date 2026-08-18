import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType } from "@repo/editor-core/document";
import {
  createDefaultColumnMetadata,
  validateColumnMetadata,
} from "../blocks/columns/model.ts";

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
    rootLayout: "normal",
    type,
    content: { required: [itemType], additional: itemType },
    contentBoundary: false,
    defaultContent: itemType,
    list: { kind: "container", itemType },
  };
}

function listItem(
  type: "bulletListItem" | "orderedListItem" | "checklistItem",
  containerType: "bulletList" | "orderedList" | "checklist",
): BlockDefinition {
  return {
    kind: "wrapper",
    rootLayout: "normal",
    type,
    content: { required: ["paragraph"], additional: "block" },
    contentBoundary: false,
    parents: { allowed: [containerType] },
    conversion: { metadata: "target-defaults" },
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
    list: {
      kind: "item",
      containerType,
      primaryTextChildType: "paragraph",
      emptyEnter: "lift-primary-out-of-container",
    },
  };
}

/** Canonical renderer-free block semantics shared by storage validation and the editor. */
export const firstDraftBlockModelDefinitions = Object.freeze({
  paragraph: {
    kind: "text",
    rootLayout: "normal",
    type: "paragraph",
    split: {
      default: "paragraph",
      bulletListItem: "bulletListItem",
      orderedListItem: "orderedListItem",
      checklistItem: "checklistItem",
      toggleListItem: "toggleListItem",
    },
  },
  heading: {
    kind: "text",
    rootLayout: "normal",
    type: "heading",
    data: { level: 1 },
    split: { default: "paragraph" },
  },
  bulletList: listContainer("bulletList", "bulletListItem"),
  orderedList: listContainer("orderedList", "orderedListItem"),
  checklist: listContainer("checklist", "checklistItem"),
  bulletListItem: listItem("bulletListItem", "bulletList"),
  orderedListItem: listItem("orderedListItem", "orderedList"),
  checklistItem: listItem("checklistItem", "checklist"),
  quote: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "quote",
    content: { required: ["paragraph"] },
    contentBoundary: false,
    rangeDeletion: { kind: "unwrap-boundary-contents" },
  },
  code: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "code",
    content: { required: ["paragraph"] },
    contentBoundary: false,
    data: { language: "plaintext" },
    rangeDeletion: { kind: "unwrap-boundary-contents" },
  },
  callout: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "callout",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "paragraph",
    data: { icon: "info" },
    rangeDeletion: { kind: "unwrap-boundary-contents" },
  },
  toggleHeading: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "toggleHeading",
    content: { required: ["heading", "toggleHeadingBody"] },
    contentBoundary: false,
    compound: {
      kind: "primary-text-with-promoted-content",
      primaryTextChildType: "heading",
      contentWrapperChildType: "toggleHeadingBody",
      emptyPrimary: "remove-wrapper",
    },
  },
  toggleHeadingBody: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "toggleHeadingBody",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "placeholder",
  },
  toggleListItem: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "toggleListItem",
    content: { required: ["paragraph", "toggleListItemBody"] },
    contentBoundary: false,
    compound: {
      kind: "primary-text-with-promoted-content",
      primaryTextChildType: "paragraph",
      contentWrapperChildType: "toggleListItemBody",
      emptyPrimary: "remove-wrapper",
    },
  },
  toggleListItemBody: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "toggleListItemBody",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "placeholder",
  },
  divider: {
    kind: "atomic",
    rootLayout: "normal",
    type: "divider",
  },
  bookmark: {
    kind: "atomic",
    rootLayout: "normal",
    type: "bookmark",
    data: { url: "" },
  },
  columns: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "columns",
    content: { required: ["column", "column"], additional: "column" },
    contentBoundary: false,
    defaultContent: "column",
    underflow: { kind: "promote-single-child-contents" },
    rangeDeletion: { kind: "unwrap-boundary-child" },
  },
  column: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "column",
    content: { required: ["block"], additional: "block" },
    contentBoundary: true,
    defaultContent: "paragraph",
    defaultMetadata: createDefaultColumnMetadata(),
    validateMetadata: ({ metadata }) => validateColumnMetadata(metadata),
  },
  tabs: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "tabs",
    content: { required: ["tabPane"], additional: "tabPane" },
    contentBoundary: false,
    defaultContent: "tabPane",
    rangeDeletion: { kind: "unwrap-visible-boundary-child" },
  },
  tabPane: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "tabPane",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "placeholder",
    data: { tabId: "", title: "" },
  },
  placeholder: {
    kind: "atomic",
    rootLayout: "normal",
    type: "placeholder",
    replaceWith: "paragraph",
  },
  table: {
    kind: "wrapper",
    rootLayout: "full",
    type: "table",
    content: { required: ["tableRow"], additional: "tableRow" },
    contentBoundary: true,
    defaultContent: "tableRow",
    data: { width: 0, viewId: "" },
  },
  tableRow: {
    kind: "wrapper",
    rootLayout: "full",
    type: "tableRow",
    content: { required: ["tableCell"], additional: "tableCell" },
    contentBoundary: true,
    defaultContent: "tableCell",
  },
  tableCell: {
    kind: "text",
    rootLayout: "normal",
    type: "tableCell",
  },
} satisfies Readonly<Record<BlockType, BlockDefinition>>);
