import type { BlockType } from "../document/model/block.ts";
import type { BlockDefinition } from "../definitions/block-definition.ts";

/** Product-neutral definitions shared by generic graph tests. */
export const testBlockDefinitions: Readonly<
  Record<BlockType, BlockDefinition>
> = {
  textBlock: { kind: "text", type: "textBlock" },
  alternateTextBlock: {
    kind: "text",
    type: "alternateTextBlock",
    data: { variant: "alternate" },
  },
  childTextBlock: { kind: "text", type: "childTextBlock" },
  alternateChildTextBlock: {
    kind: "text",
    type: "alternateChildTextBlock",
  },
  atomicBlock: { kind: "atomic", type: "atomicBlock" },
  alternateAtomicBlock: {
    kind: "atomic",
    type: "alternateAtomicBlock",
    data: { source: "" },
  },
  fixedWrapper: {
    kind: "wrapper",
    type: "fixedWrapper",
    content: { required: ["textBlock"] },
    contentBoundary: false,
  },
  wrapperBlock: {
    kind: "wrapper",
    type: "wrapperBlock",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "textBlock",
  },
  nestedWrapper: {
    kind: "wrapper",
    type: "nestedWrapper",
    content: { required: ["block"], additional: "block" },
    contentBoundary: true,
    defaultContent: "textBlock",
  },
  childWrapper: {
    kind: "wrapper",
    type: "childWrapper",
    content: { required: ["childTextBlock"] },
    contentBoundary: false,
  },
  containerWrapper: {
    kind: "wrapper",
    type: "containerWrapper",
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "atomicBlock",
  },
};
