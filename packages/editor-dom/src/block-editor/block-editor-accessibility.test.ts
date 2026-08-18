import { describe, expect, it } from "vitest";
import { getBlockEditorAttributes } from "./accessibility/attributes.ts";
import { testBlockId } from "../testing/block-editor-test-support.ts";

describe("block editor DOM contracts", () => {
  it("maps block metadata to DOM accessibility attributes", () => {
    const paragraphAttrs = getBlockEditorAttributes({
      blockId: testBlockId,
      blockType: "paragraph",
      label: "Body",
    });
    expect(paragraphAttrs.role).toBe("textbox");
    expect(paragraphAttrs["aria-multiline"]).toBe("true");
    expect(paragraphAttrs["aria-label"]).toBe("Body");

    const listItemAttrs = getBlockEditorAttributes({
      blockId: testBlockId,
      blockType: "bulletListItem",
    });
    expect(listItemAttrs.role).toBe("group");
    expect(listItemAttrs["aria-label"]).toBe("bulletListItem block");

    const listTextAttrs = getBlockEditorAttributes({
      blockId: testBlockId,
      blockType: "paragraph",
    });
    expect(listTextAttrs.role).toBe("textbox");
    expect(listTextAttrs["aria-multiline"]).toBe("true");
  });
});
