import { EditorDocument } from "@repo/editor-web/document-runtime";
import { useEditor } from "@repo/editor-web/editor";
import { EditableTextBlockPrimitive } from "@repo/editor-web/editable-block-renderer";

export const editorBundleSurface = {
  EditorDocument,
  EditableTextBlockPrimitive,
  useEditor,
};
