import type { InlineMarkDefinition } from "@repo/editor-core/content/marks";
import { assertValidBlockDefinitions } from "@repo/editor-core/definitions";
import {
  compileEditorContentCodecs,
  type CompiledEditorContentCodecs,
} from "./content-codecs.ts";
import type {
  EditorBlockInternalSelectionSubsystemDefinition,
  EditableEditorDefinition,
} from "./contracts.ts";
import {
  compileEditorInlineAtoms,
  type CompiledEditorInlineAtoms,
} from "./inline-atoms.ts";
import {
  compileEditorTypingTriggers,
  type CompiledEditorTypingTriggers,
} from "./typing-triggers.ts";
import { compileRegisteredEditorCommands } from "./commands.ts";
import type { EditorCommandDefinition } from "./contracts.ts";
import {
  compileEditorKeybindings,
  type CompiledEditorKeybindings,
} from "../keybindings/compiled-keybindings.ts";
import { createImmutableMap } from "./immutable-map.ts";

export interface CompiledCanonicalEditorDefinition<
  TDefinition extends EditableEditorDefinition = EditableEditorDefinition,
> {
  readonly definition: TDefinition;
  readonly inlineAtomRegistry: CompiledEditorInlineAtoms;
  readonly blockInternalSelectionSubsystems: ReadonlyMap<
    string,
    EditorBlockInternalSelectionSubsystemDefinition
  >;
  readonly contentCodecs: CompiledEditorContentCodecs;
  readonly typingTriggers: CompiledEditorTypingTriggers;
  readonly commands: ReadonlyMap<string, EditorCommandDefinition>;
  readonly keybindings: CompiledEditorKeybindings;
}

/** Explicit, one-shot validation and compilation boundary. */
export function compileCanonicalEditorDefinition<
  TDefinition extends EditableEditorDefinition,
>(definition: TDefinition): CompiledCanonicalEditorDefinition<TDefinition> {
  assertNoUnexpectedEditorDefinitionFields(definition);
  assertValidBlockDefinitions(
    Object.fromEntries(
      Object.entries(definition.blocks).map(([type, block]) => {
        const canonical = { ...block };
        Reflect.deleteProperty(canonical, "shellElement");
        Reflect.deleteProperty(canonical, "rootLayout");
        Reflect.deleteProperty(canonical, "renderer");
        return [type, canonical];
      }),
    ),
  );
  assertValidBlockShellElements(definition);
  assertValidBlockRenderers(definition);
  assertValidInlineMarkDefinitions(definition.inlineMarks);
  const ownedDefinition = captureCompiledDefinition(definition);
  const commands = compileRegisteredEditorCommands(
    ownedDefinition.commands ?? [],
  );
  const compiled = Object.freeze({
    definition: ownedDefinition,
    inlineAtomRegistry: compileEditorInlineAtoms(ownedDefinition),
    blockInternalSelectionSubsystems:
      compileBlockInternalSelectionSubsystems(ownedDefinition),
    contentCodecs: compileEditorContentCodecs(ownedDefinition.contentCodecs),
    typingTriggers: compileEditorTypingTriggers(
      ownedDefinition.typingTriggers ?? [],
    ),
    commands,
    keybindings: compileEditorKeybindings(
      ownedDefinition.keybindings ?? [],
      commands,
    ),
  });
  assertValidContentIntegration(ownedDefinition);
  return compiled;
}

/**
 * Captures declarative definition data without retaining caller-owned arrays
 * or records. Functions, renderers, class instances, and React elements remain
 * intentional identity references.
 */
export function captureCompiledDefinition<TDefinition extends EditableEditorDefinition>(
  definition: TDefinition,
): TDefinition {
  return captureDefinitionValue(
    definition,
    new WeakMap<object, object>(),
  ) as TDefinition;
}

function captureDefinitionValue(
  value: unknown,
  captured: WeakMap<object, object>,
): unknown {
  if (typeof value !== "object" || value === null) return value;
  if ("$$typeof" in value) return value;
  const existing = captured.get(value);
  if (existing) return existing;
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    captured.set(value, clone);
    for (const item of value)
      clone.push(captureDefinitionValue(item, captured));
    return Object.freeze(clone);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const clone = Object.create(
    prototype === null ? null : Object.prototype,
  ) as Record<string, unknown>;
  captured.set(value, clone);
  for (const key of Object.keys(value)) {
    clone[key] = captureDefinitionValue(
      (value as Record<string, unknown>)[key],
      captured,
    );
  }
  return Object.freeze(clone);
}

function assertValidInlineMarkDefinitions(
  inlineMarks: readonly InlineMarkDefinition[],
): void {
  if (!Array.isArray(inlineMarks)) {
    throw new Error(
      "EditableEditorDefinition.inlineMarks must be an array of inline mark definitions.",
    );
  }
  const definitionNames = new Set<string>();
  const commandIds = new Set<string>();
  for (const definition of inlineMarks) {
    if (
      !definition ||
      typeof definition !== "object" ||
      typeof definition.name !== "string" ||
      definition.name.length === 0
    ) {
      throw new Error("Editor inline mark definitions must have a name.");
    }
    if (definitionNames.has(definition.name)) {
      throw new Error(
        `Editor inline mark ${definition.name} is registered more than once.`,
      );
    }
    definitionNames.add(definition.name);
    if (
      !definition.command ||
      typeof definition.command.id !== "string" ||
      definition.command.id.length === 0
    ) {
      throw new Error(
        `Editor inline mark ${definition.name} must declare a command identity.`,
      );
    }
    if (commandIds.has(definition.command.id)) {
      throw new Error(
        `Editor inline mark command ${definition.command.id} is registered more than once.`,
      );
    }
    commandIds.add(definition.command.id);
  }
}

function assertValidContentIntegration(definition: EditableEditorDefinition): void {
  const defaultRootDefinition = definition.blocks[definition.defaultRoot];
  if (!defaultRootDefinition || defaultRootDefinition.kind !== "text") {
    throw new Error("EditableEditorDefinition.defaultRoot must name a text block");
  }
  if (definition.contentImport !== undefined) {
    const importDefinition =
      definition.blocks[definition.contentImport.plainTextBlockType];
    if (!importDefinition || importDefinition.kind !== "text") {
      throw new Error(
        "EditableEditorDefinition.contentImport.plainTextBlockType must name a text block",
      );
    }
  }
  if (
    definition.content !== undefined &&
    (typeof definition.content !== "object" ||
      definition.content === null ||
      typeof definition.content.createRuntime !== "function")
  ) {
    throw new Error(
      "EditableEditorDefinition.content must provide one content runtime factory",
    );
  }
}

const allowedEditorDefinitionFields = new Set([
  "blocks",
  "defaultRoot",
  "inlineMarks",
  "inlineAtoms",
  "contentImport",
  "content",
  "contentCodecs",
  "typingTriggers",
  "documentValidators",
  "blockInternalSelectionSubsystems",
  "selectionFragment",
  "commands",
  "keybindings",
]);

function assertValidBlockRenderers(definition: EditableEditorDefinition): void {
  for (const [type, blockDefinition] of Object.entries(definition.blocks)) {
    if (!Object.prototype.hasOwnProperty.call(blockDefinition, "renderer")) {
      throw new Error(`Block definition ${type} must provide a renderer.`);
    }
    if (typeof blockDefinition.renderer !== "function") {
      throw new Error(`Block definition ${type} renderer must be a function.`);
    }
  }
}

function assertValidBlockShellElements(definition: EditableEditorDefinition): void {
  const allowed = new Set(["div", "ol", "ul", "li"]);
  for (const [type, blockDefinition] of Object.entries(definition.blocks)) {
    if (
      blockDefinition.shellElement !== undefined &&
      !allowed.has(blockDefinition.shellElement)
    ) {
      throw new Error(
        `Block definition ${type} shellElement must be div, ol, ul, or li.`,
      );
    }
  }
}

function assertNoUnexpectedEditorDefinitionFields(
  definition: EditableEditorDefinition,
): void {
  if (!definition || typeof definition !== "object") {
    throw new Error("EditableEditorDefinition must be an object.");
  }
  const unexpectedFields = Object.keys(definition).filter(
    (field) => !allowedEditorDefinitionFields.has(field),
  );
  if (unexpectedFields.length > 0) {
    throw new Error(
      `EditableEditorDefinition contains unsupported fields: ${unexpectedFields.join(", ")}.`,
    );
  }
  if (
    definition.documentValidators !== undefined &&
    (!Array.isArray(definition.documentValidators) ||
      definition.documentValidators.some(
        (validator) => typeof validator !== "function",
      ))
  ) {
    throw new Error("EditableEditorDefinition documentValidators must be functions.");
  }
  if (
    definition.selectionFragment !== undefined &&
    (typeof definition.selectionFragment !== "object" ||
      definition.selectionFragment === null ||
      typeof definition.selectionFragment.resolveVisibleChildBlockIds !==
        "function" ||
      (definition.selectionFragment.resolveStructuralEditRange !== undefined &&
        typeof definition.selectionFragment.resolveStructuralEditRange !==
          "function") ||
      (definition.selectionFragment.planStructuralRangeDeletion !== undefined &&
        typeof definition.selectionFragment.planStructuralRangeDeletion !==
          "function"))
  ) {
    throw new Error(
      "EditableEditorDefinition selectionFragment must resolve visible child block ids.",
    );
  }
}

function compileBlockInternalSelectionSubsystems(
  definition: EditableEditorDefinition,
): ReadonlyMap<string, EditorBlockInternalSelectionSubsystemDefinition> {
  const definitions = definition.blockInternalSelectionSubsystems ?? [];
  if (!Array.isArray(definitions)) {
    throw new Error(
      "EditableEditorDefinition.blockInternalSelectionSubsystems must be an array.",
    );
  }
  const compiled = new Map<
    string,
    EditorBlockInternalSelectionSubsystemDefinition
  >();
  for (const subsystem of definitions) {
    if (
      !subsystem ||
      typeof subsystem !== "object" ||
      typeof subsystem.id !== "string" ||
      subsystem.id.trim() === "" ||
      typeof subsystem.validate !== "function" ||
      (subsystem.resolveFocusTarget !== undefined &&
        typeof subsystem.resolveFocusTarget !== "function") ||
      (subsystem.resolveDecorationTarget !== undefined &&
        typeof subsystem.resolveDecorationTarget !== "function")
    ) {
      throw new Error(
        "Block-internal selection subsystems require a stable id and validator.",
      );
    }
    if (compiled.has(subsystem.id)) {
      throw new Error(
        `Block-internal selection subsystem ${subsystem.id} is registered more than once.`,
      );
    }
    compiled.set(subsystem.id, subsystem);
  }
  return createImmutableMap(compiled);
}
