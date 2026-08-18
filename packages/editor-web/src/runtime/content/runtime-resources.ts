import { createBlockLocalProseMirrorSchema } from "@repo/editor-dom/schema";
import type { NodeViewConstructor, Schema } from "@repo/editor-dom/prosemirror";
import type { CompiledCanonicalEditorDefinition } from "../definition/compiled-editor-definition.ts";
import { createInlineAtomNodeViews } from "./inline-atom-node-view.ts";
import {
  createCanonicalContentResources,
  type CanonicalContentResources,
} from "./canonical-resources.ts";
import { InlineAtomPortalRegistry } from "./inline-atom-portal-registry.tsx";

export interface EditableContentResources extends CanonicalContentResources {
  readonly proseMirrorSchema: Schema;
  readonly inlineNodeViews: Readonly<Record<string, NodeViewConstructor>>;
  readonly inlineAtomPortals: InlineAtomPortalRegistry;
}

export function createEditorContentRuntimeResources(input: {
  readonly compiledDefinition: CompiledCanonicalEditorDefinition;
  readonly inlineAtomPortals: InlineAtomPortalRegistry;
}): EditableContentResources {
  const canonical = createCanonicalContentResources(input);
  const definition = input.compiledDefinition.definition;
  const compiled = input.compiledDefinition.inlineAtomRegistry;
  const definitions = [...compiled.definitions.values()];
  return Object.freeze({
    ...canonical,
    proseMirrorSchema: createBlockLocalProseMirrorSchema({
      inlineMarks: definition.inlineMarks,
      inlineAtoms: definitions,
    }),
    inlineNodeViews: createInlineAtomNodeViews(definitions, input.inlineAtomPortals),
    inlineAtomPortals: input.inlineAtomPortals,
  });
}

export type EditorContentRuntimeResources = EditableContentResources;
