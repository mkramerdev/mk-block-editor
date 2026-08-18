"use client";

import type {
  EditorInstanceSnapshot,
  ValidatedEditorInstanceSnapshot,
} from "@repo/editor-core/codecs";
import { useLayoutEffect, useState } from "react";
import type { EditableEditorDefinition } from "../definition/contracts.ts";
import { compileCanonicalEditorDefinition } from "../definition/compiled-editor-definition.ts";
import type { EditableEditor, EditorChangeCallback } from "./contracts.ts";
import { initializeEditableEditor } from "./initialize-editor.ts";

export interface UseEditorOptions {
  readonly definition: EditableEditorDefinition;
  readonly snapshot: EditorInstanceSnapshot;
  readonly validatedSnapshot?: ValidatedEditorInstanceSnapshot;
  readonly onChange?: EditorChangeCallback | null;
  readonly onChangeError?: ((error: Error) => void) | null;
  readonly createTransactionId?: () => string;
}

class EditorCallbackDispatch {
  private onChange: EditorChangeCallback | null;
  private onChangeError: ((error: Error) => void) | null;

  constructor(options: UseEditorOptions) {
    this.onChange = options.onChange ?? null;
    this.onChangeError = options.onChangeError ?? null;
  }

  readonly change: EditorChangeCallback = (transaction) =>
    this.onChange?.(transaction);

  readonly error = (error: Error) => this.onChangeError?.(error);

  update(
    onChange: EditorChangeCallback | null | undefined,
    onChangeError: ((error: Error) => void) | null | undefined,
  ): void {
    this.onChange = onChange ?? null;
    this.onChangeError = onChangeError ?? null;
  }
}

/** Established convenience API for self-contained editor examples.
 * Transport-owned products should construct their editor at the transport boundary.
 */
export function useEditor(options: UseEditorOptions): EditableEditor {
  const [callbacks] = useState(() => new EditorCallbackDispatch(options));
  useLayoutEffect(() => {
    callbacks.update(options.onChange, options.onChangeError);
  }, [callbacks, options.onChange, options.onChangeError]);
  const [editor] = useState<EditableEditor>(() =>
    initializeEditableEditor({
      compiledDefinition: compileCanonicalEditorDefinition(options.definition),
      snapshot: options.snapshot,
      validatedSnapshot: options.validatedSnapshot,
      onChange: callbacks.change,
      onChangeError: callbacks.error,
      createTransactionId: options.createTransactionId,
    }),
  );
  return editor;
}
