import { createElement } from "react";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType } from "@repo/editor-core/document";
import {
  boldMarkDefinition,
  codeMarkDefinition,
  italicMarkDefinition,
  linkMarkDefinition,
  strikethroughMarkDefinition,
  underlineMarkDefinition,
} from "@repo/editor-core/content/marks";
import {
  type BlockRendererProps,
  ReadTextBlockPrimitive,
} from "../document/blocks/block-renderer.tsx";
import { EditableTextBlockPrimitive } from "../document/blocks/editable-text-block-primitive.tsx";
import { conventionalHistoryCommands } from "../api/keybindings.ts";
import type {
  EditableEditorDefinition,
  ReadEditorDefinition,
} from "../runtime/definition/contracts.ts";
import type {
  EditableEditor,
  ReadEditor,
} from "../runtime/document/contracts.ts";

function testReadRenderer({
  block,
  editor,
  children,
}: BlockRendererProps<ReadEditor>) {
  if (editor.definition.blocks[block.type]?.kind !== "text") {
    return createElement(
      "div",
      { "data-testid": `test-${block.type}-renderer` },
      children,
    );
  }
  return createElement(ReadTextBlockPrimitive, {
    block,
    editor,
    placeholder: testPlaceholderForBlock(block.type),
  });
}

function testEditableRenderer({
  block,
  editor,
  children,
}: BlockRendererProps<EditableEditor>) {
  if (editor.definition.blocks[block.type]?.kind !== "text") {
    return createElement(
      "div",
      { "data-testid": `test-${block.type}-renderer` },
      children,
    );
  }
  return createElement(EditableTextBlockPrimitive, {
    block,
    editor,
    placeholder: testPlaceholderForBlock(block.type),
  });
}

function testPlaceholderForBlock(blockType: BlockType) {
  return blockType === "heading"
    ? ({ text: "Heading", visibility: "always" } as const)
    : ({ text: "Type here…", visibility: "active" } as const);
}

const testBlockSemantics: Readonly<Record<BlockType, BlockDefinition>> = {
  paragraph: {
    kind: "text",
    rootLayout: "normal",
    type: "paragraph",
    split: { default: "paragraph" },
  },
  heading: {
    kind: "text",
    rootLayout: "normal",
    type: "heading",
    data: { level: 1 },
    split: { default: "paragraph" },
  },
  quote: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "quote",
    content: { required: ["paragraph"] },
    contentBoundary: false,
  },
  code: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "code",
    content: { required: ["paragraph"] },
    contentBoundary: false,
  },
  childText: {
    kind: "text",
    rootLayout: "normal",
    type: "childText",
  },
  checkedChildText: {
    kind: "text",
    rootLayout: "normal",
    type: "checkedChildText",
  },
  itemWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "itemWrapper",
    content: { required: ["childText"] },
    contentBoundary: false,
  },
  numberedItemWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "numberedItemWrapper",
    content: { required: ["childText"] },
    contentBoundary: false,
  },
  checkedItemWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "checkedItemWrapper",
    content: { required: ["checkedChildText"] },
    contentBoundary: false,
  },
  divider: {
    kind: "atomic",
    rootLayout: "normal",
    type: "divider",
  },
  image: {
    kind: "atomic",
    rootLayout: "normal",
    type: "image",
  },
  video: {
    kind: "atomic",
    rootLayout: "normal",
    type: "video",
  },
  audio: {
    kind: "atomic",
    rootLayout: "normal",
    type: "audio",
  },
  file: {
    kind: "atomic",
    rootLayout: "normal",
    type: "file",
  },
  embed: {
    kind: "atomic",
    rootLayout: "normal",
    type: "embed",
  },
  callout: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "callout",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "paragraph",
  },
  placeholder: {
    kind: "atomic",
    rootLayout: "normal",
    type: "placeholder",
  },
  toggleHeading: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "toggleHeading",
    content: { required: ["heading", "toggleHeadingBody"] },
    contentBoundary: false,
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
  },
  toggleListItemBody: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "toggleListItemBody",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "placeholder",
  },
  columns: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "columns",
    content: { required: ["column"], additional: "column" },
    contentBoundary: false,
    defaultContent: "column",
  },
  column: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "column",
    content: { required: ["block"], additional: "block" },
    contentBoundary: true,
    defaultContent: "paragraph",
  },
  tabs: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "tabs",
    content: { required: ["tabPane"], additional: "tabPane" },
    contentBoundary: false,
    defaultContent: "tabPane",
  },
  tabPane: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "tabPane",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "placeholder",
  },
  collection: {
    kind: "wrapper",
    rootLayout: "full",
    type: "collection",
    content: { required: ["collectionGroup"], additional: "collectionGroup" },
    contentBoundary: true,
    defaultContent: "collectionGroup",
  },
  collectionGroup: {
    kind: "wrapper",
    rootLayout: "full",
    type: "collectionGroup",
    content: { required: ["collectionText"], additional: "collectionText" },
    contentBoundary: true,
    defaultContent: "collectionText",
  },
  collectionText: {
    kind: "text",
    rootLayout: "normal",
    type: "collectionText",
  },
  database: {
    kind: "atomic",
    rootLayout: "full",
    type: "database",
  },
};

const testReadBlockDefinitions = Object.fromEntries(
  Object.entries(testBlockSemantics).map(([type, definition]) => [
    type,
    { ...definition, renderer: testReadRenderer },
  ]),
) as ReadEditorDefinition["blocks"];

const testEditableBlockDefinitions = Object.fromEntries(
  Object.entries(testBlockSemantics).map(([type, definition]) => [
    type,
    { ...definition, renderer: testEditableRenderer },
  ]),
) as EditableEditorDefinition["blocks"];

const testInlineMarks = [
  boldMarkDefinition,
  italicMarkDefinition,
  linkMarkDefinition,
  codeMarkDefinition,
  underlineMarkDefinition,
  strikethroughMarkDefinition,
] as const;

export const testReadEditorDefinition: ReadEditorDefinition = {
  blocks: testReadBlockDefinitions,
  defaultRoot: "paragraph",
  inlineAtoms: [],
  inlineMarks: testInlineMarks,
};

export const testEditableEditorDefinition: EditableEditorDefinition = {
  blocks: testEditableBlockDefinitions,
  defaultRoot: "paragraph",
  commands: conventionalHistoryCommands,
  inlineAtoms: [],
  inlineMarks: testInlineMarks,
};
