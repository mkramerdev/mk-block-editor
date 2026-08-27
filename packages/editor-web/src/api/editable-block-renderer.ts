"use client";

export { EditableTextBlockPrimitive } from "../document/blocks/editable-text-block-primitive.tsx";
export { CanonicalRichTextPresentation } from "../document/blocks/canonical-text-projection.tsx";
export {
  readEditorViewContentSize,
  setEditorViewCaretSilently,
} from "../document/inline/editor-view-inline-formatting.ts";
export type { EditableTextBlockPrimitiveProps } from "../document/blocks/editable-text-block-primitive.tsx";
export type { CanonicalRichTextPresentationProps } from "../document/blocks/canonical-text-projection.tsx";
export type {
  TextDomPresentation,
  TextDomPresentationElement,
} from "../document/blocks/text-dom-presentation.ts";
export type { TextPlaceholder } from "@repo/editor-dom/block-editor";
