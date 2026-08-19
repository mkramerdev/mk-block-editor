import type {
  EditableEditor,
  ReadEditor,
} from "../runtime/document/contracts.ts";
import { initializeEditableEditor } from "../runtime/document/initialize-editor.ts";
import { initializeReadEditor } from "../runtime/document/initialize-read-editor.ts";
import { ReadEditorImplementation } from "../runtime/document/read-editor-implementation.ts";
import type {
  EditorInstanceSnapshot,
  ValidatedEditorInstanceSnapshot,
} from "@repo/editor-core/codecs";
import type {
  EditableEditorDefinition,
  ReadEditorDefinition,
} from "../runtime/definition/contracts.ts";
import { compileCanonicalEditorDefinition } from "../runtime/definition/compiled-editor-definition.ts";
import { compileReadEditorDefinition } from "../runtime/definition/compile-read-editor-definition.ts";
import type { EditorChangeCallback } from "../runtime/document/contracts.ts";
import { useEditor } from "../runtime/document/use-editor.ts";
import { EditorImplementation } from "@repo/editor-react/editor";

export type TestEditableEditor = EditableEditor & EditorImplementation;
export type TestReadEditor = ReadEditor & ReadEditorImplementation;

interface TestEditableOptions {
  readonly definition: EditableEditorDefinition;
  readonly snapshot: EditorInstanceSnapshot;
  readonly validatedSnapshot?: ValidatedEditorInstanceSnapshot;
  readonly onChange?: EditorChangeCallback | null;
  readonly onChangeError?: ((error: Error) => void) | null;
  readonly createTransactionId?: () => string;
}

export function initializeTestEditableEditor(
  options: TestEditableOptions,
): TestEditableEditor {
  const editor = initializeEditableEditor({
    ...options,
    compiledDefinition: compileCanonicalEditorDefinition(options.definition),
  });
  if (!(editor instanceof EditorImplementation)) {
    throw new Error("editable test editor is not the expected implementation");
  }
  return editor;
}

export function initializeTestReadEditor(options: {
  readonly definition: ReadEditorDefinition;
  readonly snapshot: EditorInstanceSnapshot;
}): TestReadEditor {
  const editor = initializeReadEditor({
    snapshot: options.snapshot,
    compiledDefinition: compileReadEditorDefinition(options.definition),
  });
  if (!(editor instanceof ReadEditorImplementation)) {
    throw new Error("read test editor is not the expected implementation");
  }
  return editor;
}

/** Test harness for legacy behavioral suites; production has no render-owned hook. */
export function useTestEditor(
  options: TestEditableOptions,
): TestEditableEditor {
  const editor = useEditor(options);
  if (!(editor instanceof EditorImplementation)) {
    throw new Error("editable test editor is not the expected implementation");
  }
  return editor;
}
