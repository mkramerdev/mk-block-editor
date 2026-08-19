import { describe, expect, it, vi } from "vitest";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import { asBlockId } from "@repo/editor-core/kernel";
import {
  ensureCanonicalYjsBlockContent,
  readCanonicalYjsBlockContent,
  writeCanonicalYjsBlockContent,
} from "./canonical-rich-text.ts";
import { createBlockContentDocContext } from "./doc/context.ts";

function content(input: {
  readonly markAttrs: { readonly a: number; readonly b: number };
  readonly atomMetadata: { readonly a: number; readonly b: number };
  readonly ordered: readonly number[];
}): RichTextDocumentNodeJson {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "A",
            marks: [
              {
                type: "link",
                attrs: {
                  ...input.markAttrs,
                  ordered: input.ordered,
                },
              },
            ],
          },
          {
            type: "mention",
            metadata: {
              ...input.atomMetadata,
              ordered: input.ordered,
            },
          },
        ],
      },
    ],
  };
}

describe("canonical rich-text semantic equality", () => {
  it("does not rewrite Yjs units for reordered JSON attributes", () => {
    const context = createBlockContentDocContext({
      blockId: asBlockId("01890f07-1c00-7000-8000-000000000001"),
    });
    const initial = content({
      markAttrs: { a: 1, b: 2 },
      atomMetadata: { a: 1, b: 2 },
      ordered: [1, 2],
    });
    ensureCanonicalYjsBlockContent(context, initial, "initial");
    const update = vi.fn();
    context.doc.on("update", update);

    writeCanonicalYjsBlockContent(
      context,
      content({
        markAttrs: { b: 2, a: 1 },
        atomMetadata: { b: 2, a: 1 },
        ordered: [1, 2],
      }),
      "reordered",
    );

    expect(update).not.toHaveBeenCalled();
    expect(readCanonicalYjsBlockContent(context)).toEqual(initial);
    context.destroy();
  });

  it("still rewrites units for meaningful array-order changes", () => {
    const context = createBlockContentDocContext({
      blockId: asBlockId("01890f07-1c00-7000-8000-000000000002"),
    });
    const initial = content({
      markAttrs: { a: 1, b: 2 },
      atomMetadata: { a: 1, b: 2 },
      ordered: [1, 2],
    });
    const changed = content({
      markAttrs: { b: 2, a: 1 },
      atomMetadata: { b: 2, a: 1 },
      ordered: [2, 1],
    });
    ensureCanonicalYjsBlockContent(context, initial, "initial");
    const update = vi.fn();
    context.doc.on("update", update);

    writeCanonicalYjsBlockContent(context, changed, "changed");

    expect(update).toHaveBeenCalledOnce();
    expect(readCanonicalYjsBlockContent(context)).toEqual(changed);
    context.destroy();
  });
});
