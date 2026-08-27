import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { VersionedBlock } from "@repo/editor-core/document";
import { asBlockId } from "@repo/editor-core/kernel";
import {
  boldMarkDefinition,
  codeMarkDefinition,
  italicMarkDefinition,
  linkMarkDefinition,
  strikethroughMarkDefinition,
  underlineMarkDefinition,
} from "@repo/editor-core/content/marks";
import type { InlineAtomDefinition } from "../runtime/definition/contracts.ts";
import { CanonicalRichTextPresentation } from "../document/blocks/canonical-text-projection.tsx";

const block: VersionedBlock = Object.freeze({
  id: asBlockId("captured-text"),
  type: "textBlock",
  parentId: null,
  tombstone: null,
  metadataVersion: "metadata:1",
  contentVersion: null,
});

const atomRender = vi.fn((metadata) => (
  <span className="test-atom">@{String(metadata.id)}</span>
));
const atom: InlineAtomDefinition = {
  type: "mention",
  metadata: { id: { type: "string", required: true } },
  render: atomRender,
};
const marks = [
  boldMarkDefinition,
  italicMarkDefinition,
  codeMarkDefinition,
  linkMarkDefinition,
  strikethroughMarkDefinition,
  underlineMarkDefinition,
];

describe("CanonicalRichTextPresentation", () => {
  it("renders every supported canonical leaf without an editor runtime", () => {
    const content: RichTextDocumentNodeJson = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "bold", marks: [{ type: "strong" }] },
          { type: "text", text: "italic", marks: [{ type: "em" }] },
          { type: "text", text: "code", marks: [{ type: "code" }] },
          { type: "text", text: "under", marks: [{ type: "underline" }] },
          { type: "text", text: "strike", marks: [{ type: "strikethrough" }] },
          {
            type: "text",
            text: "link",
            marks: [{
              type: "link",
              attrs: {
                href: "https://example.com",
                title: "Example",
                target: "_blank",
              },
            }],
          },
          { type: "hard_break" },
          { type: "mention", metadata: { id: "ada" } },
        ],
      }],
    };
    const rendered = render(
      <CanonicalRichTextPresentation
        block={block}
        content={content}
        inlineAtoms={[atom]}
        inlineMarks={marks}
      />,
    );

    expect(rendered.container.querySelector("strong")?.textContent).toBe("bold");
    expect(rendered.container.querySelector("em")?.textContent).toBe("italic");
    expect(rendered.container.querySelector("code")?.textContent).toBe("code");
    expect(rendered.container.querySelector("u")?.textContent).toBe("under");
    expect(rendered.container.querySelector("s")?.textContent).toBe("strike");
    expect(rendered.container.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(rendered.container.querySelector("a")?.getAttribute("target")).toBe("_blank");
    expect(rendered.container.querySelectorAll("br")).toHaveLength(1);
    expect(rendered.container.querySelector(".test-atom")?.textContent).toBe("@ada");
    expect(atomRender).toHaveBeenCalledWith({ id: "ada" });
    expect(rendered.container.querySelector("[contenteditable]")).toBeNull();
    expect(rendered.container.querySelector("[data-editor-text-root]")).toBeNull();
    expect(rendered.container.querySelector("[data-editor-text-shell]")).toBeNull();
    expect(rendered.container.querySelector(".ProseMirror")).toBeNull();
  });

  it.each(["p", "h1", "h2", "h3"] as const)(
    "renders empty captured content as %s with placeholder presentation",
    (element) => {
      const rendered = render(
        <CanonicalRichTextPresentation
          block={block}
          content={{ type: "doc", content: [{ type: "paragraph" }] }}
          inlineAtoms={[atom]}
          inlineMarks={marks}
          placeholder={{ text: "Captured placeholder", visibility: "always" }}
          textDomPresentation={{ element, attributes: {} }}
        />,
      );
      const semantic = rendered.container.querySelector(element);
      expect(semantic?.getAttribute("data-editor-placeholder")).toBe("Captured placeholder");
      expect(
        semantic?.querySelector("[data-editor-canonical-trailing-break]"),
      ).not.toBeNull();
      expect(rendered.container.querySelector("[contenteditable]")).toBeNull();
    },
  );
});
