import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import { createCanonicalBlockFragment } from "@repo/editor-core/editing";
import { asBlockId } from "@repo/editor-core/kernel";
import { wholeSelection } from "@repo/editor-core/selection";
import { describe, expect, it } from "vitest";
import { resolveCanonicalCreationSelection } from "./canonical-creation-selection.ts";

const definitions: Readonly<Record<string, BlockDefinition>> = {
  textBlock: {
    kind: "text",
    type: "textBlock",
  },
  nonContentText: {
    kind: "text",
    type: "nonContentText",
    selection: wholeSelection(),
  },
  atomicBlock: {
    kind: "atomic",
    type: "atomicBlock",
  },
};

describe("canonical creation selection resolution", () => {
  it("rejects an ID outside the fragment", () => {
    const fragment = textFragment("textBlock", "abc");
    expect(
      resolveCanonicalCreationSelection(fragment, definitions, {
        selectionBlockId: asBlockId("outside"),
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("outside") });
  });

  it("rejects a text target whose definition has a block endpoint", () => {
    const fragment = textFragment("nonContentText", "abc");
    expect(
      resolveCanonicalCreationSelection(fragment, definitions, {
        selectionBlockId: fragment.rootBlockIds[0]!,
        selectionOffset: 0,
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("not a content endpoint"),
    });
  });

  it("rejects invalid text offsets and offsets on atomic targets", () => {
    const text = textFragment("textBlock", "abc");
    expect(
      resolveCanonicalCreationSelection(text, definitions, {
        selectionBlockId: text.rootBlockIds[0]!,
        selectionOffset: 4,
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("offset") });

    const atomicId = asBlockId("atomic-target");
    const atomic = createCanonicalBlockFragment({
      blocks: [{ id: atomicId, type: "atomicBlock", parentId: null }],
      rootBlockIds: [atomicId],
      start: { kind: "block", blockId: atomicId },
      end: { kind: "block", blockId: atomicId },
      blockDefinitions: definitions,
    });
    expect(
      resolveCanonicalCreationSelection(atomic, definitions, {
        selectionBlockId: atomicId,
        selectionOffset: 0,
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("offset") });
  });
});

function textFragment(type: "textBlock" | "nonContentText", text: string) {
  const id = asBlockId(`${type}-target`);
  return createCanonicalBlockFragment({
    blocks: [
      {
        id,
        type,
        parentId: null,
        content: createBlockRichTextContentFromPlainText(type, text),
        plainText: text,
      },
    ],
    rootBlockIds: [id],
    start: { kind: "text", blockId: id },
    end: { kind: "text", blockId: id },
    blockDefinitions: definitions,
  });
}
