import { describe, expect, expectTypeOf, it } from "vitest";
import { compileCanonicalEditorDefinition } from "../runtime/definition/compiled-editor-definition.ts";
import type {
  EditorCommandDefinition,
  EditorDefinition,
  EditorTypingTriggerDefinition,
  EditableEditorDefinition,
} from "../runtime/definition/contracts.ts";
import { compileRegisteredEditorCommands } from "../runtime/definition/commands.ts";
import { compileEditorKeybindings } from "../runtime/keybindings/compiled-keybindings.ts";
import { normalizeEditorKeyChord } from "../runtime/keybindings/chord.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";

describe("EditorDefinition direct composition", () => {
  it("has no capabilities field", () => {
    expectTypeOf<EditorDefinition>().not.toHaveProperty("capabilities");
  });

  it("rejects old definitions containing capabilities", () => {
    const oldDefinition = {
      ...testDefinition(),
      capabilities: [],
    };
    expect(() => compileCanonicalEditorDefinition(oldDefinition)).toThrow(
      /unsupported fields: capabilities/u,
    );
  });

  it("rejects a missing block renderer during definition validation", () => {
    const paragraph = testEditableEditorDefinition.blocks.paragraph!;
    const { renderer, ...withoutRenderer } = paragraph;
    expect(renderer).toBeTypeOf("function");
    expect(() =>
      compileCanonicalEditorDefinition({
        ...testEditableEditorDefinition,
        blocks: {
          // @ts-expect-error A missing renderer is deliberately invalid definition input.
          paragraph: withoutRenderer,
        },
      }),
    ).toThrow(/Block definition paragraph must provide a renderer/u);
  });

  it("rejects a non-function block renderer during definition validation", () => {
    expect(() =>
      compileCanonicalEditorDefinition({
        ...testEditableEditorDefinition,
        blocks: {
          paragraph: {
            ...testEditableEditorDefinition.blocks.paragraph!,
            // @ts-expect-error A non-function renderer is deliberately invalid definition input.
            renderer: "paragraph",
          },
        },
      }),
    ).toThrow(/Block definition paragraph renderer must be a function/u);
  });

  it("compiles editable commands separately and rejects duplicate ids", () => {
    const command = {
      id: "product.open",
      scope: "document" as const,
      execute: () => true,
    };
    const registered = compileRegisteredEditorCommands([command]).get(
      command.id,
    );
    expect(registered).toStrictEqual(command);
    expect(registered).not.toBe(command);
    expect(() =>
      compileRegisteredEditorCommands([command, documentCommand(command.id)]),
    ).toThrow(/product\.open is registered more than once/u);
  });

  it("resolves editable keybindings against editable command ids", () => {
    const command = documentCommand("product.open");
    const commands = compileRegisteredEditorCommands([command]);
    const compiled = compileEditorKeybindings(
      [{ key: "Mod-k", commandId: command.id, scope: "document" }],
      commands,
    );
    expect(
      compiled.document.get(normalizeEditorKeyChord("Mod-k")),
    ).toMatchObject({
      commandId: command.id,
    });
  });

  it("compiles content codecs directly and rejects duplicate handler ids", () => {
    const handler = {
      id: "product.selection",
      subsystemId: "product",
      materialize: () => null,
    };
    const definition = testDefinition({
      contentCodecs: {
        internalSelectionFragmentMaterializers: [handler],
      },
    });
    expect(
      compileCanonicalEditorDefinition(definition).contentCodecs
        .internalSelectionFragmentMaterializers,
    ).toEqual([handler]);
    expect(() =>
      compileCanonicalEditorDefinition(
        testDefinition({
          contentCodecs: {
            internalSelectionFragmentMaterializers: [handler],
            internalSelectionCutHandlers: [
              {
                id: handler.id,
                subsystemId: "product",
                cut: () => ({ ok: true }),
              },
            ],
          },
        }),
      ),
    ).toThrow(/product\.selection is registered more than once/u);
  });

  it("compiles minimal headless typing-trigger definitions directly", () => {
    const definitions: readonly EditorTypingTriggerDefinition[] = [
      { id: "mention", trigger: "@" },
      { id: "slash", trigger: "/" },
    ];
    const compiled = compileCanonicalEditorDefinition(
      testDefinition({ typingTriggers: definitions }),
    ).typingTriggers;
    expect(compiled.definitions).toEqual(definitions);
    expect(compiled.byId.get("mention")).not.toBe(definitions[0]);
    expect(compiled.byTrigger.get("/")).not.toBe(definitions[1]);
    expect(Object.keys(definitions[0]!)).toStrictEqual(["id", "trigger"]);
    expect(Object.isFrozen(compiled.definitions[0])).toBe(true);
  });

  it("defensively captures typing-trigger definition records", () => {
    const mutable = { id: "mention", trigger: "@" };
    const compiled = compileCanonicalEditorDefinition(
      testDefinition({ typingTriggers: [mutable] }),
    ).typingTriggers;
    mutable.id = "changed";
    mutable.trigger = "#";
    expect(compiled.byId.get("mention")).toMatchObject({
      id: "mention",
      trigger: "@",
    });
    expect(compiled.byTrigger.get("@")).toMatchObject({ id: "mention" });
  });

  it("owns compiled definitions and every mutable registry input", () => {
    const command = {
      id: "product.open",
      scope: "document" as const,
      execute: () => true,
    };
    const binding = {
      key: "Mod-k",
      commandId: command.id,
      scope: "document" as const,
    };
    const trigger = { id: "mention", trigger: "@" };
    const atom = {
      type: "mention",
      metadata: { id: { type: "string" as const, required: true } },
      render: () => null,
    };
    const codec = {
      id: "product.selection",
      subsystemId: "product",
      materialize: () => null,
    };
    const subsystem = {
      id: "product",
      validate: () => ({ ok: false as const }),
    };
    const commands = [command];
    const keybindings = [binding];
    const typingTriggers = [trigger];
    const inlineAtoms = [atom];
    const handlers = [codec];
    const subsystems = [subsystem];
    const source = testDefinition({
      commands,
      keybindings,
      typingTriggers,
      inlineAtoms,
      contentCodecs: { internalSelectionFragmentMaterializers: handlers },
      blockInternalSelectionSubsystems: subsystems,
    });
    const compiled = compileCanonicalEditorDefinition(source);

    command.id = "product.changed";
    binding.key = "Mod-x";
    trigger.id = "changed";
    atom.metadata.id.required = false;
    codec.id = "changed";
    subsystem.id = "changed";
    commands.length = 0;
    keybindings.length = 0;
    typingTriggers.length = 0;
    inlineAtoms.length = 0;
    handlers.length = 0;
    subsystems.length = 0;

    expect(compiled.commands.has("product.open")).toBe(true);
    expect(
      compiled.keybindings.document.has(normalizeEditorKeyChord("Mod-k")),
    ).toBe(true);
    expect(compiled.typingTriggers.byId.has("mention")).toBe(true);
    expect(
      compiled.inlineAtomRegistry.definitions.get("mention")?.metadata.id,
    ).toMatchObject({ required: true });
    expect(
      compiled.contentCodecs.internalSelectionFragmentMaterializers[0]?.id,
    ).toBe("product.selection");
    expect(compiled.blockInternalSelectionSubsystems.has("product")).toBe(true);
  });

  it("does not expose mutators on compiled registries", () => {
    const compiled = compileCanonicalEditorDefinition(testDefinition());
    expect("set" in compiled.commands).toBe(false);
    expect("delete" in compiled.commands).toBe(false);
    expect("clear" in compiled.commands).toBe(false);
    expect("set" in compiled.keybindings.document).toBe(false);
    expect("set" in compiled.blockInternalSelectionSubsystems).toBe(false);
  });

  it.each([
    {
      name: "empty ids",
      definitions: [{ id: "", trigger: "@" }],
      expected: /non-empty id/u,
    },
    {
      name: "duplicate ids",
      definitions: [
        { id: "mention", trigger: "@" },
        { id: "mention", trigger: "/" },
      ],
      expected: /id mention is registered more than once/u,
    },
    {
      name: "duplicate triggers",
      definitions: [
        { id: "mention", trigger: "@" },
        { id: "person", trigger: "@" },
      ],
      expected: /trigger "@" is registered more than once/u,
    },
    {
      name: "empty triggers",
      definitions: [{ id: "mention", trigger: "" }],
      expected: /non-empty trigger/u,
    },
    {
      name: "whitespace-only triggers",
      definitions: [{ id: "mention", trigger: "  " }],
      expected: /non-empty trigger/u,
    },
    {
      name: "control characters",
      definitions: [{ id: "mention", trigger: "\n" }],
      expected: /without control characters/u,
    },
    {
      name: "ambiguous prefixes",
      definitions: [
        { id: "slash", trigger: "/" },
        { id: "double-slash", trigger: "//" },
      ],
      expected: /ambiguous prefix/u,
    },
    {
      name: "invalid predicates",
      definitions: [{ id: "mention", trigger: "@", isAllowed: true }],
      expected: /invalid isAllowed predicate/u,
    },
    {
      name: "unsupported fields",
      definitions: [{ id: "mention", trigger: "@", render: () => null }],
      expected: /unsupported fields: render/u,
    },
  ])("rejects $name", ({ definitions, expected }) => {
    expect(() =>
      compileCanonicalEditorDefinition(
        testDefinition({
          typingTriggers:
            definitions as unknown as readonly EditorTypingTriggerDefinition[],
        }),
      ),
    ).toThrow(expected);
  });

  it("does not put rendering, candidates, or transactions on trigger definitions", () => {
    expectTypeOf<EditorTypingTriggerDefinition>().not.toHaveProperty("render");
    expectTypeOf<EditorTypingTriggerDefinition>().not.toHaveProperty(
      "candidates",
    );
    expectTypeOf<EditorTypingTriggerDefinition>().not.toHaveProperty(
      "transaction",
    );
  });
});

function documentCommand(id: string): EditorCommandDefinition {
  return { id, scope: "document", execute: () => true };
}

function testDefinition(
  extra: Partial<EditableEditorDefinition> = {},
): EditableEditorDefinition {
  return { ...testEditableEditorDefinition, ...extra };
}
