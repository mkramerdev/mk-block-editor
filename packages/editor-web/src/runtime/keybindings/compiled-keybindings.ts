import type {
  EditorCommandDefinition,
  EditorCommandScope,
  EditorKeyBinding,
} from "../definition/contracts.ts";
import {
  normalizeEditorKeyChord,
  physicalEditorKeyChordSignature,
  type NormalizedEditorKeyChord,
} from "./chord.ts";
import { createImmutableMap } from "../definition/immutable-map.ts";

export interface CompiledEditorKeybindings {
  readonly document: ReadonlyMap<NormalizedEditorKeyChord, EditorKeyBinding>;
  readonly block: ReadonlyMap<NormalizedEditorKeyChord, EditorKeyBinding>;
}

export function compileEditorKeybindings(
  definitions: readonly EditorKeyBinding[],
  commands: ReadonlyMap<string, EditorCommandDefinition>,
): CompiledEditorKeybindings {
  const documentBindings = new Map<
    NormalizedEditorKeyChord,
    EditorKeyBinding
  >();
  const blockBindings = new Map<NormalizedEditorKeyChord, EditorKeyBinding>();
  const documentPhysicalChords = new Set<string>();
  const blockPhysicalChords = new Set<string>();

  for (const binding of definitions) {
    assertValidBindingShape(binding);
    const chord = normalizeEditorKeyChord(binding.key);
    const command = commands.get(binding.commandId);
    if (!command) {
      throw new Error(
        `Editor keybinding ${chord} targets unknown command ${binding.commandId}.`,
      );
    }
    if (command.scope !== binding.scope) {
      throw new Error(
        `Editor keybinding ${chord} has ${binding.scope} scope but command ${binding.commandId} has ${command.scope} scope.`,
      );
    }
    if (binding.scope === "block" && typeof command.execute !== "function") {
      throw new Error(
        `Editor block keybinding ${chord} targets command ${binding.commandId} without a mounted-block executor.`,
      );
    }
    const target =
      binding.scope === "document" ? documentBindings : blockBindings;
    const physicalChords =
      binding.scope === "document"
        ? documentPhysicalChords
        : blockPhysicalChords;
    if (target.has(chord)) {
      throw new Error(
        `Editor ${binding.scope} key chord ${chord} is configured more than once.`,
      );
    }
    for (const platform of ["apple", "other"] as const) {
      const physicalChord = `${platform}:${physicalEditorKeyChordSignature(
        chord,
        platform,
      )}`;
      if (physicalChords.has(physicalChord)) {
        throw new Error(
          `Editor ${binding.scope} key chord ${chord} is physically ambiguous on ${platform} platforms.`,
        );
      }
      physicalChords.add(physicalChord);
    }
    target.set(chord, Object.freeze({ ...binding, key: chord }));
  }

  return Object.freeze({
    document: createImmutableMap(documentBindings),
    block: createImmutableMap(blockBindings),
  });
}

function assertValidBindingShape(
  binding: unknown,
): asserts binding is EditorKeyBinding {
  if (!binding || typeof binding !== "object") {
    throw new Error("Editor keybindings include a malformed binding.");
  }
  const candidate = binding as Record<string, unknown>;
  const unsupported = Object.keys(candidate).filter(
    (field) => field !== "key" && field !== "commandId" && field !== "scope",
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Editor keybinding includes unsupported fields: ${unsupported.join(", ")}.`,
    );
  }
  if (typeof candidate.key !== "string") {
    throw new Error("Editor keybinding must include a string key chord.");
  }
  if (
    typeof candidate.commandId !== "string" ||
    candidate.commandId.length === 0
  ) {
    throw new Error("Editor keybinding must include a command id.");
  }
  if (!isEditorCommandScope(candidate.scope)) {
    throw new Error(
      `Editor keybinding ${candidate.key} has invalid scope ${String(candidate.scope)}.`,
    );
  }
}

function isEditorCommandScope(scope: unknown): scope is EditorCommandScope {
  return scope === "document" || scope === "block";
}
