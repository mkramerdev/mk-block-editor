import { describe, expect, it } from "vitest";
import {
  parseInlineAtomSemanticHtmlEnvelope,
  serializeInlineAtomSemanticHtmlEnvelope,
} from "./semantic-html.ts";

const definitions = [
  {
    type: "mention",
    metadata: {
      id: { type: "string", required: true },
      label: { type: "string", required: true },
    },
  },
] as const;

describe("inline atom semantic HTML envelope", () => {
  it("round-trips definition-owned semantic metadata", () => {
    const payload = serializeInlineAtomSemanticHtmlEnvelope({
      type: "mention",
      metadata: { id: "ada", label: "Ada Lovelace" },
      fields: definitions[0].metadata,
    });

    expect(payload).not.toBeNull();
    expect(
      parseInlineAtomSemanticHtmlEnvelope({
        payload: payload!,
        definitions,
      }),
    ).toEqual({
      type: "mention",
      metadata: { id: "ada", label: "Ada Lovelace" },
    });
  });

  it("rejects unknown versions, types, and invalid metadata", () => {
    const encode = (value: unknown) =>
      encodeURIComponent(JSON.stringify(value));

    expect(
      parseInlineAtomSemanticHtmlEnvelope({
        payload: encode({
          version: 2,
          type: "mention",
          metadata: { id: "ada", label: "Ada" },
        }),
        definitions,
      }),
    ).toBeNull();
    expect(
      parseInlineAtomSemanticHtmlEnvelope({
        payload: encode({ version: 1, type: "unknown", metadata: {} }),
        definitions,
      }),
    ).toBeNull();
    expect(
      parseInlineAtomSemanticHtmlEnvelope({
        payload: encode({
          version: 1,
          type: "mention",
          metadata: { id: 1, label: "Ada" },
        }),
        definitions,
      }),
    ).toBeNull();
  });
});
