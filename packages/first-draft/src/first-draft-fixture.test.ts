import {
  extractPlainTextFromRichTextDocument,
  richTextBlockInlineContent,
} from "@repo/editor-core/content/rich-text";
import type { BlockType } from "@repo/editor-core/document";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import { describe, expect, it } from "vitest";
import {
  TABLE_COLUMN_IDS_FIELD,
  TABLE_COLUMN_WIDTHS_FIELD,
} from "./blocks/table/model.ts";
import {
  createFirstDraftDocumentTemplate,
  createFirstDraftFixtureDocumentTemplate,
} from "./first-draft-document-template.ts";
import {
  createFirstDraftDefaultSnapshot,
  createFirstDraftSnapshot,
} from "./first-draft-fixture.ts";
import { createFirstDraftBootstrapFromSnapshot } from "./bootstrap/bootstrap.ts";

const listTypes = new Set<BlockType>([
  "bulletList",
  "orderedList",
  "checklist",
]);
const listItemTypes = new Set<BlockType>([
  "bulletListItem",
  "orderedListItem",
  "checklistItem",
]);

describe("First Draft showcase fixture", () => {
  it("passes canonical fragment and snapshot structural validation", () => {
    expect(() => createFirstDraftDocumentTemplate()).not.toThrow();
    expect(() => createFirstDraftFixtureDocumentTemplate()).not.toThrow();
    expect(() => createFirstDraftDefaultSnapshot()).not.toThrow();
    expect(() =>
      createFirstDraftBootstrapFromSnapshot({
        documentId: "showcase-document",
        revision: 0,
        snapshot: createFirstDraftSnapshot(),
      }),
    ).not.toThrow();
  });

  it("begins with the exact required 13-entry semantic sequence", () => {
    const snapshot = createFirstDraftSnapshot();
    expect(
      snapshot.rootBlockIds.slice(0, 13).map((blockId) => {
        const block = snapshot.blocks[blockId]!;
        return {
          type: block.type,
          text: snapshot.content[blockId]
            ? extractPlainTextFromRichTextDocument(snapshot.content[blockId]!)
            : null,
          metadata: block.metadata,
        };
      }),
    ).toEqual([
      {
        type: "heading",
        text: "Welcome to my Block Editor ✨",
        metadata: { level: 1 },
      },
      { type: "quote", text: null, metadata: undefined },
      {
        type: "paragraph",
        text: "Start writing your thoughts here... ✏️\nFor example with a code block:",
        metadata: undefined,
      },
      { type: "code", text: null, metadata: { language: "csharp" } },
      {
        type: "paragraph",
        text: "Or type / to open the command menu to discover different kinds of blocks.",
        metadata: undefined,
      },
      { type: "divider", text: null, metadata: undefined },
      {
        type: "heading",
        text: "Customize the editor to your needs",
        metadata: { level: 2 },
      },
      { type: "bulletList", text: null, metadata: undefined },
      { type: "callout", text: null, metadata: { icon: "note" } },
      { type: "paragraph", text: "", metadata: undefined },
      {
        type: "heading",
        text: "✅ Interactive Tables included",
        metadata: { level: 2 },
      },
      {
        type: "paragraph",
        text: "When ready, the editor will be released with an optional block starter kit which will include tables, lists, headings, tabs, and a lot more with collaboration-ready configuration.",
        metadata: undefined,
      },
      {
        type: "table",
        text: null,
        metadata: expect.objectContaining({
          viewId: "first-draft-showcase-table",
        }),
      },
    ]);
  });

  it("uses real strong/link marks and hard breaks only at the intended inline ranges", () => {
    const snapshot = createFirstDraftSnapshot();
    const quote = inline(snapshot, "fd-quote-text");
    expect(quote[0]).toEqual({
      type: "text",
      text: "This is a work in progress.",
      marks: [{ type: "strong" }],
    });
    expect(quote[1]).toEqual({ type: "hard_break" });

    const intro = inline(snapshot, "fd-paragraph-intro");
    expect(intro.some((node) => node.type === "hard_break")).toBe(true);
    expect(intro.filter((node) => node.type === "text" && node.marks)).toEqual([
      { type: "text", text: "code block:", marks: [{ type: "strong" }] },
    ]);

    const callout = inline(snapshot, "fd-callout-text");
    const linked = callout.filter((node) => node.type === "text" && node.marks);
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({
      type: "text",
      text: "here",
      marks: [{ type: "link", attrs: { href: "https://google.com" } }],
    });
  });

  it("represents every empty paragraph as genuinely empty rich text", () => {
    const snapshot = createFirstDraftSnapshot();
    const emptyParagraphIds = snapshot.rootBlockIds.filter((blockId) => {
      const block = snapshot.blocks[blockId]!;
      return block.type === "paragraph" && plainText(snapshot, blockId) === "";
    });
    expect(emptyParagraphIds).toEqual([
      asBlockId("fd-empty-after-callout"),
      asBlockId("fd-empty-after-table"),
      asBlockId("fd-empty-before-layouts"),
      asBlockId("fd-empty-final"),
    ]);
    for (const blockId of emptyParagraphIds) {
      expect(richTextBlockInlineContent(snapshot.content[blockId]!)).toEqual(
        [],
      );
    }
  });

  it("ends the concise default document with a six-item checklist", () => {
    const snapshot = createFirstDraftDefaultSnapshot();
    expect(
      plainText(snapshot, asBlockId("fd-heading-actions")),
    ).toBe("Turn ideas into actionable plans with a checklist");
    expect(
      snapshot.blocks[asBlockId("fd-paragraph-before-checklist")],
    ).toBeUndefined();
    expect(snapshot.childIdsByParentId[asBlockId("fd-checklist")]).toEqual([
      asBlockId("fd-check-unchecked"),
      asBlockId("fd-check-checked"),
      asBlockId("fd-check-copy"),
      asBlockId("fd-check-reorder"),
      asBlockId("fd-check-toggle"),
      asBlockId("fd-check-layouts"),
    ]);

    expect(snapshot.rootBlockIds.at(-1)).toBe(asBlockId("fd-checklist"));
    expect(snapshot.blocks[asBlockId("fd-toggle-heading")]).toBeUndefined();
    expect(snapshot.blocks[asBlockId("fd-toggle-heading-second")]).toBeUndefined();
    expect(snapshot.blocks[asBlockId("fd-heading-3")]).toBeUndefined();
    expect(snapshot.blocks[asBlockId("fd-columns")]).toBeUndefined();
    expect(snapshot.blocks[asBlockId("fd-tabs")]).toBeUndefined();
    expect(snapshot.blocks[asBlockId("fd-heading-toggles")]).toBeUndefined();
    expect(
      snapshot.blocks[asBlockId("fd-paragraph-before-goals")],
    ).toBeUndefined();
    expect(
      snapshot.blocks[asBlockId("fd-paragraph-interactions")],
    ).toBeUndefined();
  });

  it("keeps all lists flat and separates different root list types", () => {
    const snapshot = createFirstDraftSnapshot();
    for (const block of Object.values(snapshot.blocks)) {
      if (!listItemTypes.has(block.type)) continue;
      const descendants = collectDescendants(snapshot, block.id);
      expect(
        descendants.some((blockId) =>
          listTypes.has(snapshot.blocks[blockId]!.type),
        ),
        `list below ${block.id}`,
      ).toBe(false);
    }
    for (let index = 1; index < snapshot.rootBlockIds.length; index += 1) {
      const previous = snapshot.blocks[snapshot.rootBlockIds[index - 1]!]!;
      const current = snapshot.blocks[snapshot.rootBlockIds[index]!]!;
      expect(listTypes.has(previous.type) && listTypes.has(current.type)).toBe(
        false,
      );
    }
  });

  it("creates consistent table metadata, rows, and cells", () => {
    const snapshot = createFirstDraftSnapshot();
    const table = snapshot.blocks[asBlockId("fd-table")]!;
    const columnIds = table.metadata?.[
      TABLE_COLUMN_IDS_FIELD
    ] as readonly string[];
    const widths = table.metadata?.[TABLE_COLUMN_WIDTHS_FIELD] as Readonly<
      Record<string, number>
    >;
    expect(columnIds).toHaveLength(3);
    expect(new Set(columnIds).size).toBe(3);
    expect(Object.keys(widths).sort()).toEqual([...columnIds].sort());
    const rows = snapshot.childIdsByParentId[table.id] ?? [];
    expect(rows).toHaveLength(4);
    expect(
      rows.every((rowId) => snapshot.blocks[rowId]?.type === "tableRow"),
    ).toBe(true);
    expect(
      rows.map((rowId) => snapshot.childIdsByParentId[rowId]?.length),
    ).toEqual([3, 3, 3, 3]);
    expect(
      rows
        .flatMap((rowId) => snapshot.childIdsByParentId[rowId] ?? [])
        .map((cellId) => plainText(snapshot, cellId)),
    ).toEqual([
      "Assignment",
      "Assignee",
      "Status",
      "Research brief",
      "Maya Chen",
      "In progress",
      "Interactive prototype",
      "Noah Williams",
      "Ready for review",
      "Final presentation",
      "Ava Patel",
      "Not started",
    ]);
    const headerCellIds = snapshot.childIdsByParentId[rows[0]!] ?? [];
    expect(
      headerCellIds.map((cellId) =>
        richTextBlockInlineContent(snapshot.content[cellId]!),
      ),
    ).toEqual([
      [{ type: "text", text: "Assignment", marks: [{ type: "strong" }] }],
      [{ type: "text", text: "Assignee", marks: [{ type: "strong" }] }],
      [{ type: "text", text: "Status", marks: [{ type: "strong" }] }],
    ]);
  });

  it("matches every text projection and creates deterministic Yjs checkpoints", () => {
    const first = createFirstDraftSnapshot();
    const second = createFirstDraftSnapshot();
    expect(Object.keys(first.opaqueContentCheckpoints)).toEqual(
      Object.keys(first.content),
    );
    for (const blockId of Object.keys(first.content).map(asBlockId)) {
      const templateBlock = createFirstDraftFixtureDocumentTemplate().blocks.find(
        (block) => block.id === blockId,
      )!;
      expect(
        extractPlainTextFromRichTextDocument(first.content[blockId]!),
      ).toBe(templateBlock.plainText);
      expect(first.opaqueContentCheckpoints[blockId]?.payloadBase64).toBe(
        second.opaqueContentCheckpoints[blockId]?.payloadBase64,
      );
    }
  });
});

function inline(
  snapshot: ReturnType<typeof createFirstDraftSnapshot>,
  value: string,
) {
  return richTextBlockInlineContent(snapshot.content[asBlockId(value)]!);
}

function plainText(
  snapshot: ReturnType<typeof createFirstDraftSnapshot>,
  blockId: BlockId,
): string | null {
  const content = snapshot.content[blockId];
  return content ? extractPlainTextFromRichTextDocument(content) : null;
}

function collectDescendants(
  snapshot: ReturnType<typeof createFirstDraftSnapshot>,
  parentId: BlockId,
): readonly BlockId[] {
  return (snapshot.childIdsByParentId[parentId] ?? []).flatMap((childId) => [
    childId,
    ...collectDescendants(snapshot, childId),
  ]);
}
