import type { InlineMarkDefinition } from "@repo/editor-core/content/marks";
import { assertValidBlockDefinitions } from "@repo/editor-core/definitions";
import {
  compileEditorContentCodecs,
} from "./content-codecs.ts";
import type {
  EditorBlockInternalSelectionSubsystemDefinition,
  EditorCommandDefinition,
  ReadEditorDefinition,
} from "./contracts.ts";
import { compileEditorInlineAtoms } from "./inline-atoms.ts";
import type { CompiledCanonicalEditorDefinition } from "./compiled-editor-definition.ts";
import { createImmutableMap } from "./immutable-map.ts";

const allowedReadDefinitionFields = new Set([
  "blocks",
  "defaultRoot",
  "inlineMarks",
  "inlineAtoms",
  "contentImport",
  "content",
  "contentCodecs",
  "documentValidators",
  "blockInternalSelectionSubsystems",
  "selectionFragment",
]);

/** PM-free compilation used exclusively by the static read entrypoint. */
export function compileReadEditorDefinition(
  definition: ReadEditorDefinition,
): CompiledCanonicalEditorDefinition<ReadEditorDefinition> {
  assertValidReadDefinition(definition);
  const emptyCommands = createImmutableMap(
    new Map<string, EditorCommandDefinition>(),
  );
  const emptyBindings = createImmutableMap(new Map());
  return Object.freeze({
    definition,
    inlineAtomRegistry: compileEditorInlineAtoms(definition),
    blockInternalSelectionSubsystems:
      compileBlockInternalSelectionSubsystems(definition),
    contentCodecs: compileEditorContentCodecs(definition.contentCodecs),
    typingTriggers: Object.freeze({
      definitions: Object.freeze([]),
      byId: createImmutableMap(new Map()),
      byTrigger: createImmutableMap(new Map()),
    }),
    commands: emptyCommands,
    keybindings: Object.freeze({
      document: emptyBindings,
      block: emptyBindings,
    }),
  });
}

function assertValidReadDefinition(definition: ReadEditorDefinition): void {
  if (!definition || typeof definition !== "object") {
    throw new Error("ReadEditorDefinition must be an object.");
  }
  const unexpectedFields = Object.keys(definition).filter(
    (field) => !allowedReadDefinitionFields.has(field),
  );
  if (unexpectedFields.length > 0) {
    throw new Error(
      `ReadEditorDefinition contains unsupported fields: ${unexpectedFields.join(", ")}.`,
    );
  }
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
  if (
    definition.documentValidators !== undefined &&
    (!Array.isArray(definition.documentValidators) ||
      definition.documentValidators.some(
        (validator) => typeof validator !== "function",
      ))
  ) {
    throw new Error("EditorDefinition documentValidators must be functions.");
  }
  if (
    definition.selectionFragment !== undefined &&
    (typeof definition.selectionFragment !== "object" ||
      definition.selectionFragment === null ||
      typeof definition.selectionFragment.resolveVisibleChildBlockIds !==
        "function")
  ) {
    throw new Error(
      "EditorDefinition selectionFragment must resolve visible child block ids.",
    );
  }
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

function assertValidBlockRenderers(definition: ReadEditorDefinition): void {
  for (const [type, blockDefinition] of Object.entries(definition.blocks)) {
    if (!Object.prototype.hasOwnProperty.call(blockDefinition, "renderer")) {
      throw new Error(`Block definition ${type} must provide a renderer.`);
    }
    if (typeof blockDefinition.renderer !== "function") {
      throw new Error(`Block definition ${type} renderer must be a function.`);
    }
  }
}

function assertValidBlockShellElements(definition: ReadEditorDefinition): void {
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

function compileBlockInternalSelectionSubsystems(
  definition: ReadEditorDefinition,
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
  return createImmutableMap(compiled);
}
