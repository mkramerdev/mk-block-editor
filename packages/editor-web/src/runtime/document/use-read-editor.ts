"use client";

import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import { useState } from "react";
import type { ReadEditorDefinition } from "../definition/contracts.ts";
import { compileReadEditorDefinition } from "../definition/compile-read-editor-definition.ts";
import type { ReadEditor } from "./contracts.ts";
import { initializeReadEditor } from "./initialize-read-editor.ts";

export interface UseReadEditorOptions {
  readonly definition: ReadEditorDefinition;
  readonly snapshot: EditorInstanceSnapshot;
}

export function useReadEditor(options: UseReadEditorOptions): ReadEditor {
  const [editor] = useState(() =>
    initializeReadEditor({
      compiledDefinition: compileReadEditorDefinition(options.definition),
      snapshot: options.snapshot,
    }),
  );
  return editor;
}
