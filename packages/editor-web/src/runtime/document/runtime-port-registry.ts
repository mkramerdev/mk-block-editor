import type { EditableEditor } from "./contracts.ts";
import type { EditableEditorRuntimePort } from "./render-port.ts";

const runtimePorts = new WeakMap<EditableEditor, EditableEditorRuntimePort>();

export function registerEditorRuntimePort(
  editor: EditableEditor,
  runtime: EditableEditorRuntimePort,
): () => void {
  if (runtimePorts.has(editor)) {
    throw new Error("Editor render runtime is already registered.");
  }
  runtimePorts.set(editor, runtime);
  return () => {
    if (runtimePorts.get(editor) === runtime) runtimePorts.delete(editor);
  };
}

export function resolveEditorRuntimePort(
  editor: EditableEditor,
): EditableEditorRuntimePort {
  const runtime = runtimePorts.get(editor);
  if (!runtime) {
    throw new Error(
      "Editor render runtime is unavailable or has been disposed.",
    );
  }
  return runtime;
}
