import { describe, expect, it } from "vitest";
import { firstDraftBlockDefinitions } from "./first-draft-definition.tsx";
import { firstDraftBlockModelDefinitions } from "./server/block-definitions.ts";

describe("First Draft definition ownership", () => {
  it("extends one canonical block-model registry with one renderer per type", () => {
    expect(Object.keys(firstDraftBlockDefinitions)).toEqual(
      Object.keys(firstDraftBlockModelDefinitions),
    );
    for (const [type, model] of Object.entries(
      firstDraftBlockModelDefinitions,
    )) {
      const editable =
        firstDraftBlockDefinitions[
          type as keyof typeof firstDraftBlockDefinitions
        ];
      expect(editable.renderer, `${type} renderer`).toBeTypeOf("function");
      for (const [key, value] of Object.entries(model)) {
        expect(
          editable[key as keyof typeof editable],
          `${type}.${key}`,
        ).toEqual(value);
      }
    }
  });
});
