import { describe, expect, it, vi } from "vitest";
import type { EditorDefinition } from "./contracts.ts";
import {
  compileEditorInlineAtoms,
  validateEditorInlineAtomOccurrence,
} from "./inline-atoms.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { compileCanonicalEditorDefinition } from "./compiled-editor-definition.ts";

const mention = {
  type: "mention",
  metadata: { id: { type: "string", required: true } },
  render: vi.fn(() => null),
} as const;

function definition(
  inlineAtoms: EditorDefinition["inlineAtoms"],
): EditorDefinition {
  return { ...testEditableEditorDefinition, inlineAtoms };
}

describe("compiled editor inline atoms", () => {
  it("compiles exact definitions by type", () => {
    const host = definition([mention]);
    const first = compileEditorInlineAtoms(host);

    expect(first.definitions.get("mention")?.render).toBe(mention.render);
    expect(
      first.definitions.get("mention")?.render,
    ).toBe(mention.render);
  });

  it("rejects duplicate, empty, malformed, and reserved atom types", () => {
    expect(() =>
      compileEditorInlineAtoms(definition([mention, mention])),
    ).toThrow(/registered more than once/i);
    for (const type of ["", "Mention", "bad-type", "text", "hard_break"]) {
      expect(() =>
        compileEditorInlineAtoms(definition([{ ...mention, type }])),
      ).toThrow(/empty, malformed, or reserved/i);
    }
  });

  it("rejects missing contracts, renderers, and malformed metadata fields", () => {
    expect(() =>
      compileEditorInlineAtoms(
        definition([{ type: "mention", render: () => null } as never]),
      ),
    ).toThrow(/must declare metadata/i);
    expect(() =>
      compileEditorInlineAtoms(
        definition([{ type: "mention", metadata: {} } as never]),
      ),
    ).toThrow(/must provide a renderer/i);
    expect(() =>
      compileEditorInlineAtoms(
        definition([
          {
            ...mention,
            metadata: { id: { type: "unsupported" } },
          } as never,
        ]),
      ),
    ).toThrow(/malformed metadata field id/i);
  });

  it("validates occurrences against only the selected exact definition", () => {
    const host = definition([mention]);
    const compiled = compileCanonicalEditorDefinition(host);

    expect(
      validateEditorInlineAtomOccurrence(compiled, {
        type: "mention",
        metadata: { id: "user-123" },
      }),
    ).toStrictEqual({ id: "user-123" });
    expect(() =>
      validateEditorInlineAtomOccurrence(compiled, {
        type: "unknown",
        metadata: {},
      }),
    ).toThrow(/not registered/i);
    expect(() =>
      validateEditorInlineAtomOccurrence(compiled, {
        type: "mention",
        metadata: {},
      }),
    ).toThrow(/required/i);
    expect(() =>
      validateEditorInlineAtomOccurrence(compiled, {
        type: "mention",
        metadata: { id: 123 },
      }),
    ).toThrow(/must be a JSON string/i);
    expect(() =>
      validateEditorInlineAtomOccurrence(compiled, {
        type: "mention",
        metadata: { id: "user-123", label: "Ada" },
      }),
    ).toThrow(/not declared/i);
  });

  it("rejects the retired top-level attrs representation", () => {
    expect(() =>
      validateEditorInlineAtomOccurrence(compileCanonicalEditorDefinition(definition([mention])), {
        type: "mention",
        attrs: { id: "user-123" },
      }),
    ).toThrow(/unsupported fields: attrs/i);
  });
});
