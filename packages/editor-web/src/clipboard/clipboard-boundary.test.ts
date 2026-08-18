import { describe, expect, it, vi } from "vitest";
import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
} from "@repo/editor-core/content/rich-text";
import {
  boldMarkDefinition,
  linkMarkDefinition,
} from "@repo/editor-core/content/marks";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  type CanonicalBlockFragment,
  type CanonicalBlockRecord,
} from "@repo/editor-core/editing";
import { createBlockLocalProseMirrorSchema } from "@repo/editor-dom/schema";
import {
  createTextHtmlImportHandler,
  parseHtmlCanonicalFragment,
} from "@repo/editor-dom/clipboard";
import type { EditorSelectionSnapshot } from "@repo/editor-react/selection";
import { createEditorClipboardBoundary } from "./boundary.ts";
import {
  parseCanonicalBlockFragmentWirePayload,
  serializeCanonicalBlockFragmentWirePayload,
} from "./wire-codec.ts";
import {
  createSingleTextBlockPlainTextImportHandler,
  exportCanonicalFragmentPlainText,
  importCanonicalFragmentPlainText,
} from "./canonical-plain-text.ts";

const renderer = () => null;
const definitions: Readonly<Record<string, BlockDefinition>> = {
  paragraph: {
    kind: "text",
    type: "paragraph",
    renderer,
    rootLayout: "normal",
  },
  heading: {
    kind: "text",
    type: "heading",
    renderer,
    rootLayout: "normal",
  },
  callout: {
    kind: "wrapper",
    type: "callout",
    renderer,
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["block"], additional: "block" },
    defaultContent: "paragraph",
  },
  divider: {
    kind: "atomic",
    type: "divider",
    renderer,
    rootLayout: "normal",
  },
  image: {
    kind: "atomic",
    type: "image",
    renderer,
    rootLayout: "normal",
  },
};
const schema = createBlockLocalProseMirrorSchema({
  inlineMarks: [boldMarkDefinition, linkMarkDefinition],
});
const wireOptions = { blockDefinitions: definitions };
const selection = {} as EditorSelectionSnapshot;

describe("canonical clipboard wire codec", () => {
  it("round-trips partial text with structural boundary paths and fresh IDs", () => {
    const source = textFragment("Selected", "text");
    const encoded = serializeCanonicalBlockFragmentWirePayload(
      source,
      wireOptions,
    );
    const payload = JSON.parse(encoded) as Record<string, unknown>;
    const decoded = parseCanonicalBlockFragmentWirePayload(
      encoded,
      wireOptions,
    );

    expect(payload).toMatchObject({
      kind: "repo.editor.blocks",
      version: 1,
      start: { kind: "text", path: [0] },
      end: { kind: "text", path: [0] },
    });
    expect(encoded).not.toContain(source.blocks[0]!.id);
    expect(JSON.stringify(payload.roots)).not.toMatch(
      /"(?:id|parentId|selectionFragment|sourceBlockId|coverage)"/,
    );
    expect(decoded?.blocks[0]?.id).not.toBe(source.blocks[0]!.id);
    expect(decoded?.blocks[0]?.plainText).toBe("Selected");
    expect(decoded?.start.kind).toBe("text");
  });

  it("round-trips complete, multi-root, nested, and atomic fragments", () => {
    for (const source of [
      textFragment("Complete", "block"),
      multiRootFragment(),
      wrapperFragment(),
      atomicFragment(),
    ]) {
      const decoded = parseCanonicalBlockFragmentWirePayload(
        serializeCanonicalBlockFragmentWirePayload(source, wireOptions),
        wireOptions,
      );
      expect(decoded?.blocks.map((block) => block.type)).toEqual(
        source.blocks.map((block) => block.type),
      );
      expect(decoded?.rootBlockIds).toHaveLength(source.rootBlockIds.length);
      expect(decoded?.start.kind).toBe(source.start.kind);
      expect(decoded?.end.kind).toBe(source.end.kind);
      expect(decoded?.blocks.map((block) => block.id)).not.toEqual(
        source.blocks.map((block) => block.id),
      );
    }
  });

  it("rejects unknown versions, fields, invalid paths, depth, and size", () => {
    const valid = JSON.parse(
      serializeCanonicalBlockFragmentWirePayload(
        textFragment("A", "text"),
        wireOptions,
      ),
    ) as Record<string, unknown>;
    expect(
      parseCanonicalBlockFragmentWirePayload(
        JSON.stringify({ ...valid, version: 2 }),
        wireOptions,
      ),
    ).toBeNull();
    expect(
      parseCanonicalBlockFragmentWirePayload(
        JSON.stringify({ ...valid, legacy: true }),
        wireOptions,
      ),
    ).toBeNull();
    expect(
      parseCanonicalBlockFragmentWirePayload(
        JSON.stringify(valid).replace(
          '"kind":"repo.editor.blocks"',
          '"kind":"repo.editor.blocks","kind":"repo.editor.blocks"',
        ),
        wireOptions,
      ),
    ).toBeNull();
    expect(
      parseCanonicalBlockFragmentWirePayload(
        JSON.stringify({
          ...valid,
          start: { kind: "text", path: [9] },
        }),
        wireOptions,
      ),
    ).toBeNull();
    expect(
      parseCanonicalBlockFragmentWirePayload(
        JSON.stringify({
          kind: "repo.editor.blocks",
          version: 1,
          roots: [
            {
              type: "callout",
              children: [
                {
                  type: "callout",
                  children: [
                    {
                      type: "paragraph",
                      content: richText("A"),
                      plainText: "A",
                    },
                  ],
                },
              ],
            },
          ],
          start: { kind: "block", path: [0] },
          end: { kind: "block", path: [0] },
        }),
        { ...wireOptions, limits: { maxNestingDepth: 2 } },
      ),
    ).toBeNull();
    expect(
      parseCanonicalBlockFragmentWirePayload(JSON.stringify(valid), {
        ...wireOptions,
        limits: { maxCanonicalPayloadBytes: 10 },
      }),
    ).toBeNull();
    expect(
      parseCanonicalBlockFragmentWirePayload(
        JSON.stringify({
          ...valid,
          roots: [...(valid.roots as unknown[]), ...(valid.roots as unknown[])],
          end: { kind: "text", path: [1] },
        }),
        { ...wireOptions, limits: { maxFragmentBlocks: 1 } },
      ),
    ).toBeNull();
  });

  it("rejects text mismatches and content on non-text wire nodes", () => {
    const valid = JSON.parse(
      serializeCanonicalBlockFragmentWirePayload(
        textFragment("A", "text"),
        wireOptions,
      ),
    ) as {
      roots: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    expect(
      parseCanonicalBlockFragmentWirePayload(
        JSON.stringify({
          ...valid,
          roots: [{ ...valid.roots[0], plainText: "different" }],
        }),
        wireOptions,
      ),
    ).toBeNull();
    expect(
      parseCanonicalBlockFragmentWirePayload(
        JSON.stringify({
          ...valid,
          roots: [
            {
              type: "image",
              content: richText("forbidden"),
              plainText: "forbidden",
            },
          ],
          start: { kind: "block", path: [0] },
          end: { kind: "block", path: [0] },
        }),
        wireOptions,
      ),
    ).toBeNull();
  });

  it("rejects hostile keys, invalid text encoding, controls, and primitive nodes", () => {
    const valid = JSON.parse(
      serializeCanonicalBlockFragmentWirePayload(
        textFragment("A", "text"),
        wireOptions,
      ),
    ) as {
      roots: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const candidates = [
      serializeCanonicalBlockFragmentWirePayload(
        textFragment("A", "text"),
        wireOptions,
      ).replace('"version":1', '"version":1,"version":1'),
      JSON.stringify({
        ...valid,
        roots: [{ ...valid.roots[0], metadata: { constructor: "bad" } }],
      }),
      JSON.stringify({
        ...valid,
        roots: [{ ...valid.roots[0], plainText: "\ud800" }],
      }),
      JSON.stringify({
        ...valid,
        roots: [{ ...valid.roots[0], plainText: "bad\u0000text" }],
      }),
      JSON.stringify({ ...valid, roots: [1] }),
    ];

    for (const candidate of candidates) {
      expect(
        parseCanonicalBlockFragmentWirePayload(candidate, wireOptions),
      ).toBeNull();
    }
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});

describe("clipboard format boundary", () => {
  it("negotiates canonical HTML before generic HTML and plain text", () => {
    const written = new MemoryDataTransfer();
    boundary({ materializeSelection: () => textFragment("Canonical", "text") })
      .writeSelection(written.asDataTransfer(), selection);
    const data = new MemoryDataTransfer({
      "text/html": written.values.get("text/html")!,
      "text/plain": "Plain",
    });
    expect(
      boundary().readClipboardBlocks(data.asDataTransfer())?.blocks[0]
        ?.plainText,
    ).toBe("Canonical");
    expect(data.reads).toEqual(["text/html"]);
  });

  it("reads each fallback format once in HTML then plain order", () => {
    const missingCanonical = new MemoryDataTransfer({
      "text/html": "<p>HTML</p>",
      "text/plain": "Plain",
    });
    expect(
      boundary().readClipboardBlocks(missingCanonical.asDataTransfer())?.blocks[0]
        ?.plainText,
    ).toBe("HTML");
    expect(missingCanonical.reads).toEqual(["text/html", "text/plain"]);

    const invalidCandidates = new MemoryDataTransfer({
      "text/html": "<script>invalid()</script>",
      "text/plain": "Plain",
    });
    expect(
      boundary().readClipboardBlocks(invalidCandidates.asDataTransfer())?.blocks[0]
        ?.plainText,
    ).toBe("Plain");
    expect(invalidCandidates.reads).toEqual(["text/html", "text/plain"]);
  });

  it("falls through independently from invalid canonical HTML to generic HTML and plain text", () => {
    const htmlData = new MemoryDataTransfer({
      "text/html":
        '<div data-editor-canonical-fragment="%7B%22version%22%3A0%7D"><section><p>HTML</p></section></div>',
      "text/plain": "Plain",
    });
    expect(
      boundary().readClipboardBlocks(htmlData.asDataTransfer())?.blocks[0]
        ?.plainText,
    ).toBe("HTML");

    const textData = new MemoryDataTransfer({
      "text/html": "<script>bad()</script>",
      "text/plain": "Plain",
    });
    expect(
      boundary().readClipboardBlocks(textData.asDataTransfer())?.blocks[0]
        ?.plainText,
    ).toBe("Plain");
    expect(
      boundary().readClipboardBlocks(new MemoryDataTransfer().asDataTransfer()),
    ).toBeNull();
  });

  it("does not recognize the retired MIME and enforces HTML/plain-text sizes", () => {
    const oldMime = [
      "application/vnd.repo.editor.",
      "global-selection+json",
    ].join("");
    const retired = new MemoryDataTransfer({
      [oldMime]: serializeCanonicalBlockFragmentWirePayload(
        textFragment("Old", "text"),
        wireOptions,
      ),
      "text/plain": "Ordinary",
    });
    expect(
      boundary().readClipboardBlocks(retired.asDataTransfer())?.blocks[0]
        ?.plainText,
    ).toBe("Ordinary");
    expect(
      boundary({
        limits: { maxHtmlBytes: 5 },
      }).readClipboardBlocks(
        new MemoryDataTransfer({
          "text/html": "<p>Too long</p>",
        }).asDataTransfer(),
      ),
    ).toBeNull();
    expect(
      boundary({
        limits: { maxPlainTextBytes: 3 },
      }).readClipboardBlocks(
        new MemoryDataTransfer({ "text/plain": "Long" }).asDataTransfer(),
      ),
    ).toBeNull();
  });

  it("produces one origin-independent canonical shape for the common text subset", () => {
    const direct = textFragment("Common text", "text");
    const written = new MemoryDataTransfer();
    boundary({ materializeSelection: () => direct }).writeSelection(
      written.asDataTransfer(),
      selection,
    );
    const candidates = [
      boundary().readClipboardBlocks(
        new MemoryDataTransfer({
          "text/html": written.values.get("text/html")!,
        }).asDataTransfer(),
      ),
      boundary().readClipboardBlocks(
        new MemoryDataTransfer({
          "text/html": "<p>Common text</p>",
        }).asDataTransfer(),
      ),
      boundary().readClipboardBlocks(
        new MemoryDataTransfer({
          "text/plain": "Common text",
        }).asDataTransfer(),
      ),
      importCanonicalFragmentPlainText("Common text", {
        blockDefinitions: definitions,
        defaultTextBlockType: "paragraph",
      }),
      direct,
    ];

    expect(candidates.every(Boolean)).toBe(true);
    expect(candidates.map(canonicalSemanticSignature)).toEqual(
      Array.from({ length: candidates.length }, () =>
        canonicalSemanticSignature(direct),
      ),
    );
    expect(
      new Set(
        candidates
          .slice(0, -1)
          .flatMap(
            (fragment) => fragment?.blocks.map((block) => block.id) ?? [],
          ),
      ).size,
    ).toBe(candidates.length - 1);
  });

  it("materializes once and derives plain text and canonical semantic HTML", () => {
    const materializeSelection = vi.fn(() => textFragment("Hello", "block"));
    const target = new MemoryDataTransfer();
    const result = boundary({ materializeSelection }).writeSelection(
      target.asDataTransfer(),
      selection,
    );

    expect(result).toBe(true);
    expect(materializeSelection).toHaveBeenCalledTimes(1);
    expect(target.values.get("text/plain")).toBe("Hello");
    expect(target.writes).toEqual([
      "text/plain",
      "text/html",
    ]);
    expect(target.values.get("text/html")).toContain("<p>");
    expect(target.values.get("text/html")).toContain(
      'data-editor-canonical-fragment="',
    );
    expect(target.values.get("text/html")).not.toContain(
      textFragment("unrelated", "block").blocks[0]!.id,
    );
  });

  it("round-trips the validated canonical fragment from HTML alone", () => {
    const source = textFragment("HTML transport", "block");
    const written = new MemoryDataTransfer();
    expect(
      boundary({ materializeSelection: () => source }).writeSelection(
        written.asDataTransfer(),
        selection,
      ),
    ).toBe(true);
    const html = written.values.get("text/html")!;
    const imported = boundary().readClipboardBlocks(
      new MemoryDataTransfer({ "text/html": html }).asDataTransfer(),
    );
    expect(imported?.blocks.map((block) => block.plainText)).toEqual([
      "HTML transport",
    ]);
    expect(imported?.blocks[0]?.id).not.toBe(source.blocks[0]?.id);
  });

  it("uses plain text as the required write and treats HTML as optional", () => {
    const fragment = textFragment("A", "block");
    const optionalFailure = new MemoryDataTransfer(
      {},
      new Set(["text/html"]),
    );
    expect(
      boundary({
        materializeSelection: () => fragment,
      }).writeSelection(optionalFailure.asDataTransfer(), selection),
    ).toBe(true);
    expect(optionalFailure.values.get("text/plain")).toBe("A");

    const requiredFailure = new MemoryDataTransfer({}, new Set(["text/plain"]));
    expect(
      boundary({
        materializeSelection: () => fragment,
      }).writeSelection(requiredFailure.asDataTransfer(), selection),
    ).toBe(false);
  });

  it("writes nothing when selection materialization fails", () => {
    const target = new MemoryDataTransfer();
    expect(
      boundary({
        materializeSelection: () => ({ ok: false }),
      }).writeSelection(target.asDataTransfer(), selection),
    ).toBe(false);
    expect(target.values.size).toBe(0);
    expect(
      boundary({
        materializeSelection: () => {
          throw new Error("stale selection");
        },
      }).writeSelection(target.asDataTransfer(), selection),
    ).toBe(false);
    expect(target.values.size).toBe(0);
  });
});

describe("semantic HTML and plain text codecs", () => {
  it.each([
    "A\n\nB",
    "\nleading",
    "trailing\n",
    "\n\n",
    "café\n🙂\n👨‍👩‍👧‍👦",
  ])("imports %j as one canonical text block with semantic hard breaks", (text) => {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const fragment = importCanonicalFragmentPlainText(text, {
      blockDefinitions: definitions,
      defaultTextBlockType: "paragraph",
      importHandlers: [createSingleTextBlockPlainTextImportHandler()],
    });
    expect(fragment?.blocks).toHaveLength(1);
    expect(fragment?.start).toEqual({ kind: "text", blockId: fragment?.blocks[0]?.id });
    expect(fragment?.end).toEqual(fragment?.start);
    expect(fragment?.blocks[0]?.plainText).toBe(normalized);
    expect(extractPlainTextFromRichTextDocument(fragment!.blocks[0]!.content!)).toBe(normalized);
    expect(fragment?.blocks[0]?.content?.content[0]?.content?.filter((node) => node.type === "hard_break")).toHaveLength(
      Array.from(normalized).filter((value) => value === "\n").length,
    );
    expect(
      exportCanonicalFragmentPlainText(fragment!, {
        blockDefinitions: definitions,
        defaultTextBlockType: "paragraph",
      }),
    ).toBe(normalized);
  });

  it("normalizes CRLF and CR before creating semantic hard breaks", () => {
    const fragment = importCanonicalFragmentPlainText("A\r\n\rB", {
      blockDefinitions: definitions,
      defaultTextBlockType: "paragraph",
      importHandlers: [createSingleTextBlockPlainTextImportHandler()],
    });
    expect(fragment?.blocks[0]?.plainText).toBe("A\n\nB");
  });
  it("exports paragraphs, headings, marks, flattened wrappers, and safe atomics", () => {
    const coherent = semanticFixture();
    const target = new MemoryDataTransfer();
    expect(
      boundary({
        materializeSelection: () => coherent,
      }).writeSelection(target.asDataTransfer(), selection),
    ).toBe(true);
    const html = target.values.get("text/html") ?? "";
    expect(html).toContain("<p>");
    expect(html).toContain("<strong>");
    expect(html).toContain("<h2>");
    expect(html).toContain("<hr>");
    expect(html).toContain('data-editor-canonical-fragment="');
    expect(html).not.toMatch(/onclick|javascript:/);
  });

  it("exports partial text without a block wrapper and delegates supported atomics", () => {
    const partial = new MemoryDataTransfer();
    expect(
      boundary({
        materializeSelection: () => textFragment("Inline", "text"),
      }).writeSelection(partial.asDataTransfer(), selection),
    ).toBe(true);
    expect(partial.values.get("text/html")).toContain(">Inline</div>");

    const image = createCanonicalBlockRecord({ type: "image" });
    const imageFragment = createCanonicalBlockFragment({
      blocks: [image],
      rootBlockIds: [image.id],
      start: { kind: "block", blockId: image.id },
      end: { kind: "block", blockId: image.id },
      blockDefinitions: definitions,
    });
    const supported = new MemoryDataTransfer();
    expect(
      boundary({
        materializeSelection: () => imageFragment,
        htmlExportHandlers: [
          {
            id: "image.semantic",
            export(block, context) {
              if (block.type !== "image") return null;
              const figure = context.document.createElement("figure");
              figure.textContent = "Image";
              return figure;
            },
          },
        ],
      }).writeSelection(supported.asDataTransfer(), selection),
    ).toBe(true);
    expect(supported.values.get("text/html")).toContain(
      "<figure>Image</figure>",
    );
  });

  it("imports semantic rich text and sanitized links with fresh IDs", () => {
    const data = new MemoryDataTransfer({
      "text/html":
        '<h3 onclick="bad()">Title</h3><p><strong>Bold</strong> <a href="javascript:bad()">Link</a></p>',
    });
    const imported = boundary().readClipboardBlocks(data.asDataTransfer());
    expect(imported?.blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
    ]);
    expect(imported?.blocks.map((block) => block.plainText)).toEqual([
      "Title",
      "Bold Link",
    ]);
    expect(imported?.blocks[0]?.metadata).toEqual({ level: 3 });
    expect(JSON.stringify(imported?.blocks[1]?.content)).toContain("strong");
    expect(JSON.stringify(imported?.blocks[1]?.content)).not.toContain(
      "javascript:",
    );
  });

  it("sanitizes unsafe semantic output contributed by block definitions", () => {
    const image = createCanonicalBlockRecord({ type: "image" });
    const imageFragment = createCanonicalBlockFragment({
      blocks: [image],
      rootBlockIds: [image.id],
      start: { kind: "block", blockId: image.id },
      end: { kind: "block", blockId: image.id },
      blockDefinitions: definitions,
    });
    const target = new MemoryDataTransfer();
    expect(
      boundary({
        materializeSelection: () => imageFragment,
        htmlExportHandlers: [
          {
            id: "image.hostile",
            export(block, context) {
              if (block.type !== "image") return null;
              const figure = context.document.createElement("figure");
              figure.innerHTML =
                '<script>bad()</script><a href="javascript:bad()" onclick="bad()" style="display:none" data-editor-state="hidden">Image</a><img src="data:text/html,bad" srcset="bad">';
              return figure;
            },
          },
        ],
      }).writeSelection(target.asDataTransfer(), selection),
    ).toBe(true);
    const html = target.values.get("text/html") ?? "";
    expect(html).toContain("<figure>");
    expect(html).toContain("Image");
    expect(html).not.toMatch(
      /<script|javascript:|data:text|onclick|style=|srcset/,
    );
  });

  it("rejects excessive HTML nesting and invalid plain-text encoding", () => {
    const deeplyNested = `${"<section>".repeat(20)}<p>A</p>${"</section>".repeat(20)}`;
    expect(
      boundary({
        limits: { maxNestingDepth: 8 },
      }).readClipboardBlocks(
        new MemoryDataTransfer({ "text/html": deeplyNested }).asDataTransfer(),
      ),
    ).toBeNull();
    for (const text of ["bad\ud800text", "bad\u0000text"]) {
      expect(
        boundary().readClipboardBlocks(
          new MemoryDataTransfer({ "text/plain": text }).asDataTransfer(),
        ),
      ).toBeNull();
    }
  });

  it("preserves empty lines and uses the configured text import type without a target", () => {
    const fragment = importCanonicalFragmentPlainText("A\n\nB", {
      blockDefinitions: definitions,
      defaultTextBlockType: "heading",
    });
    expect(
      fragment?.blocks.map((block) => [block.type, block.plainText]),
    ).toEqual([
      ["heading", "A"],
      ["heading", ""],
      ["heading", "B"],
    ]);
  });

  it("projects generic wrappers in reading order", () => {
    expect(
      exportCanonicalFragmentPlainText(wrapperFragment(), {
        blockDefinitions: definitions,
        defaultTextBlockType: "paragraph",
      }),
    ).toBe("Inside");
  });
});

function boundary(
  overrides: Partial<Parameters<typeof createEditorClipboardBoundary>[0]> = {},
) {
  return createEditorClipboardBoundary({
    blockDefinitions: definitions,
    plainTextImportBlockType: "paragraph",
    materializeSelection: () => null,
    inlineMarks: [boldMarkDefinition, linkMarkDefinition],
    htmlImportHandlers: [
      createTextHtmlImportHandler({
        id: "core.semantic-paragraph",
        blockType: "paragraph",
        tags: ["p"],
      }),
      createTextHtmlImportHandler({
        id: "core.semantic-heading",
        blockType: "heading",
        tags: ["h1", "h2", "h3", "h4", "h5", "h6"],
        metadata: (node) => ({ level: Number(node.tagName.slice(1)) }),
      }),
    ],
    parseHtml: (html, plainText, handlers, limits) =>
      parseHtmlCanonicalFragment(html, plainText, {
        schema,
        blockDefinitions: definitions,
        plainTextBlockType: "paragraph",
        htmlImportHandlers: handlers,
        limits,
      }),
    ...overrides,
  });
}

function textFragment(
  text: string,
  boundaryKind: "text" | "block",
): CanonicalBlockFragment {
  const block = textRecord("paragraph", text);
  return createCanonicalBlockFragment({
    blocks: [block],
    rootBlockIds: [block.id],
    start: { kind: boundaryKind, blockId: block.id },
    end: { kind: boundaryKind, blockId: block.id },
    blockDefinitions: definitions,
  });
}

function multiRootFragment(): CanonicalBlockFragment {
  const paragraph = textRecord("paragraph", "First", {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "First", marks: [{ type: "strong" }] }],
      },
    ],
  });
  const heading = textRecord("heading", "Second", undefined, { level: 2 });
  return createCanonicalBlockFragment({
    blocks: [paragraph, heading],
    rootBlockIds: [paragraph.id, heading.id],
    start: { kind: "block", blockId: paragraph.id },
    end: { kind: "block", blockId: heading.id },
    blockDefinitions: definitions,
  });
}

function wrapperFragment(): CanonicalBlockFragment {
  const wrapper = createCanonicalBlockRecord({
    type: "callout",
    parentId: null,
  });
  const child = textRecord(
    "paragraph",
    "Inside",
    undefined,
    undefined,
    wrapper.id,
  );
  return createCanonicalBlockFragment({
    blocks: [wrapper, child],
    rootBlockIds: [wrapper.id],
    start: { kind: "block", blockId: wrapper.id },
    end: { kind: "block", blockId: wrapper.id },
    blockDefinitions: definitions,
  });
}

function atomicFragment(): CanonicalBlockFragment {
  const divider = createCanonicalBlockRecord({
    type: "divider",
    metadata: { role: "separator" },
  });
  return createCanonicalBlockFragment({
    blocks: [divider],
    rootBlockIds: [divider.id],
    start: { kind: "block", blockId: divider.id },
    end: { kind: "block", blockId: divider.id },
    blockDefinitions: definitions,
  });
}

function semanticFixture(): CanonicalBlockFragment {
  const multi = multiRootFragment();
  const wrapper = wrapperFragment();
  const atomic = atomicFragment();
  return createCanonicalBlockFragment({
    blocks: [...multi.blocks, ...wrapper.blocks, ...atomic.blocks],
    rootBlockIds: [
      ...multi.rootBlockIds,
      ...wrapper.rootBlockIds,
      ...atomic.rootBlockIds,
    ],
    start: multi.start,
    end: atomic.end,
    blockDefinitions: definitions,
  });
}

function textRecord(
  type: string,
  text: string,
  content = richText(text),
  metadata?: Record<string, number>,
  parentId: CanonicalBlockRecord["parentId"] = null,
): CanonicalBlockRecord {
  return createCanonicalBlockRecord({
    type,
    parentId,
    ...(metadata === undefined ? {} : { metadata }),
    content,
    plainText: extractPlainTextFromRichTextDocument(content),
  });
}

function richText(text: string) {
  return createBlockRichTextContentFromPlainText("paragraph", text);
}

function canonicalSemanticSignature(
  fragment: CanonicalBlockFragment | null,
): unknown {
  if (!fragment) return null;
  const positionById = new Map(
    fragment.blocks.map((block, index) => [block.id, index]),
  );
  return {
    blocks: fragment.blocks.map((block) => ({
      type: block.type,
      parent:
        block.parentId === null
          ? null
          : (positionById.get(block.parentId) ?? -1),
      metadata: block.metadata,
      content: block.content,
      plainText: block.plainText,
    })),
    roots: fragment.rootBlockIds.map(
      (blockId) => positionById.get(blockId) ?? -1,
    ),
    start: {
      kind: fragment.start.kind,
      block: positionById.get(fragment.start.blockId) ?? -1,
    },
    end: {
      kind: fragment.end.kind,
      block: positionById.get(fragment.end.blockId) ?? -1,
    },
  };
}

class MemoryDataTransfer {
  readonly values = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];

  constructor(
    initial: Readonly<Record<string, string>> = {},
    private readonly failingWrites: ReadonlySet<string> = new Set(),
  ) {
    for (const [format, value] of Object.entries(initial))
      this.values.set(format, value);
  }

  setData(format: string, value: string): void {
    this.writes.push(format);
    if (this.failingWrites.has(format)) throw new Error("write failed");
    this.values.set(format, value);
  }

  getData(format: string): string {
    this.reads.push(format);
    return this.values.get(format) ?? "";
  }

  asDataTransfer(): DataTransfer {
    return this as unknown as DataTransfer;
  }
}
