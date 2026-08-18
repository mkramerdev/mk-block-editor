import type { EditableEditor, ReadEditor } from "../runtime/document/contracts.ts";
import { initializeEditableEditor } from "../runtime/document/initialize-editor.ts";
import { initializeReadEditor } from "../runtime/document/initialize-read-editor.ts";
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
): EditableEditor {
  return initializeEditableEditor({
    ...options,
    compiledDefinition: compileCanonicalEditorDefinition(options.definition),
  });
}

export function initializeTestReadEditor(options: {
  readonly definition: ReadEditorDefinition;
  readonly snapshot: EditorInstanceSnapshot;
}): ReadEditor {
  return initializeReadEditor({
    snapshot: options.snapshot,
    compiledDefinition: compileReadEditorDefinition(options.definition),
  });
}

/** Test harness for legacy behavioral suites; production has no render-owned hook. */
export function useTestEditor(options: TestEditableOptions): EditableEditor {
  return useEditor(options);
}
