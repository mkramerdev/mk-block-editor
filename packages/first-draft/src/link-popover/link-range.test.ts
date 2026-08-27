import { describe, expect, it } from "vitest";
import { linkMarkDefinition } from "@repo/editor-core/content/marks";
import type {
  RichTextDocumentNodeJson,
  RichTextInlineNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditor } from "@repo/editor-web/editor";
import { resolveFirstDraftLinkAtRange } from "./link-range.ts";

const blockId = "link-range" as BlockId;

describe("resolveFirstDraftLinkAtRange", () => {
  it("expands one hovered formatted leaf across the complete logical link", () => {
    const editor = editorFor([
      text("plain ", link("https://example.test", "Example", "_blank")),
      text("bold", link("https://example.test", "Example", "_blank"), {
        type: "strong",
      }),
      text(" italic", link("https://example.test", "Example", "_blank"), {
        type: "em",
      }),
      text(" stop"),
    ]);

    expect(
      resolveFirstDraftLinkAtRange(editor, blockId, { from: 6, to: 10 }),
    ).toEqual({
      blockId,
      range: { from: 0, to: 17 },
      attrs: {
        href: "https://example.test",
        title: "Example",
        target: "_blank",
      },
    });
  });

  it("keeps adjacent differently attributed links separate", () => {
    const editor = editorFor([
      text("first", link("/first")),
      text("second", link("/second")),
    ]);

    expect(
      resolveFirstDraftLinkAtRange(editor, blockId, { from: 1, to: 4 }),
    ).toMatchObject({ range: { from: 0, to: 5 }, attrs: { href: "/first" } });
    expect(
      resolveFirstDraftLinkAtRange(editor, blockId, { from: 5, to: 7 }),
    ).toMatchObject({ range: { from: 5, to: 11 }, attrs: { href: "/second" } });
  });

  it("uses canonical Unicode units and stops at hard breaks", () => {
    const same = link("emoji.test");
    const editor = editorFor([
      text("A😀", same),
      { type: "hard_break", marks: [same] },
      text("Z", same),
    ]);

    expect(
      resolveFirstDraftLinkAtRange(editor, blockId, { from: 1, to: 2 }),
    ).toMatchObject({
      range: { from: 0, to: 2 },
      attrs: { href: "https://emoji.test" },
    });
    expect(
      resolveFirstDraftLinkAtRange(editor, blockId, { from: 3, to: 4 }),
    ).toMatchObject({ range: { from: 3, to: 4 } });
    expect(
      resolveFirstDraftLinkAtRange(editor, blockId, { from: 2, to: 3 }),
    ).toBeNull();
  });

  it("rejects unlinked, unsafe, empty, missing, and deleted candidates", () => {
    const editor = editorFor([
      text("plain"),
      text("unsafe", { type: "link", attrs: { href: "javascript:x" } }),
    ]);
    expect(
      resolveFirstDraftLinkAtRange(editor, blockId, { from: 0, to: 2 }),
    ).toBeNull();
    expect(
      resolveFirstDraftLinkAtRange(editor, blockId, { from: 5, to: 7 }),
    ).toBeNull();
    expect(
      resolveFirstDraftLinkAtRange(editor, blockId, { from: 1, to: 1 }),
    ).toBeNull();
    expect(
      resolveFirstDraftLinkAtRange(editor, "missing" as BlockId, {
        from: 0,
        to: 1,
      }),
    ).toBeNull();
  });
});

function editorFor(content: readonly RichTextInlineNodeJson[]) {
  const documentNode: RichTextDocumentNodeJson = {
    type: "doc",
    content: [{ type: "paragraph", content }],
  };
  return {
    definition: { inlineMarks: [linkMarkDefinition] },
    getBlock(id: BlockId) {
      return id === blockId
        ? {
            id,
            type: "paragraph",
            parentId: null,
            tombstone: null,
            metadataVersion: "1",
            contentVersion: "1",
          }
        : null;
    },
    readBlockContent(id: BlockId) {
      return id === blockId ? documentNode : null;
    },
  } as unknown as Pick<
    EditableEditor,
    "definition" | "getBlock" | "readBlockContent"
  >;
}

function text(
  value: string,
  ...marks: ReadonlyArray<{
    readonly type: string;
    readonly attrs?: Record<string, unknown>;
  }>
): RichTextInlineNodeJson {
  return {
    type: "text",
    text: value,
    ...(marks.length ? { marks } : {}),
  } as RichTextInlineNodeJson;
}

function link(
  href: string,
  title: string | null = null,
  target: string | null = null,
) {
  return { type: "link" as const, attrs: { href, title, target } };
}
