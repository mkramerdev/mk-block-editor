import type { CompiledCanonicalEditorDefinition } from "../definition/compiled-editor-definition.ts";
import type { EditorDefinition } from "../definition/contracts.ts";
import { createImmutableSet } from "../definition/immutable-map.ts";

/**
 * Immutable resources used by canonical read projection.
 *
 * This module intentionally has no dependency on ProseMirror. Editable
 * resources are layered on top by runtime-resources.ts.
 */
export interface CanonicalContentResources {
  readonly definition: EditorDefinition;
  readonly inlineAtomTypes: ReadonlySet<string>;
}

export function createCanonicalContentResources(input: {
  readonly compiledDefinition: CompiledCanonicalEditorDefinition;
}): CanonicalContentResources {
  const definition = input.compiledDefinition.definition;
  return Object.freeze({
    definition,
    inlineAtomTypes: createImmutableSet(
      input.compiledDefinition.inlineAtomRegistry.definitions.keys(),
    ),
  });
}
