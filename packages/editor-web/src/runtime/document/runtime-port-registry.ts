import type {
  EditableEditor,
  EditorReadRuntime,
  ReadEditor,
} from "./contracts.ts";
import type {
  AnyEditorRuntimePort,
  EditableEditorRuntimePort,
  ReadEditorRuntimePort,
} from "./render-port.ts";

const runtimePorts = new WeakMap<EditorReadRuntime, AnyEditorRuntimePort>();

export function registerEditorRuntimePort(
  editor: EditorReadRuntime,
  runtime: AnyEditorRuntimePort,
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
): EditableEditorRuntimePort;
export function resolveEditorRuntimePort(
  editor: ReadEditor,
): ReadEditorRuntimePort;
export function resolveEditorRuntimePort(
  editor: EditorReadRuntime,
): AnyEditorRuntimePort;
export function resolveEditorRuntimePort(
  editor: EditorReadRuntime,
): AnyEditorRuntimePort {
  const runtime = runtimePorts.get(editor);
  if (!runtime) {
    throw new Error(
      "Editor render runtime is unavailable or has been disposed.",
    );
  }
  if (!("editable" in editor) || runtime.editable !== editor.editable) {
    throw new Error(
      "Editor render runtime mutability does not match its editor.",
    );
  }
  return runtime;
}
