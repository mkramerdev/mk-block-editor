import type { EditorReadRuntime } from "./contracts.ts";
import type { AnyEditorRuntimePort } from "./render-port.ts";

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
  editor: EditorReadRuntime,
): AnyEditorRuntimePort {
  const runtime = runtimePorts.get(editor);
  if (!runtime) {
    throw new Error("Editor render runtime is unavailable or has been disposed.");
  }
  return runtime;
}
