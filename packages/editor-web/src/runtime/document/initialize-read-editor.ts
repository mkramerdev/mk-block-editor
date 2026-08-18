import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import { createEditorContentRuntime } from "../content/content-runtime.ts";
import { createCanonicalContentResources } from "../content/canonical-resources.ts";
import type { ReadEditorDefinition } from "../definition/contracts.ts";
import type { CompiledCanonicalEditorDefinition } from "../definition/compiled-editor-definition.ts";
import {
  createEditorContentStartup,
  assertValidEditorSnapshotForStartupOrRecovery,
} from "./snapshot-initialization.ts";
import type { ReadEditor } from "./contracts.ts";
import { ReadEditorImplementation } from "./read-editor-implementation.ts";
import { createEditorDocumentGeometryOwner } from "../../document/geometry/editor-document-geometry.ts";
import { registerEditorRuntimePort } from "./runtime-port-registry.ts";

export interface InitializeReadEditorOptions {
  readonly compiledDefinition: CompiledCanonicalEditorDefinition<ReadEditorDefinition>;
  readonly snapshot: EditorInstanceSnapshot;
}

export function initializeReadEditor({
  compiledDefinition,
  snapshot,
}: InitializeReadEditorOptions): ReadEditor {
  const definition = compiledDefinition.definition;
  assertValidEditorSnapshotForStartupOrRecovery(snapshot, compiledDefinition);
  const contentStartup = createEditorContentStartup(snapshot, definition);
  const contentRuntime = definition.content?.createRuntime
    ? definition.content.createRuntime(contentStartup)
    : createEditorContentRuntime(contentStartup);
  const geometryOwner = createEditorDocumentGeometryOwner();
  try {
    const editor = new ReadEditorImplementation(
      definition,
      snapshot,
      createCanonicalContentResources({ compiledDefinition }),
      contentRuntime,
      geometryOwner,
      compiledDefinition,
    );
    editor.registerCleanup(registerEditorRuntimePort(editor, editor));
    return editor;
  } catch (error) {
    geometryOwner.dispose();
    contentRuntime.destroy();
    throw error;
  }
}
