import { describe, expect, it } from "vitest";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { BlockType } from "../../document/model/block.ts";
import { boldMarkDefinition, linkMarkDefinition } from "./schema.ts";
import type { InlineMarkDefinition } from "./types.ts";
import type {
  RichTextDocumentNodeJson,
  RichTextInlineNodeJson,
} from "../rich-text/rich-inline-types.ts";
import {
  createBlockRichTextContentFromPlainText,
  richTextBlockInlineContent,
} from "../rich-text/rich-inline-content.ts";
import {
  applyInlineMarkUpdateToRichTextDocument,
  readInlineMarkCommandStateFromRichTextDocument,
} from "./rich-text-mark-command.ts";

const textDefinitions: Readonly<Record<BlockType, BlockDefinition>> = {
  paragraph: {
    kind: "text",
    type: "paragraph",
    rootLayout: "normal",
    renderer: () => null,
  },
};
const testInlineMarks = [boldMarkDefinition, linkMarkDefinition] as const;

describe("rich text inline mark commands", () => {
  it("reads and applies boolean mark state with the same mixed-toggle semantics as commands", () => {
    const content: RichTextDocumentNodeJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [{ type: "strong" }] },
            { type: "text", text: "bc" },
          ],
        },
      ],
    };

    expect(
      readInlineMarkCommandStateFromRichTextDocument(
        "paragraph",
        content,
        "strong",
        { from: 0, to: 3 },
        {
          blockDefinitions: textDefinitions,
          inlineMarks: testInlineMarks,
        },
      ),
    ).toMatchObject({ canExecute: true, active: false, mixed: true });

    const added = applyInlineMarkUpdateToRichTextDocument(
      "paragraph",
      content,
      "strong",
      { from: 0, to: 3 },
      {
        blockDefinitions: textDefinitions,
        inlineMarks: testInlineMarks,
      },
    );
    expect(added.changed).toBe(true);
    expect(
      readInlineMarkCommandStateFromRichTextDocument(
        "paragraph",
        added.content,
        "strong",
        { from: 0, to: 3 },
        {
          blockDefinitions: textDefinitions,
          inlineMarks: testInlineMarks,
        },
      ),
    ).toMatchObject({ active: true, mixed: false });

    const removed = applyInlineMarkUpdateToRichTextDocument(
      "paragraph",
      added.content,
      "strong",
      { from: 0, to: 3 },
      {
        blockDefinitions: textDefinitions,
        inlineMarks: testInlineMarks,
      },
    );
    expect(
      readInlineMarkCommandStateFromRichTextDocument(
        "paragraph",
        removed.content,
        "strong",
        { from: 0, to: 3 },
        {
          blockDefinitions: textDefinitions,
          inlineMarks: testInlineMarks,
        },
      ),
    ).toMatchObject({ active: false, mixed: false });
  });

  it("supports value-bearing link marks through the same sanitizer and command path", () => {
    const content = createBlockRichTextContentFromPlainText(
      "paragraph",
      "link",
    );

    expect(
      applyInlineMarkUpdateToRichTextDocument(
        "paragraph",
        content,
        "link",
        { from: 0, to: 4 },
        {
          blockDefinitions: textDefinitions,
          inlineMarks: testInlineMarks,
          attrs: { href: "javascript:alert(1)" },
        },
      ).state,
    ).toMatchObject({ canExecute: false, reason: "invalid-attrs" });

    const linked = applyInlineMarkUpdateToRichTextDocument(
      "paragraph",
      content,
      "link",
      { from: 0, to: 4 },
      {
        blockDefinitions: textDefinitions,
        inlineMarks: testInlineMarks,
        attrs: { href: "https://example.test", title: "Example" },
      },
    );

    expect(linked.content).toMatchObject({
      content: [
        {
          content: [
            {
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.test", title: "Example" },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(
      readInlineMarkCommandStateFromRichTextDocument(
        "paragraph",
        linked.content,
        "link",
        { from: 0, to: 4 },
        {
          blockDefinitions: textDefinitions,
          inlineMarks: testInlineMarks,
        },
      ),
    ).toMatchObject({
      active: true,
      value: { href: "https://example.test", title: "Example" },
    });

    const unlinked = applyInlineMarkUpdateToRichTextDocument(
      "paragraph",
      linked.content,
      "link",
      { from: 0, to: 4 },
      {
        blockDefinitions: textDefinitions,
        inlineMarks: testInlineMarks,
        action: "remove",
      },
    );
    expect(unlinked.content).toMatchObject({
      content: [{ content: [{ text: "link" }] }],
    });
    expect(unlinked.content.content?.[0]?.content?.[0]).not.toHaveProperty(
      "marks",
    );
  });

  it("uses supplied inline mark definitions for command sanitation", () => {
    const hrefOnlyLinkDefinition = {
      ...linkMarkDefinition,
      attrs: { href: linkMarkDefinition.attrs.href },
      defaultAttrs: { href: "" },
    } satisfies InlineMarkDefinition<"link">;
    const content = createBlockRichTextContentFromPlainText(
      "paragraph",
      "link",
    );

    const linked = applyInlineMarkUpdateToRichTextDocument(
      "paragraph",
      content,
      "link",
      { from: 0, to: 4 },
      {
        blockDefinitions: textDefinitions,
        inlineMarks: [hrefOnlyLinkDefinition],
        attrs: {
          href: "https://example.test",
          title: "Ignored by injected command definition",
        },
      },
    );

    expect(linked.content).toStrictEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "link",
              marks: [
                { type: "link", attrs: { href: "https://example.test" } },
              ],
            },
          ],
        },
      ],
    });
    expect(
      readInlineMarkCommandStateFromRichTextDocument(
        "paragraph",
        linked.content,
        "link",
        { from: 0, to: 4 },
        {
          blockDefinitions: textDefinitions,
          inlineMarks: [hrefOnlyLinkDefinition],
        },
      ),
    ).toMatchObject({
      active: true,
      value: { href: "https://example.test" },
    });
  });

  it("uses canonical inline markability for rich JSON command ranges", () => {
    const cases: readonly {
      name: string;
      content: RichTextDocumentNodeJson;
      range: { from: number; to: number };
      changed: boolean;
      firstTextMarked?: boolean;
      atomMarked?: boolean;
      reason?: "empty-range";
    }[] = [
      {
        name: "empty range",
        content: createBlockRichTextContentFromPlainText("paragraph", "text"),
        range: { from: 1, to: 1 },
        changed: false,
      },
      {
        name: "whitespace-only range",
        content: createBlockRichTextContentFromPlainText("paragraph", "   "),
        range: { from: 0, to: 3 },
        changed: false,
        reason: "empty-range",
      },
      {
        name: "text range",
        content: createBlockRichTextContentFromPlainText("paragraph", "text"),
        range: { from: 0, to: 4 },
        changed: true,
        firstTextMarked: true,
      },
      {
        name: "hard break range",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "hard_break" }] }],
        },
        range: { from: 0, to: 1 },
        changed: false,
        reason: "empty-range",
      },
      {
        name: "inline atom-only range",
        content: mentionDocument(),
        range: { from: 0, to: 1 },
        changed: false,
        atomMarked: false,
        reason: "empty-range",
      },
      {
        name: "mixed text plus atom range",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "hi" }, mentionNode()],
            },
          ],
        },
        range: { from: 0, to: 3 },
        changed: true,
        firstTextMarked: true,
        atomMarked: false,
      },
    ];

    for (const testCase of cases) {
      const result = applyInlineMarkUpdateToRichTextDocument(
        "paragraph",
        testCase.content,
        "strong",
        testCase.range,
        {
          blockDefinitions: textDefinitions,
          inlineMarks: testInlineMarks,
          action: "add",
        },
      );
      expect({
        name: testCase.name,
        changed: result.changed,
        reason: result.state.reason,
      }).toStrictEqual({
        name: testCase.name,
        changed: testCase.changed,
        ...(testCase.reason
          ? { reason: testCase.reason }
          : { reason: undefined }),
      });
      const inlineContent = richTextBlockInlineContent(result.content);
      if (testCase.firstTextMarked !== undefined) {
        expect({
          name: testCase.name,
          firstTextMarked: hasMark(inlineContent[0], "strong"),
        }).toStrictEqual({
          name: testCase.name,
          firstTextMarked: testCase.firstTextMarked,
        });
      }
      if (testCase.atomMarked !== undefined) {
        const atom = inlineContent.find((node) => node.type === "mention");
        expect({
          name: testCase.name,
          atomMarked: hasMark(atom, "strong"),
        }).toStrictEqual({
          name: testCase.name,
          atomMarked: testCase.atomMarked,
        });
      }
    }
  });

  it("does not split astral text units while applying marks", () => {
    const content = createBlockRichTextContentFromPlainText(
      "paragraph",
      "a😀b",
    );

    expect(
      applyInlineMarkUpdateToRichTextDocument(
        "paragraph",
        content,
        "strong",
        { from: 1, to: 2 },
        {
          blockDefinitions: textDefinitions,
          inlineMarks: testInlineMarks,
          action: "add",
        },
      ).content,
    ).toStrictEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "text", text: "😀", marks: [{ type: "strong" }] },
            { type: "text", text: "b" },
          ],
        },
      ],
    });
  });

  it("rejects marks absent from the supplied inline mark definitions", () => {
    const content = createBlockRichTextContentFromPlainText(
      "paragraph",
      "mark",
    );

    expect(
      readInlineMarkCommandStateFromRichTextDocument(
        "paragraph",
        content,
        "link",
        { from: 0, to: 4 },
        {
          blockDefinitions: textDefinitions,
          inlineMarks: [boldMarkDefinition],
        },
      ),
    ).toMatchObject({ canExecute: false, reason: "missing-mark" });
    expect(
      applyInlineMarkUpdateToRichTextDocument(
        "paragraph",
        content,
        "link",
        { from: 0, to: 4 },
        {
          blockDefinitions: textDefinitions,
          inlineMarks: [boldMarkDefinition],
          attrs: { href: "https://example.test" },
        },
      ),
    ).toMatchObject({
      changed: false,
      state: { canExecute: false, reason: "missing-mark" },
    });
  });

  it("applies inline mark commands against injected definitions", () => {
    const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
      customText: {
        kind: "text",
        type: "customText",
        rootLayout: "normal",
        renderer: () => null,
      },
      customShell: {
        kind: "atomic",
        type: "customShell",
        rootLayout: "normal",
        renderer: () => null,
      },
    };
    const content = createBlockRichTextContentFromPlainText(
      "customText",
      "mark",
    );

    expect(
      readInlineMarkCommandStateFromRichTextDocument(
        "customText",
        content,
        "strong",
        { from: 0, to: 4 },
        {
          blockDefinitions: definitions,
          inlineMarks: testInlineMarks,
        },
      ),
    ).toMatchObject({ canExecute: true });
    expect(
      readInlineMarkCommandStateFromRichTextDocument(
        "customShell",
        content,
        "strong",
        { from: 0, to: 4 },
        {
          blockDefinitions: definitions,
          inlineMarks: testInlineMarks,
        },
      ),
    ).toMatchObject({ canExecute: false, reason: "unsupported-context" });
  });
});

function mentionDocument(): RichTextDocumentNodeJson {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [mentionNode()] }],
  };
}

function mentionNode(): RichTextInlineNodeJson {
  return {
    type: "mention",
    metadata: { id: "u1" },
  };
}

function hasMark(
  node: RichTextInlineNodeJson | undefined,
  markName: string,
): boolean {
  return (
    Array.isArray(node?.marks) &&
    node.marks.some(
      (mark) =>
        typeof mark === "object" &&
        mark !== null &&
        "type" in mark &&
        mark.type === markName,
    )
  );
}
