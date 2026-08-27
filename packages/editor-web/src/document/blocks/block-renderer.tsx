"use client";

import { createElement, type ReactNode } from "react";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { SelectionController } from "@repo/editor-react/selection";
import type { EditableEditorRuntimePort } from "../../runtime/document/render-port.ts";
export type {
  BlockRendererProps,
  EditorWebBlockRenderer,
} from "./block-renderer-contracts.ts";
import type { EditorWebBlockRenderer } from "./block-renderer-contracts.ts";
export { InactiveTextBlockPrimitive } from "./inactive-text-block-primitive.tsx";
export { useDirectChildBlocks } from "./use-direct-child-blocks.ts";
export { editorSelectionBoundsDataAttributes } from "../selection/bounds/selection-bounds.ts";
export {
  textOffsetFromPoint,
  textPointFromPoint,
  type EditorTextPointHit,
} from "../selection/hit-testing/text-hit-testing.ts";
export { useEditorTextGestureBoundary } from "../selection/controller/text-gesture-arbitration.tsx";
export type {
  EditorTextGestureBoundary,
  EditorTextGestureBoundarySession,
  EditorTextGesturePointer,
  EditorTextGestureStart,
  EditorTransferredPointerGesture,
} from "../selection/controller/text-gesture-arbitration.tsx";
export { fixedPopoverPositionForAnchor } from "../../overlays/fixed-popover.ts";
export type { EditorWebContentRuntime } from "../../runtime/content/content-runtime.ts";
interface InternalBlockRendererProps {
  readonly block: VersionedBlock;
  readonly editor: EditableEditorRuntimePort;
  readonly selectionController: SelectionController;
  readonly children?: ReactNode;
}

export function BlockRenderer({
  block,
  editor,
  selectionController,
  children,
}: InternalBlockRendererProps) {
  const renderer = editor.definition.blocks[block.type]?.renderer;
  if (typeof renderer !== "function") {
    throw new Error(
      `Editor block definition does not provide a renderer for ${block.type}.`,
    );
  }
  return createElement(
    renderer as EditorWebBlockRenderer,
    {
      block,
      editor,
      selectionController,
    },
    children,
  );
}
