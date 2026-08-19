import {
  EditorDocument,
  type EditorContentRuntime,
  type EditorWebContentRuntime,
} from "@repo/editor-web/document-runtime";
import { useEditor } from "@repo/editor-web/editor";
import { EditableTextBlockPrimitive } from "@repo/editor-web/editable-block-renderer";

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
