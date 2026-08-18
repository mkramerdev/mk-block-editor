import type { BlockId } from "@repo/editor-core/kernel";
import { describe, expect, it } from "vitest";
import { EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS } from "../block-content/metadata/constants.ts";
import { createBlockContentDocContext } from "../block-content/doc/context.ts";
import { createBlockContentFragmentContext } from "./fragment-context.ts";

const BLOCK_A = "01890f07-1c00-7000-8000-000000001101" as BlockId;
const BLOCK_B = "01890f07-1c00-7000-8000-000000001102" as BlockId;

describe("fragment context", () => {
  it("creates fragment contexts only from a validated block content context", () => {
    const context = createBlockContentDocContext({
      blockId: BLOCK_A,
    });
    const childFragment = context.doc.getXmlFragment("nested-content:alpha");
    const child = createBlockContentFragmentContext(context, childFragment);

    expect(child.doc).toBe(context.doc);
    expect(child.fragment).toBe(childFragment);
    expect(child.getFragment()).toBe(childFragment);
    expect("metadata" in child).toBe(false);
  });

  it("rejects fragment contexts when parent block-content metadata is invalid", () => {
    const context = createBlockContentDocContext({
      blockId: BLOCK_A,
    });
    context.metadata.set(
      EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS.blockId,
      BLOCK_B,
    );

    expect(() =>
      createBlockContentFragmentContext(
        context,
        context.doc.getXmlFragment("nested-content:beta"),
      ),
    ).toThrow("block content metadata blockId does not match the context");
  });
});
