import { describe, expect, it } from "vitest";
import { getBlockEditorAttributes } from "./accessibility/attributes.ts";
import { testBlockId } from "../testing/block-editor-test-support.ts";

describe("block editor DOM contracts", () => {
  it("uses one neutral text accessibility contract for opaque block types", () => {
    const primaryAttrs = getBlockEditorAttributes({
      blockId: testBlockId,
      blockType: "textBlock",
      label: "Body",
    });
    expect(primaryAttrs.role).toBe("textbox");
    expect(primaryAttrs["aria-multiline"]).toBe("true");
    expect(primaryAttrs["aria-label"]).toBe("Body");

    const alternateAttrs = getBlockEditorAttributes({
      blockId: testBlockId,
      blockType: "alternateTextBlock",
    });
    expect(alternateAttrs.role).toBe("textbox");
    expect(alternateAttrs["aria-multiline"]).toBe("true");
    expect(alternateAttrs["aria-label"]).toBeUndefined();
  });
});
