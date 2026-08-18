import { describe, expect, it } from "vitest";
import {
  createBlockRichTextContentFromPlainText,
  richTextDocumentContentSize,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import { asBlockId } from "@repo/editor-core/kernel";
import { createBlockContentDocContext } from "@repo/editor-yjs";
import { ensureYjsBlockContent } from "../content/seed/ensure-yjs-block-content.ts";
import {
  readCanonicalYjsBlockContent,
  readCanonicalYjsTextType,
  writeCanonicalYjsBlockContent,
} from "@repo/editor-yjs";
import { createYjsRelativeTextPointCodec } from "./relative-text-point-codec.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000901");

describe("canonical Yjs relative text anchors", () => {
  it("keeps Yjs UTF-16 indexing behind the canonical code-point boundary", () => {
    const context = seeded("a😀b");
    const codec = createYjsRelativeTextPointCodec(context);
    const encoded = codec.encode({ blockId, offset: 2 }, { assoc: 1 });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const transported = JSON.parse(JSON.stringify(encoded.point));
    expect(codec.decode(transported)).toMatchObject({
      ok: true,
      point: { blockId, offset: 2 },
    });
    context.destroy();
  });

  it("identifies surrogate, ZWJ, hard-break, atom, and terminal positions identically", () => {
    const content: RichTextDocumentNodeJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "A\ud83d\ude42\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66e\u0301",
            },
            { type: "hard_break" },
            { type: "mention", metadata: { label: "rendered label" } },
            { type: "hard_break" },
          ],
        },
      ],
    };
    expect(richTextDocumentContentSize(content)).toBe(14);
    const context = seededContent(content);
    const yjsContent = readCanonicalYjsBlockContent(context);
    expect(yjsContent && richTextDocumentContentSize(yjsContent)).toBe(14);
    const codec = createYjsRelativeTextPointCodec(context);

    for (const offset of [0, 1, 2, 9, 11, 12, 13, 14]) {
      const encoded = codec.encode({ blockId, offset }, { assoc: 1 });
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) continue;
      expect(codec.decode(encoded.point)).toMatchObject({
        ok: true,
        point: { blockId, offset },
      });
    }

    context.destroy();
  });

  it("survives insertion before the anchored position", () => {
    const context = seeded("abcd");
    const codec = createYjsRelativeTextPointCodec(context);
    const encoded = codec.encode({ blockId, offset: 2 }, { assoc: 1 });
    if (!encoded.ok) throw new Error("anchor creation failed");
    write(context, "Xabcd");
    expect(codec.decode(encoded.point)).toMatchObject({
      ok: true,
      point: { offset: 3 },
    });
    context.destroy();
  });

  it("keeps neutral anchors stable across Yjs formatting items", () => {
    const context = seeded("abcdef");
    const codec = createYjsRelativeTextPointCodec(context);
    const start = codec.encode({ blockId, offset: 0 }, { assoc: 0 });
    const end = codec.encode({ blockId, offset: 5 }, { assoc: 0 });
    if (!start.ok || !end.ok) throw new Error("anchor creation failed");
    const text = readCanonicalYjsTextType(context);
    if (!text) throw new Error("missing canonical text");
    text.format(0, 5, { marks: "strong" });
    expect(codec.decode(start.point)).toMatchObject({ point: { offset: 0 } });
    expect(codec.decode(end.point)).toMatchObject({ point: { offset: 5 } });
    context.destroy();
  });

  it("retains association when inserted text is subsequently deleted", () => {
    const context = seeded("abcd");
    const codec = createYjsRelativeTextPointCodec(context);
    const backward = codec.encode({ blockId, offset: 2 }, { assoc: -1 });
    const forward = codec.encode({ blockId, offset: 2 }, { assoc: 1 });
    if (!backward.ok || !forward.ok) throw new Error("anchor creation failed");
    write(context, "abXcd");
    expect(codec.decode(backward.point)).toMatchObject({
      ok: true,
      point: { offset: 2 },
    });
    expect(codec.decode(forward.point)).toMatchObject({
      ok: true,
      point: { offset: 3 },
    });
    write(context, "abcd");
    expect(codec.decode(backward.point)).toMatchObject({ point: { offset: 2 } });
    expect(codec.decode(forward.point)).toMatchObject({ point: { offset: 2 } });
    context.destroy();
  });

  it("returns an explicit unresolved result when its text type is removed", () => {
    const context = seeded("abcd");
    const codec = createYjsRelativeTextPointCodec(context);
    const encoded = codec.encode({ blockId, offset: 2 });
    if (!encoded.ok) throw new Error("anchor creation failed");
    context.doc.transact(() => context.fragment.delete(0, 1));
    expect(codec.decode(encoded.point)).toEqual({
      ok: false,
      reason: "missing-content",
      point: encoded.point,
    });
    context.destroy();
  });
});

function seeded(text: string) {
  return seededContent(
    createBlockRichTextContentFromPlainText("paragraph", text),
  );
}

function seededContent(content: RichTextDocumentNodeJson) {
  const context = createBlockContentDocContext({ blockId });
  ensureYjsBlockContent(context, {
    blockType: "paragraph",
    doc: content,
  });
  return context;
}

function write(context: ReturnType<typeof seeded>, text: string): void {
  writeCanonicalYjsBlockContent(
    context,
    createBlockRichTextContentFromPlainText("paragraph", text),
    { kind: "test" },
  );
}
