import {
  initializeEditableEditor,
  type InitializeEditableEditorOptions,
} from "@repo/editor-web/editor";
import { compileCanonicalEditorDefinition } from "@repo/editor-web/editor-definition";
import type { EditableEditorDefinition } from "@repo/editor-web/editor";

export function initializeTestEditableEditor(
  options: Omit<InitializeEditableEditorOptions, "compiledDefinition"> & {
    readonly definition: EditableEditorDefinition;
  },
) {
  const { definition, ...rest } = options;
  return initializeEditableEditor({
    ...rest,
    compiledDefinition: compileCanonicalEditorDefinition(definition),
  });
}
