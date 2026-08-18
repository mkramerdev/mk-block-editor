"use client";

export {
  useDirectChildBlocks,
  ReadTextBlockPrimitive,
  blockHeadingLevel,
  normalizeHeadingLevel,
  editorSelectionBoundsDataAttributes,
  fixedPopoverPositionForAnchor,
  textOffsetFromPoint,
  textPointFromPoint,
} from "../document/blocks/block-renderer.tsx";
export type { EditorTextPointHit } from "../document/blocks/block-renderer.tsx";
export { useEditorBlockScopedSelection } from "../document/selection/block-scoped-selection.ts";
export {
  createRectangularSelectionPaintSegments,
  selectionPaintSegmentDataAttributes,
} from "../document/selection/paint/selection-paint-segment.ts";
export type {
  SelectionPaintSegmentDataAttributes,
  SelectionPaintSegmentEdges,
} from "../document/selection/paint/selection-paint-segment.ts";
export {
  blockInternalSelectionSubsystemId,
  readEditorBlockSelectionTarget,
  registerInternalSelectionSubsystem,
} from "@repo/editor-react/selection";
export type {
  CanonicalLocalSelection,
  RegisteredInternalSelectionSubsystem,
  SelectionCause,
} from "@repo/editor-react/selection";
export type { EditorBlockScopedSelectionSnapshot } from "../document/selection/block-scoped-selection.ts";
export type {
  BlockRendererProps,
  EditorWebBlockRenderer,
} from "../document/blocks/block-renderer.tsx";
export type { TextPlaceholder } from "@repo/editor-dom/block-editor";
export type { ReadTextBlockPrimitiveProps } from "../document/blocks/read-text-block-primitive.tsx";
export type {
  EditorRendererInfrastructure,
  EditorRenderPort,
} from "../runtime/document/render-port.ts";
export { useEditorAtomicFocusTarget } from "../document/focus/use-atomic-focus-target.ts";
