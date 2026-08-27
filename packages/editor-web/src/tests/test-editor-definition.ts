import { createElement } from "react";
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
} from "../document/blocks/block-renderer.tsx";
import { EditableTextBlockPrimitive } from "../document/blocks/editable-text-block-primitive.tsx";
import { conventionalHistoryCommands } from "../api/keybindings.ts";
import type { EditableEditorDefinition } from "../runtime/definition/contracts.ts";
import type { EditableEditor } from "../runtime/document/contracts.ts";

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
    placeholder: { text: "Type here…", visibility: "active" },
  });
}

type TestBlockSemantics = Omit<
  EditableEditorDefinition["blocks"][BlockType],
  "renderer"
>;

const testBlockSemantics: Readonly<Record<BlockType, TestBlockSemantics>> = {
  textBlock: {
    kind: "text",
    rootLayout: "normal",
    type: "textBlock",
  },
  alternateTextBlock: {
    kind: "text",
    rootLayout: "normal",
    type: "alternateTextBlock",
  },
  wrapperBlock: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "wrapperBlock",
    content: { required: ["textBlock"] },
    contentBoundary: false,
  },
  fixedWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "fixedWrapper",
    content: { required: ["textBlock"] },
    contentBoundary: false,
  },
  childText: {
    kind: "text",
    rootLayout: "normal",
    type: "childText",
  },
  alternateChildTextBlock: {
    kind: "text",
    rootLayout: "normal",
    type: "alternateChildTextBlock",
  },
  itemWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "itemWrapper",
    content: { required: ["childText"] },
    contentBoundary: false,
  },
  alternateItemWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "alternateItemWrapper",
    content: { required: ["childText"] },
    contentBoundary: false,
  },
  statefulItemWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "statefulItemWrapper",
    content: { required: ["alternateChildTextBlock"] },
    contentBoundary: false,
  },
  atomicBlock: {
    kind: "atomic",
    rootLayout: "normal",
    type: "atomicBlock",
  },
  alternateAtomicBlock: {
    kind: "atomic",
    rootLayout: "normal",
    type: "alternateAtomicBlock",
  },
  secondAtomicBlock: {
    kind: "atomic",
    rootLayout: "normal",
    type: "secondAtomicBlock",
  },
  thirdAtomicBlock: {
    kind: "atomic",
    rootLayout: "normal",
    type: "thirdAtomicBlock",
  },
  fourthAtomicBlock: {
    kind: "atomic",
    rootLayout: "normal",
    type: "fourthAtomicBlock",
  },
  fifthAtomicBlock: {
    kind: "atomic",
    rootLayout: "normal",
    type: "fifthAtomicBlock",
  },
  containerWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "containerWrapper",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "textBlock",
  },
  emptyContainerWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "emptyContainerWrapper",
    content: { required: [], additional: "block" },
    contentBoundary: false,
  },
  textBlockOnlyContainer: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "textBlockOnlyContainer",
    content: { required: [], additional: "textBlock" },
    contentBoundary: false,
  },
  parentRestrictedTextBlock: {
    kind: "text",
    rootLayout: "normal",
    type: "parentRestrictedTextBlock",
    parents: { allowed: ["containerWrapper"] },
  },
  defaultAtomicBlock: {
    kind: "atomic",
    rootLayout: "normal",
    type: "defaultAtomicBlock",
  },
  expandableTitleWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "expandableTitleWrapper",
    content: { required: ["alternateTextBlock", "titleChildWrapper"] },
    contentBoundary: false,
  },
  titleChildWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "titleChildWrapper",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "defaultAtomicBlock",
  },
  expandableItemWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "expandableItemWrapper",
    content: { required: ["textBlock", "itemChildWrapper"] },
    contentBoundary: false,
  },
  itemChildWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "itemChildWrapper",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "defaultAtomicBlock",
  },
  parallelWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "parallelWrapper",
    content: { required: ["laneWrapper"], additional: "laneWrapper" },
    contentBoundary: false,
    defaultContent: "laneWrapper",
  },
  laneWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "laneWrapper",
    content: { required: ["block"], additional: "block" },
    contentBoundary: true,
    defaultContent: "textBlock",
  },
  switchWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "switchWrapper",
    content: { required: ["branchWrapper"], additional: "branchWrapper" },
    contentBoundary: false,
    defaultContent: "branchWrapper",
  },
  branchWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "branchWrapper",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "defaultAtomicBlock",
  },
  rootWrapper: {
    kind: "wrapper",
    rootLayout: "full",
    type: "rootWrapper",
    content: { required: ["groupWrapper"], additional: "groupWrapper" },
    contentBoundary: true,
    defaultContent: "groupWrapper",
  },
  groupWrapper: {
    kind: "wrapper",
    rootLayout: "full",
    type: "groupWrapper",
    content: { required: ["nestedTextBlock"], additional: "nestedTextBlock" },
    contentBoundary: true,
    defaultContent: "nestedTextBlock",
  },
  nestedTextBlock: {
    kind: "text",
    rootLayout: "normal",
    type: "nestedTextBlock",
  },
  fullAtomicBlock: {
    kind: "atomic",
    rootLayout: "full",
    type: "fullAtomicBlock",
  },
};

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

export const testEditableEditorDefinition: EditableEditorDefinition = {
  blocks: testEditableBlockDefinitions,
  defaultRoot: "textBlock",
  commands: conventionalHistoryCommands,
  inlineAtoms: [],
  inlineMarks: testInlineMarks,
};
