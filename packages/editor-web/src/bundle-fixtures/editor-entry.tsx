import {
  EditorDocument,
  type EditorContentRuntime,
  type EditorWebContentRuntime,
} from "@repo/editor-web/document-runtime";
import { useEditor } from "@repo/editor-web/editor";
import { EditableTextBlockPrimitive } from "@repo/editor-web/editable-block-renderer";
import type {
  EditorBlockExactInsertion,
  EditorBlockOperations,
} from "@repo/editor-web/block-operations";

export const editorBundleSurface = {
  EditorDocument,
  EditableTextBlockPrimitive,
  useEditor,
};

type AssertTrue<T extends true> = T;

export type EditorContentRuntimeCompatibilityContract = AssertTrue<
  EditorWebContentRuntime extends EditorContentRuntime
    ? EditorContentRuntime extends EditorWebContentRuntime
      ? true
      : false
    : false
>;

export type ExactPlacementBlockCreationContract = AssertTrue<
  EditorBlockOperations["insertBlockAt"] extends (
    insertion: EditorBlockExactInsertion,
  ) => unknown
    ? true
    : false
>;
