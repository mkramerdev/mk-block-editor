import { describe, expect, it } from "vitest";
import {
  boldMarkDefinition,
  linkMarkDefinition,
} from "@repo/editor-core/content/marks";
import { sanitizeEditorLinkUrl } from "@repo/editor-core/content/urls";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  createTextHtmlImportHandler,
  parseHtmlCanonicalFragment,
  parsePlainTextCanonicalFragment,
} from "../api/clipboard.ts";
import { createBlockLocalProseMirrorSchema } from "../api/schema.ts";
import { serializeBlockRichTextContentHtml } from "./serialize/prosemirror-html.ts";

const markSchema = createBlockLocalProseMirrorSchema({
  inlineMarks: [boldMarkDefinition, linkMarkDefinition],
});
const renderer = () => null;
const definitions: Readonly<Record<string, BlockDefinition>> = {
  paragraph: {
    kind: "text",
    type: "paragraph",
    renderer,
    rootLayout: "normal",
  },
  collection: {
    kind: "wrapper",
    type: "collection",
    renderer,
    rootLayout: "full",
    contentBoundary: true,
    content: { required: ["collectionGroup"], additional: "collectionGroup" },
  },
  collectionGroup: {
    kind: "wrapper",
    type: "collectionGroup",
    renderer,
    rootLayout: "normal",
    contentBoundary: true,
    content: { required: ["collectionText"], additional: "collectionText" },
  },
  collectionText: {
    kind: "text",
    type: "collectionText",
    renderer,
    rootLayout: "normal",
  },
};
const paragraphHtmlParser = createTextHtmlImportHandler({
  id: "test.paragraph",
  blockType: "paragraph",
  tags: ["p"],
});

describe("editor-dom clipboard adapters", () => {
  it("parses plain text directly into canonical paragraph records", () => {
    const fragment = parsePlainTextCanonicalFragment("Alpha\nBeta", {
      blockType: "paragraph",
      blockDefinitions: definitions,
    });
    expect(fragment?.blocks.map((block) => block.plainText)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(
      parsePlainTextCanonicalFragment("", {
        blockType: "paragraph",
        blockDefinitions: definitions,
      }),
    ).toBeNull();
  });

  it("parses rich HTML through explicit block parsers", () => {
    const fragment = parseHtmlCanonicalFragment(
      "<p>Hello <strong>Ada</strong></p>",
      "",
      {
        htmlImportHandlers: [paragraphHtmlParser],
        schema: markSchema,
        blockDefinitions: definitions,
      },
    );

    expect(fragment?.blocks).toHaveLength(1);
    expect(fragment?.blocks[0]).toMatchObject({
      type: "paragraph",
      plainText: "Hello Ada",
      content: {
        type: "doc",
        content: [expect.objectContaining({ type: "paragraph" })],
      },
    });
  });

  it("sanitizes clipboard links with the model inline link policy", () => {
    const fragment = parseHtmlCanonicalFragment(
      [
        '<p><a href="localhost:3000/docs">Local</a>',
        '<a href="javascript:alert(1)">Unsafe</a>',
        '<a href="example.test/article">Bare</a>',
        '<a href="//example.test/path">Protocol relative</a></p>',
      ].join(" "),
      "",
      {
        htmlImportHandlers: [paragraphHtmlParser],
        schema: markSchema,
        blockDefinitions: definitions,
      },
    );
    const entries = collectTextLinkEntries(fragment?.blocks[0]?.content);

    expect(sanitizeEditorLinkUrl("localhost:3000/docs")).toBe(
      "https://localhost:3000/docs",
    );
    expect(entries.find((entry) => entry.text.includes("Local"))?.href).toBe(
      sanitizeEditorLinkUrl("localhost:3000/docs"),
    );
    expect(
      entries.find((entry) => entry.text.includes("Unsafe"))?.href,
    ).toBeUndefined();
    expect(entries.find((entry) => entry.text.includes("Bare"))?.href).toBe(
      sanitizeEditorLinkUrl("example.test/article"),
    );
    expect(
      entries.find((entry) => entry.text.includes("Protocol relative"))?.href,
    ).toBe(sanitizeEditorLinkUrl("//example.test/path"));
  });

  it("rejects rich HTML when no explicit block parser is installed", () => {
    expect(
      parseHtmlCanonicalFragment("<p>Hello <strong>Ada</strong></p>", "", {
        blockDefinitions: definitions,
      }),
    ).toBeNull();
  });

  it("serializes default block-local rich text content to HTML", () => {
    const html = serializeBlockRichTextContentHtml(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello Ada", marks: [{ type: "strong" }] },
            ],
          },
        ],
      },
      "paragraph",
      { schema: markSchema },
    );

    expect(html).toContain("<strong");
    expect(html).toContain("Hello Ada");
  });
});

function collectTextLinkEntries(
  content: unknown,
): Array<{ text: string; href?: string }> {
  if (!isRecord(content)) return [];
  const entries: Array<{ text: string; href?: string }> = [];
  const stack: unknown[] = [content];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!isRecord(current)) continue;
    if (typeof current.text === "string") {
      const linkMark = Array.isArray(current.marks)
        ? current.marks.find(
            (mark) =>
              isRecord(mark) && mark.type === "link" && isRecord(mark.attrs),
          )
        : null;
      entries.push({
        text: current.text,
        ...(isRecord(linkMark) &&
        isRecord(linkMark.attrs) &&
        typeof linkMark.attrs.href === "string"
          ? { href: linkMark.attrs.href }
          : {}),
      });
    }
    if (Array.isArray(current.content)) {
      for (let index = current.content.length - 1; index >= 0; index -= 1)
        stack.push(current.content[index]);
    }
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
