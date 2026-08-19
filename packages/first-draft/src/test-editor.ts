import {
  initializeEditableEditor,
  type EditableEditor,
  type InitializeEditableEditorOptions,
} from "@repo/editor-web/editor";
import { compileCanonicalEditorDefinition } from "@repo/editor-web/editor-definition";
import type { EditableEditorDefinition } from "@repo/editor-web/editor";
import { EditorImplementation } from "@repo/editor-react/editor";

export type FirstDraftTestEditor = EditableEditor & EditorImplementation;

export function initializeTestEditableEditor(
  options: Omit<InitializeEditableEditorOptions, "compiledDefinition"> & {
    readonly definition: EditableEditorDefinition;
  },
): FirstDraftTestEditor {
  const { definition, ...rest } = options;
  return requireFirstDraftTestEditor(
    initializeEditableEditor({
      ...rest,
      compiledDefinition: compileCanonicalEditorDefinition(definition),
    }),
  );
}

export function initializeCompiledTestEditableEditor(
  options: InitializeEditableEditorOptions,
): FirstDraftTestEditor {
  return requireFirstDraftTestEditor(initializeEditableEditor(options));
}

function requireFirstDraftTestEditor(
  editor: EditableEditor,
): FirstDraftTestEditor {
  if (!(editor instanceof EditorImplementation)) {
    throw new Error(
      "First Draft test editor is not the expected implementation",
    );
  }
  return editor;
}
