import { describe, expect, it } from "vitest";
import type { EditorCommandDefinition } from "../definition/contracts.ts";
import { compileRegisteredEditorCommands } from "../definition/commands.ts";
import { compileEditorKeybindings } from "./compiled-keybindings.ts";
import { normalizeEditorKeyChord } from "./chord.ts";

describe("compiled editor keybindings", () => {
  it("compiles empty editable configuration to immutable maps", () => {
    const empty = compileEditorKeybindings(
      [],
      compileRegisteredEditorCommands([]),
    );

    expect(empty.document.size).toBe(0);
    expect(empty.block.size).toBe(0);
    expect(Object.isFrozen(empty)).toBe(true);
    expect(() =>
      (
        empty.document as Map<
          ReturnType<typeof normalizeEditorKeyChord>,
          unknown
        >
      ).set(normalizeEditorKeyChord("Mod-z"), {}),
    ).toThrow();
  });

  it.each([
    "",
    " ",
    "Mod",
    "Mod-",
    "-z",
    "Mod-Mod-z",
    "Mod-Control-z",
    "Hyper-z",
    "Mod-Arrow-Sideways",
  ])("rejects malformed chord %j", (key) => {
    expect(() => normalizeEditorKeyChord(key)).toThrow();
  });

  it("normalizes modifier names, order, and alphabetic casing", () => {
    expect(normalizeEditorKeyChord("mod-Z")).toBe("Mod-z");
    expect(normalizeEditorKeyChord("MOD-z")).toBe("Mod-z");
    expect(normalizeEditorKeyChord("Alt-shift-A")).toBe("Shift-Alt-a");
    expect(normalizeEditorKeyChord("Esc")).toBe("Escape");
  });

  it("rejects duplicate normalized and physically ambiguous chords", () => {
    const command = documentCommand("product.save");
    const commands = compileRegisteredEditorCommands([command]);
    expect(() =>
      compileEditorKeybindings(
        [
          { key: "Mod-z", commandId: command.id, scope: "document" },
          { key: "MOD-Z", commandId: command.id, scope: "document" },
        ],
        commands,
      ),
    ).toThrow(/configured more than once/u);
    expect(() =>
      compileEditorKeybindings(
        [
          { key: "Mod-s", commandId: command.id, scope: "document" },
          { key: "Control-s", commandId: command.id, scope: "document" },
        ],
        commands,
      ),
    ).toThrow(/physically ambiguous/u);
  });

  it("rejects unknown command IDs and scope mismatches", () => {
    expect(() =>
      compileEditorKeybindings(
        [
          {
            key: "Mod-p",
            commandId: "product.unknown",
            scope: "document",
          },
        ],
        compileRegisteredEditorCommands([]),
      ),
    ).toThrow(/unknown command/u);

    const blockCommand: EditorCommandDefinition = {
      id: "product.block",
      scope: "block",
      execute: () => true,
    };
    const commands = compileRegisteredEditorCommands([blockCommand]);
    expect(() =>
      compileEditorKeybindings(
        [
          {
            key: "Mod-p",
            commandId: blockCommand.id,
            scope: "document",
          },
        ],
        commands,
      ),
    ).toThrow(/has document scope.*has block scope/u);
  });

  it("validates bindings after direct commands are composed", () => {
    const product = documentCommand("product.publish");
    const comments = documentCommand("comments.create");
    const commands = compileRegisteredEditorCommands([product, comments]);
    const bindings = [
        { key: "Mod-p", commandId: product.id, scope: "document" },
        { key: "Mod-k", commandId: comments.id, scope: "document" },
      ] as const;

    const compiled = compileEditorKeybindings(bindings, commands);
    expect(
      compiled.document.get(normalizeEditorKeyChord("Mod-p")),
    ).toMatchObject({ commandId: product.id });
    expect(
      compiled.document.get(normalizeEditorKeyChord("Mod-k")),
    ).toMatchObject({ commandId: comments.id });
  });

  it("rejects a block binding whose command lacks its executor", () => {
    expect(() =>
      compileRegisteredEditorCommands([
          {
            id: "product.malformed-block",
            scope: "block",
          } as EditorCommandDefinition,
        ]),
    ).toThrow(/include an executor/u);
  });
});

function documentCommand(id: string): EditorCommandDefinition {
  return { id, scope: "document", execute: () => undefined };
}
