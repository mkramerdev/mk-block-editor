import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { VersionedBlock } from "@repo/editor-core/document";
import { asBlockId } from "@repo/editor-core/kernel";
import { FirstDraftCapturedTableCellPresentation } from "./preview-cell.tsx";

const block: VersionedBlock = Object.freeze({
  id: asBlockId("captured-cell"),
  type: "tableCell",
  parentId: asBlockId("captured-row"),
  tombstone: null,
  metadataVersion: "metadata:captured-cell",
  contentVersion: null,
});

describe("FirstDraftCapturedTableCellPresentation", () => {
  it("renders rich cell visuals without mounting editor ownership", () => {
    const content: RichTextDocumentNodeJson = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "bold", marks: [{ type: "strong" }] },
          {
            type: "text",
            text: "link",
            marks: [{
              type: "link",
              attrs: { href: "https://example.com", target: "_blank" },
            }],
          },
          { type: "hard_break" },
          { type: "mention", metadata: { id: "ada-lovelace" } },
        ],
      }],
    };
    const rendered = render(
      <FirstDraftCapturedTableCellPresentation
        block={block}
        content={content}
        rootAttributes={{
          "data-first-draft-table-drag-preview-cell": block.id,
        }}
      />,
    );

    expect(rendered.container.querySelector("strong")?.textContent).toBe("bold");
    expect(rendered.container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com",
    );
    expect(rendered.container.querySelector("a")?.getAttribute("target")).toBe(
      "_blank",
    );
    expect(rendered.container.querySelectorAll("br")).toHaveLength(1);
    expect(rendered.container.querySelector(".first-draft-mention")).not.toBeNull();
    expect(
      rendered.container.querySelector(
        "[data-editor-block-id], [data-editor-block-shell], [data-editor-text-root], [contenteditable], .ProseMirror, button",
      ),
    ).toBeNull();
  });
});
