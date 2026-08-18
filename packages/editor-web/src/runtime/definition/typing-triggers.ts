import type { EditorTypingTriggerDefinition } from "./contracts.ts";
import { createImmutableMap } from "./immutable-map.ts";

export interface CompiledEditorTypingTriggers {
  readonly definitions: readonly EditorTypingTriggerDefinition[];
  readonly byId: ReadonlyMap<string, EditorTypingTriggerDefinition>;
  readonly byTrigger: ReadonlyMap<string, EditorTypingTriggerDefinition>;
}

const allowedTypingTriggerFields = new Set(["id", "trigger", "isAllowed"]);

export function compileEditorTypingTriggers(
  definitions: readonly EditorTypingTriggerDefinition[],
): CompiledEditorTypingTriggers {
  if (!Array.isArray(definitions)) {
    throw new Error(
      "EditorDefinition.typingTriggers must be an array of typing trigger definitions.",
    );
  }
  const byId = new Map<string, EditorTypingTriggerDefinition>();
  const byTrigger = new Map<string, EditorTypingTriggerDefinition>();
  const compiled: EditorTypingTriggerDefinition[] = [];
  for (const definition of definitions) {
    assertValidTypingTriggerDefinition(definition);
    const captured = Object.freeze({
      id: definition.id,
      trigger: definition.trigger,
      ...(definition.isAllowed === undefined
        ? {}
        : { isAllowed: definition.isAllowed }),
    }) satisfies EditorTypingTriggerDefinition;
    if (byId.has(captured.id)) {
      throw new Error(
        `Editor typing trigger id ${captured.id} is registered more than once.`,
      );
    }
    if (byTrigger.has(captured.trigger)) {
      throw new Error(
        `Editor typing trigger ${JSON.stringify(captured.trigger)} is registered more than once.`,
      );
    }
    for (const existing of byTrigger.keys()) {
      if (
        existing.startsWith(captured.trigger) ||
        captured.trigger.startsWith(existing)
      ) {
        throw new Error(
          `Editor typing triggers ${JSON.stringify(existing)} and ${JSON.stringify(captured.trigger)} have an ambiguous prefix.`,
        );
      }
    }
    byId.set(captured.id, captured);
    byTrigger.set(captured.trigger, captured);
    compiled.push(captured);
  }
  return Object.freeze({
    definitions: Object.freeze(compiled),
    byId: createImmutableMap(byId),
    byTrigger: createImmutableMap(byTrigger),
  });
}

function assertValidTypingTriggerDefinition(
  definition: unknown,
): asserts definition is EditorTypingTriggerDefinition {
  if (!definition || typeof definition !== "object") {
    throw new Error("Editor typing trigger definitions must be objects.");
  }
  const candidate = definition as Record<string, unknown>;
  const unsupported = Object.keys(candidate).filter(
    (field) => !allowedTypingTriggerFields.has(field),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Editor typing trigger definition includes unsupported fields: ${unsupported.join(", ")}.`,
    );
  }
  if (
    typeof candidate.id !== "string" ||
    candidate.id.trim().length === 0 ||
    candidate.id.trim() !== candidate.id
  ) {
    throw new Error("Editor typing triggers must have a non-empty id.");
  }
  if (
    typeof candidate.trigger !== "string" ||
    candidate.trigger.trim().length === 0 ||
    containsControlCharacter(candidate.trigger)
  ) {
    throw new Error(
      "Editor typing triggers must have a non-empty trigger without control characters.",
    );
  }
  if (
    candidate.isAllowed !== undefined &&
    typeof candidate.isAllowed !== "function"
  ) {
    throw new Error(
      `Editor typing trigger ${candidate.id} has an invalid isAllowed predicate.`,
    );
  }
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}
