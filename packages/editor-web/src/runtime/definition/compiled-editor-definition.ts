import type { InlineMarkDefinition } from "@repo/editor-core/content/marks";
import { assertValidBlockDefinitions } from "@repo/editor-core/definitions";
import {
  compileEditorContentCodecs,
  type CompiledEditorContentCodecs,
} from "./content-codecs.ts";
import type {
  EditorBlockInternalSelectionSubsystemDefinition,
  EditableEditorDefinition,
  EditorDefinition,
} from "./contracts.ts";
import {
  compileEditorInlineAtoms,
  type CompiledEditorInlineAtoms,
} from "./inline-atoms.ts";
import {
  compileEditorTypingTriggers,
  type CompiledEditorTypingTriggers,
} from "./typing-triggers.ts";
import {
  compileRegisteredEditorCommands,
} from "./commands.ts";
import type { EditorCommandDefinition } from "./contracts.ts";
import {
  compileEditorKeybindings,
  type CompiledEditorKeybindings,
} from "../keybindings/compiled-keybindings.ts";
import { createImmutableMap } from "./immutable-map.ts";

export interface CompiledCanonicalEditorDefinition<
  TDefinition extends EditorDefinition = EditorDefinition,
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
        delete canonical.shellElement;
        return [type, canonical];
      }),
    ),
  );
  assertValidBlockShellElements(definition);
  assertValidBlockRenderers(definition);
  assertValidInlineMarkDefinitions(definition.inlineMarks);
  const editable = "commands" in definition || "keybindings" in definition;
  const commands = editable
    ? compileRegisteredEditorCommands(
        "commands" in definition ? definition.commands ?? [] : [],
      )
    : createImmutableMap(new Map<string, EditorCommandDefinition>());
  const compiled = Object.freeze({
    definition,
    inlineAtomRegistry: compileEditorInlineAtoms(definition),
    blockInternalSelectionSubsystems:
      compileBlockInternalSelectionSubsystems(definition),
    contentCodecs: compileEditorContentCodecs(definition.contentCodecs),
    typingTriggers: compileEditorTypingTriggers(
      definition.typingTriggers ?? [],
    ),
    commands,
    keybindings: compileEditorKeybindings(
      editable && "keybindings" in definition
        ? definition.keybindings ?? []
        : [],
      commands,
    ),
  });
  assertValidContentIntegration(definition);
  return compiled;
}

function assertValidInlineMarkDefinitions(
  inlineMarks: readonly InlineMarkDefinition[],
): void {
  if (!Array.isArray(inlineMarks)) {
    throw new Error(
      "EditorDefinition.inlineMarks must be an array of inline mark definitions.",
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

function assertValidContentIntegration(definition: EditorDefinition): void {
  const defaultRootDefinition = definition.blocks[definition.defaultRoot];
  if (!defaultRootDefinition || defaultRootDefinition.kind !== "text") {
    throw new Error("EditorDefinition.defaultRoot must name a text block");
  }
  if (definition.contentImport !== undefined) {
    const importDefinition =
      definition.blocks[definition.contentImport.plainTextBlockType];
    if (!importDefinition || importDefinition.kind !== "text") {
      throw new Error(
        "EditorDefinition.contentImport.plainTextBlockType must name a text block",
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
      "EditorDefinition.content must provide one content runtime factory",
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
  "commands",
  "keybindings",
]);

function assertValidBlockRenderers(definition: EditorDefinition): void {
  for (const [type, blockDefinition] of Object.entries(definition.blocks)) {
    if (!Object.prototype.hasOwnProperty.call(blockDefinition, "renderer")) {
      throw new Error(`Block definition ${type} must provide a renderer.`);
    }
    if (typeof blockDefinition.renderer !== "function") {
      throw new Error(`Block definition ${type} renderer must be a function.`);
    }
  }
}

function assertValidBlockShellElements(definition: EditorDefinition): void {
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
  definition: EditorDefinition,
): void {
  if (!definition || typeof definition !== "object") {
    throw new Error("EditorDefinition must be an object.");
  }
  const unexpectedFields = Object.keys(definition).filter(
    (field) => !allowedEditorDefinitionFields.has(field),
  );
  if (unexpectedFields.length > 0) {
    throw new Error(
      `EditorDefinition contains unsupported fields: ${unexpectedFields.join(", ")}.`,
    );
  }
  if (
    definition.documentValidators !== undefined &&
    (!Array.isArray(definition.documentValidators) ||
      definition.documentValidators.some(
        (validator) => typeof validator !== "function",
      ))
  ) {
    throw new Error("EditorDefinition documentValidators must be functions.");
  }
}

function compileBlockInternalSelectionSubsystems(
  definition: EditorDefinition,
): ReadonlyMap<string, EditorBlockInternalSelectionSubsystemDefinition> {
  const definitions = definition.blockInternalSelectionSubsystems ?? [];
  if (!Array.isArray(definitions)) {
    throw new Error(
      "EditorDefinition.blockInternalSelectionSubsystems must be an array.",
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
  return compiled;
}
