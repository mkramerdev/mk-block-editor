import {
  cloneJsonValue,
  type JsonObject,
  type MutableJsonObject,
} from "@repo/editor-core/kernel";
import type {
  RichTextDocumentNodeJson,
  RichTextInlineNodeJson,
} from "@repo/editor-core/content/rich-text";

export function canonicalRichTextToProseMirrorJson(
  content: JsonObject,
): JsonObject {
  return mapJsonObject(content, "canonical-to-prosemirror");
}

export function proseMirrorRichTextToCanonicalJson(
  content: unknown,
): RichTextDocumentNodeJson {
  if (!isRecord(content)) {
    throw new TypeError("ProseMirror rich text must be a JSON object");
  }
  return mapJsonObject(
    content as JsonObject,
    "prosemirror-to-canonical",
  ) as RichTextDocumentNodeJson;
}

/** Converts only an affected ProseMirror inline fragment. */
export function proseMirrorInlineFragmentToCanonicalJson(
  content: unknown,
): readonly RichTextInlineNodeJson[] {
  if (content === null || content === undefined) return [];
  if (!Array.isArray(content)) {
    throw new TypeError("ProseMirror inline content must be an array");
  }
  const inline = unwrapTextBlock(content);
  return inline.map((node, index) => {
    if (!isRecord(node)) {
      throw new TypeError(
        `ProseMirror inline content[${index}] must be an object`,
      );
    }
    return mapJsonObject(
      node as JsonObject,
      "prosemirror-to-canonical",
    ) as RichTextInlineNodeJson;
  });
}

function unwrapTextBlock(content: readonly unknown[]): readonly unknown[] {
  if (content.length !== 1 || !isRecord(content[0])) return content;
  const node = content[0];
  return node.type === "paragraph"
    ? Array.isArray(node.content)
      ? node.content
      : []
    : content;
}

function mapJsonObject(
  value: JsonObject,
  direction: "canonical-to-prosemirror" | "prosemirror-to-canonical",
): JsonObject {
  const mapped: MutableJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "content" && Array.isArray(entry)) {
      mapped.content = entry.map((child) =>
        isRecord(child)
          ? mapJsonObject(child as JsonObject, direction)
          : cloneJsonValue(child),
      );
      continue;
    }
    mapped[key] = cloneJsonValue(entry);
  }
  if (
    direction === "canonical-to-prosemirror" &&
    isAtomNodeType(mapped.type) &&
    isRecord(mapped.metadata)
  ) {
    const metadata = cloneJsonValue(mapped.metadata as JsonObject);
    delete mapped.metadata;
    mapped.attrs = { metadata };
  } else if (
    direction === "prosemirror-to-canonical" &&
    isAtomNodeType(mapped.type) &&
    isRecord(mapped.attrs) &&
    Object.keys(mapped.attrs).length === 1 &&
    isRecord(mapped.attrs.metadata)
  ) {
    const metadata = cloneJsonValue(mapped.attrs.metadata as JsonObject);
    delete mapped.attrs;
    mapped.metadata = metadata;
  }
  return mapped;
}

function isAtomNodeType(type: unknown): type is string {
  return (
    typeof type === "string" &&
    type !== "doc" &&
    type !== "paragraph" &&
    type !== "text" &&
    type !== "hard_break"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
