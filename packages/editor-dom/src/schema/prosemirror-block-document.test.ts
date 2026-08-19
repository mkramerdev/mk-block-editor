import { describe, expect, it } from "vitest";
import {
  boldMarkDefinition,
  linkMarkDefinition,
} from "@repo/editor-core/content/marks";
import { createBlockLocalProseMirrorState } from "../block-editor/state/create-block-local-state.ts";
import {
  createEmptyBlockLocalProseMirrorDocument,
  createTextBlockLocalProseMirrorDocument,
} from "./block-local/document-materialization.ts";
import { getBlockLocalTextNodeName } from "./block-local/document-mapping.ts";
import {
  parseBlockLocalProseMirrorDocument,
  tryParseBlockLocalProseMirrorDocument,
  materializeCanonicalBlockLocalProseMirrorDocument,
} from "./block-local/document-parsing.ts";
import {
  blockLocalProseMirrorSchema,
  createBlockLocalProseMirrorSchema,
} from "./block-local/schema.ts";
import { testBlockId } from "../testing/block-editor-test-support.ts";
import { proseMirrorRichTextToCanonicalJson } from "./inline/atom-json.ts";

const testMentionAtom = { type: "mention" } as const;

interface TestParseRule {
  getAttrs?: (node: unknown) => unknown;
}

describe("block-local state and schema", () => {
  it("uses the neutral rich-text block node unless a custom mapping is supplied", () => {
    const headingState = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "heading",
      doc: "Roadmap",
    });

    expect(headingState.doc.firstChild?.type.name).toBe("paragraph");
    expect(headingState.doc.textContent).toBe("Roadmap");
    expect(getBlockLocalTextNodeName("checklistItem")).toBe("paragraph");
    expect(getBlockLocalTextNodeName("database")).toBe("paragraph");
  });

  it("parses JSON docs and falls back to empty block docs on invalid content", () => {
    const neutralDoc = createTextBlockLocalProseMirrorDocument(
      "paragraph",
      "const x = 1;",
    );
    const parsed = parseBlockLocalProseMirrorDocument(
      neutralDoc.toJSON(),
      "paragraph",
    );
    const fallback = parseBlockLocalProseMirrorDocument(
      { type: "unknown" },
      "heading",
    );
    const empty = createEmptyBlockLocalProseMirrorDocument("paragraph");
    const emptyString = parseBlockLocalProseMirrorDocument("", "heading");
    const nullFallback = parseBlockLocalProseMirrorDocument(null, "paragraph");
    const primitiveFallback = parseBlockLocalProseMirrorDocument(
      42,
      "paragraph",
    );

    expect(parsed.firstChild?.type.name).toBe("paragraph");
    expect(parsed.textContent).toBe("const x = 1;");
    expect(fallback.firstChild?.type.name).toBe("paragraph");
    expect(empty.firstChild?.type.name).toBe("paragraph");
    expect(emptyString.firstChild?.type.name).toBe("paragraph");
    expect(nullFallback.firstChild?.type.name).toBe("paragraph");
    expect(primitiveFallback.firstChild?.type.name).toBe("paragraph");

    const pmNodeState = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "paragraph",
      doc: neutralDoc,
    });
    expect(pmNodeState.doc.textContent).toBe("const x = 1;");
    expect(
      parseBlockLocalProseMirrorDocument(
        createTextBlockLocalProseMirrorDocument("paragraph", "Title").toJSON(),
        "heading",
      ).firstChild?.type.name,
    ).toBe("paragraph");

    expect(() =>
      createEmptyBlockLocalProseMirrorDocument("paragraph", {
        nodes: {},
      } as typeof blockLocalProseMirrorSchema),
    ).toThrow("missing block-local node type paragraph");
  });

  it("keeps optional inline marks and atoms out of the base DOM schema by default", () => {
    expect(blockLocalProseMirrorSchema.marks.strong).toBeUndefined();
    expect(blockLocalProseMirrorSchema.marks.link).toBeUndefined();
    expect(blockLocalProseMirrorSchema.nodes.mention).toBeUndefined();

    const markSchema = createBlockLocalProseMirrorSchema({
      inlineMarks: [boldMarkDefinition, linkMarkDefinition],
    });
    expect(markSchema.marks.strong).toBeDefined();
    expect(markSchema.marks.link).toBeDefined();

    const mentionSchema = createBlockLocalProseMirrorSchema({
      inlineAtoms: [testMentionAtom],
    });
    expect(mentionSchema.nodes.mention).toBeDefined();
  });

  it("supports custom block text node mapping without changing default block contracts", () => {
    const customSchema = createBlockLocalProseMirrorSchema({
      nodes: {
        callout_text: {
          content: "inline*",
          group: "block",
          parseDOM: [{ tag: "aside[data-block-node='callout']" }],
          toDOM: () => ["aside", { "data-block-node": "callout" }, 0],
        },
      },
      marks: {
        highlight: {
          parseDOM: [{ tag: "mark" }],
          toDOM: () => ["mark", 0],
        },
      },
    });
    const documentMapping = { blockTextNodeNames: { callout: "callout_text" } };
    const doc = createTextBlockLocalProseMirrorDocument(
      "callout",
      "Heads up",
      customSchema,
      documentMapping,
    );
    const parsed = parseBlockLocalProseMirrorDocument(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Retarget me" }],
          },
        ],
      },
      "callout",
      customSchema,
      documentMapping,
    );
    const state = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "callout",
      doc: "State text",
      schema: customSchema,
      documentMapping,
    });

    expect(customSchema.marks.highlight).toBeDefined();
    expect(getBlockLocalTextNodeName("callout", documentMapping)).toBe(
      "callout_text",
    );
    expect(doc.firstChild?.type.name).toBe("callout_text");
    expect(parsed.firstChild?.type.name).toBe("callout_text");
    expect(parsed.textContent).toBe("Retarget me");
    expect(state.doc.firstChild?.type.name).toBe("callout_text");
    expect(state.doc.textContent).toBe("State text");
    expect(
      tryParseBlockLocalProseMirrorDocument(
        { type: "unknown" },
        "callout",
        customSchema,
        documentMapping,
      ),
    ).toBeNull();
  });

  it("materializes neutral heading content with presentation-only level attrs", () => {
    const canonical = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Semantic heading" }],
        },
      ],
    } as const;
    const documentMapping = {
      blockTextNodeNames: { heading: "heading" },
      blockTextNodeAttrs: { heading: { level: 3 } },
    };

    const doc = materializeCanonicalBlockLocalProseMirrorDocument(
      canonical,
      "heading",
      blockLocalProseMirrorSchema,
      documentMapping,
    );

    expect(doc.firstChild?.type.name).toBe("heading");
    expect(doc.firstChild?.attrs.level).toBe(3);
    expect(doc.textContent).toBe("Semantic heading");
    expect(canonical.content[0].type).toBe("paragraph");
    expect(proseMirrorRichTextToCanonicalJson(doc.toJSON())).toStrictEqual(
      canonical,
    );
  });

  it("serializes and parses block-local DOM specs without full-document nodes", () => {
    const linkSchema = createBlockLocalProseMirrorSchema({
      inlineMarks: [linkMarkDefinition],
    });
    const linkMark = linkSchema.marks.link;
    expect(linkMark).toBeDefined();
    if (!linkMark) throw new Error("link mark is missing from the schema");
    const linkSpec = linkMark.spec.parseDOM?.[0] as TestParseRule | undefined;
    const anchor = document.createElement("a");
    anchor.href = "/doc";
    anchor.title = "Doc";
    expect(linkSpec?.getAttrs?.(anchor)).toStrictEqual({
      href: "/doc",
      title: "Doc",
      target: null,
    });
    expect(linkSpec?.getAttrs?.(document.createTextNode("x"))).toBe(false);

    const mentionSchema = createBlockLocalProseMirrorSchema({
      inlineAtoms: [testMentionAtom],
    });
    expect(mentionSchema.nodes.mention?.spec.parseDOM).toBeUndefined();
    expect(mentionSchema.nodes.mention?.spec.atom).toBe(true);
    expect(mentionSchema.nodes.mention?.spec.selectable).toBe(true);
    expect(mentionSchema.nodes.mention?.spec.inline).toBe(true);
    expect(mentionSchema.nodes.mention?.spec.attrs).toStrictEqual({
      metadata: {},
    });

    const headingType = blockLocalProseMirrorSchema.nodes.heading;
    expect(headingType?.spec.toDOM?.(headingType.create())).toStrictEqual([
      "h1",
      { "data-block-node": "heading", "data-level": "1" },
      0,
    ]);
    expect(
      headingType?.spec.toDOM?.(headingType.create({ level: 12 })),
    ).toStrictEqual([
      "h6",
      { "data-block-node": "heading", "data-level": "6" },
      0,
    ]);
    expect(
      headingType?.spec.toDOM?.(headingType.create({ level: -1 })),
    ).toStrictEqual([
      "h1",
      { "data-block-node": "heading", "data-level": "1" },
      0,
    ]);

    const atomNodeType = mentionSchema.nodes.mention;
    expect(
      atomNodeType?.spec.toDOM?.(
        atomNodeType.create({
          metadata: { id: "user-123" },
        }),
      ),
    ).toStrictEqual([
      "span",
      {
        "data-inline-atom-type": "mention",
      },
    ]);
  });
});
