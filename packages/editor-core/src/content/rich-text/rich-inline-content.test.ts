import { describe, expect, expectTypeOf, it } from "vitest";
import {
  appendPlainTextToRichTextDocument,
  assertRichTextDocumentNodeJson,
  concatenateRichTextDocuments,
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  isRichTextDocument,
  mergeAdjacentTextNodes,
  normalizeRichTextDocument,
  removeTextRangeFromRichTextDocument,
  retargetRichTextDocument,
  richInlineContentSize,
  richInlineNodeSize,
  richTextBlock,
  richTextBlockInlineContent,
  richTextDocumentContentSize,
  richTextDocumentHasDurableInlineContent,
  richTextDocumentWithInlineContent,
  sliceRichTextDocument,
  textBlockNodeNameForBlockType,
  validateRichTextAttrsJson,
  validateRichTextBlockNodeJson,
  validateRichTextDocumentNodeJson,
  validateRichTextInlineNodeJson,
  validateRichTextMarkJson,
  type RichTextBlockNodeJson,
  type RichTextDocumentNodeJson,
  type RichTextInlineNodeJson,
} from "./rich-inline-content.ts";

describe("rich inline content contract", () => {
  it("uses one neutral rich-text block node for caller-owned text block types", () => {
    expect(textBlockNodeNameForBlockType("paragraph")).toBe("paragraph");
    expect(textBlockNodeNameForBlockType("heading")).toBe("paragraph");
    expect(textBlockNodeNameForBlockType("customText")).toBe("paragraph");
  });

  it("validates a document with block and text nodes", () => {
    const content: RichTextDocumentNodeJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    };

    const result = validateRichTextDocumentNodeJson(content);

    expect(result).toStrictEqual({ valid: true, value: content, errors: [] });
    expect(isRichTextDocument(content)).toBe(true);
    expect(() => assertRichTextDocumentNodeJson(content)).not.toThrow();
  });

  it("validates known marks with attrs", () => {
    const content: RichTextDocumentNodeJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Docs",
              marks: [
                {
                  type: "link",
                  attrs: { href: "/docs", title: null, target: null },
                },
              ],
            },
          ],
        },
      ],
    };

    expect(validateRichTextDocumentNodeJson(content).valid).toBe(true);
    expect(normalizeRichTextDocument("paragraph", content)).toStrictEqual(
      content,
    );
  });

  it("validates generic inline atom nodes without deriving display text", () => {
    const content: RichTextDocumentNodeJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hi " },
            {
              type: "mention",
              metadata: { id: "u1" },
            },
          ],
        },
      ],
    };

    expect(validateRichTextDocumentNodeJson(content).valid).toBe(true);
    expect(extractPlainTextFromRichTextDocument(content)).toBe("Hi ");
  });

  it("rejects invalid top-level, block, inline, mark, attrs, and nested JSON shapes", () => {
    expect(
      validateRichTextDocumentNodeJson({ type: "paragraph", content: [] })
        .errors,
    ).toContain("content.type must be doc");
    expect(validateRichTextBlockNodeJson({ type: "heading" }).errors).toContain(
      "block.type must be paragraph",
    );
    expect(validateRichTextInlineNodeJson({ type: "text" }).errors).toContain(
      "node.text must be a string",
    );
    expect(
      validateRichTextInlineNodeJson({ type: "image", attrs: {} }).errors,
    ).toContain("node.attrs is not supported");
    expect(validateRichTextMarkJson({ type: "not-a-mark" }).errors).toContain(
      "mark.type must be a known inline mark",
    );
    expect(
      validateRichTextMarkJson({ type: "strong", attrs: { ignored: true } })
        .errors,
    ).toContain("mark.attrs.ignored is not supported");
    expect(validateRichTextAttrsJson(["not", "attrs"]).errors).toContain(
      "attrs must be a JSON object",
    );
    expect(
      validateRichTextDocumentNodeJson({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                metadata: { id: "u1", bad: undefined },
              },
            ],
          },
        ],
      }).errors,
    ).toEqual(
      expect.arrayContaining([
        "content.content[0].content[0].metadata.bad must be a JSON value",
      ]),
    );
  });

  it("creates, normalizes, and retargets neutral rich text documents", () => {
    expect(
      createBlockRichTextContentFromPlainText("heading", "Title"),
    ).toStrictEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Title" }] },
      ],
    });
    expect(
      isRichTextDocument({ type: "doc", content: [{ type: "paragraph" }] }),
    ).toBe(true);
    expect(isRichTextDocument({ type: "doc", content: [] })).toBe(true);
    expect(
      normalizeRichTextDocument(
        "paragraph",
        createBlockRichTextContentFromPlainText("paragraph", "Hello"),
      ),
    ).toStrictEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ],
    });

    const heading = retargetRichTextDocument(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { level: 9 },
            content: [{ type: "text", text: "Title" }],
          },
        ],
      },
      "heading",
    );
    expect(heading).toStrictEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Title" }] },
      ],
    });
    expect(richTextBlock({ type: "doc", content: [] })).toStrictEqual({
      type: "paragraph",
    });
    expect(
      richTextDocumentWithInlineContent(
        "paragraph",
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { level: 2 },
              content: [{ type: "text", text: "Old" }],
            },
          ],
        },
        [{ type: "text", text: "New" }],
      ),
    ).toStrictEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "New" }] },
      ],
    });
  });

  it("preserves adjacent marks when slicing or deleting rich inline JSON", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "ab", marks: [{ type: "strong" }] },
            { type: "text", text: "cd", marks: [{ type: "em" }] },
          ],
        },
      ],
    } satisfies RichTextDocumentNodeJson;

    expect(
      removeTextRangeFromRichTextDocument("paragraph", content, 1, 3),
    ).toStrictEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [{ type: "strong" }] },
            { type: "text", text: "d", marks: [{ type: "em" }] },
          ],
        },
      ],
    });
  });

  it("uses rich inline text units when sizing, slicing, and deleting astral text", () => {
    const content = createBlockRichTextContentFromPlainText(
      "paragraph",
      "a\u{1F600}b",
    );

    expect(richTextDocumentContentSize(content)).toBe(3);
    expect(sliceRichTextDocument("paragraph", content, 1, 2)).toStrictEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "\u{1F600}" }] },
      ],
    });
    expect(
      removeTextRangeFromRichTextDocument("paragraph", content, 1, 2),
    ).toStrictEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "ab" }] }],
    });
  });

  it("slices, concatenates, appends, and sizes hard breaks and inline atoms exactly", () => {
    const content: RichTextDocumentNodeJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A" },
            { type: "hard_break" },
            {
              type: "mention",
              metadata: { id: "u1" },
            },
            { type: "text", text: "Z" },
          ],
        },
      ],
    };

    expect(richTextBlockInlineContent(content)).toStrictEqual([
      { type: "text", text: "A" },
      { type: "hard_break" },
      {
        type: "mention",
        metadata: { id: "u1" },
      },
      { type: "text", text: "Z" },
    ]);
    expect(richInlineNodeSize({ type: "hard_break" })).toBe(1);
    expect(richInlineContentSize(richTextBlockInlineContent(content))).toBe(4);
    expect(richTextDocumentContentSize(content)).toBe(4);
    expect(richTextDocumentHasDurableInlineContent(content)).toBe(true);
    expect(sliceRichTextDocument("paragraph", content, 1, 3)).toStrictEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "hard_break" },
            {
              type: "mention",
              metadata: { id: "u1" },
            },
          ],
        },
      ],
    });
    expect(
      concatenateRichTextDocuments(
        "paragraph",
        createBlockRichTextContentFromPlainText("paragraph", "Hi"),
        createBlockRichTextContentFromPlainText("paragraph", "!"),
      ),
    ).toStrictEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hi!" }] },
      ],
    });
    expect(
      appendPlainTextToRichTextDocument(
        "paragraph",
        createBlockRichTextContentFromPlainText("paragraph", "Hi"),
        " there",
      ),
    ).toStrictEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hi there" }] },
      ],
    });
    expect(
      richTextDocumentWithInlineContent("paragraph", content, []),
    ).toStrictEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("merges adjacent text nodes only when normalized marks are equal", () => {
    expect(
      mergeAdjacentTextNodes([
        { type: "text", text: "A", marks: [{ type: "strong" }] },
        { type: "text", text: "B", marks: [{ type: "strong" }] },
        { type: "text", text: "C", marks: [{ type: "em" }] },
        { type: "text", text: "D" },
      ]),
    ).toStrictEqual([
      { type: "text", text: "AB", marks: [{ type: "strong" }] },
      { type: "text", text: "C", marks: [{ type: "em" }] },
      { type: "text", text: "D" },
    ]);
  });

  it("distinguishes helper return types for documents, blocks, and inline nodes", () => {
    const document = createBlockRichTextContentFromPlainText(
      "paragraph",
      "Hello",
    );
    const block = richTextBlock(document);
    const inlineContent = richTextBlockInlineContent(document);

    expectTypeOf(document).toEqualTypeOf<RichTextDocumentNodeJson>();
    expectTypeOf(block).toEqualTypeOf<RichTextBlockNodeJson>();
    expectTypeOf(inlineContent).toEqualTypeOf<RichTextInlineNodeJson[]>();
    expect(document.type).toBe("doc");
    expect(block.type).toBe("paragraph");
    expect(inlineContent[0]?.type).toBe("text");
  });
});
