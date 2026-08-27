import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { boldMarkDefinition } from "@repo/editor-core/content/marks";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  createTextHtmlImportHandler,
  parseHtmlCanonicalFragment,
} from "./api/clipboard.ts";
import { createBlockLocalProseMirrorSchema } from "./api/schema.ts";
import { serializeBlockRichTextContentHtml } from "./clipboard/serialize/prosemirror-html.ts";

const markSchema = createBlockLocalProseMirrorSchema({
  inlineMarks: [boldMarkDefinition],
});
const definitions: Readonly<Record<string, BlockDefinition>> = {
  textBlock: {
    kind: "text",
    type: "textBlock",
  },
};
const paragraphHtmlParser = createTextHtmlImportHandler({
  id: "contract.paragraph",
  blockType: "textBlock",
  tags: ["p"],
});

describe("editor-dom public contracts", () => {
  it("owns semantic rich-text HTML parse and serialize behavior", () => {
    const fragment = parseHtmlCanonicalFragment(
      "<p>Hello <strong>Ada</strong></p>",
      "",
      {
        htmlImportHandlers: [paragraphHtmlParser],
        schema: markSchema,
        blockDefinitions: definitions,
      },
    );
    expect(fragment?.blocks[0]).toMatchObject({
      type: "textBlock",
      plainText: "Hello Ada",
    });
    expect(fragment?.blocks[0]?.content).toMatchObject({
      type: "doc",
      content: [expect.objectContaining({ type: "paragraph" })],
    });

    const rich = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello Ada", marks: [{ type: "strong" }] },
          ],
        },
      ],
    };
    expect(
      serializeBlockRichTextContentHtml(rich, "textBlock", {
        schema: markSchema,
      }),
    ).toContain("<strong");
  });

  it("enforces editor-dom package boundaries in production source", () => {
    const srcRoot = join(process.cwd(), "src");
    const productionFiles = scanFiles(srcRoot).filter(
      (path) =>
        path.endsWith(".ts") &&
        !path.endsWith(".test.ts") &&
        !path.includes(`${pathSeparator()}testing${pathSeparator()}`),
    );
    const implementationFiles = productionFiles.filter(
      (path) => !path.includes(`${pathSeparator()}api${pathSeparator()}`),
    );
    const forbiddenImport =
      /from\s+["'](?:react|react-dom|react-native|yjs|y-prosemirror|@repo\/editor-core(?:\/variants)?|@repo\/editor-react(?:\/[^"']*)?|@repo\/editor-web(?:\/[^"']*)?|@repo\/editor-yjs(?:\/[^"']*)?|@repo\/editor-yjs-dom(?:\/[^"']*)?|@repo\/editor-storage(?:-[^/"']+)?(?:\/[^"']*)?)["']/;
    const directProseMirrorImport =
      /from\s+["']prosemirror-(?:model|state|view|commands|keymap|dropcursor)["']/;
    const implementationApiImport =
      /from\s+["'](?:\.\.?\/)+api(?:\/[^"']*)?["']/;
    const violations = productionFiles.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      const messages: string[] = [];
      if (forbiddenImport.test(text))
        messages.push(relative(process.cwd(), path));
      if (
        !path.endsWith(
          `${pathSeparator()}prosemirror${pathSeparator()}index.ts`,
        ) &&
        directProseMirrorImport.test(text)
      ) {
        messages.push(relative(process.cwd(), path));
      }
      return messages;
    });
    const apiImportViolations = implementationFiles
      .filter((path) =>
        implementationApiImport.test(readFileSync(path, "utf8")),
      )
      .map((path) => relative(process.cwd(), path));

    expect(violations).toStrictEqual([]);
    expect(apiImportViolations).toStrictEqual([]);
  });
});

function scanFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (["dist", "coverage", "node_modules"].includes(entry)) continue;
      found.push(...scanFiles(path));
      continue;
    }
    found.push(path);
  }
  return found;
}

function pathSeparator(): "\\" | "/" {
  return process.platform === "win32" ? "\\" : "/";
}
