import { act, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { EditorImplementation } from "@repo/editor-react/editor";
import type { Block, VersionedBlock } from "@repo/editor-core/document";
import {
  blockDataFromBlockGraph,
  createEditorDocumentOrderData,
  createBlockGraphFromTypes,
  documentDataFromBlockGraph,
  materializeEditorDocumentData,
  testBlockId,
} from "./editor-web-test-helpers.ts";
import {
  createEditorContentRuntime as createEditorContentRuntimeWithSchemaInput,
  type EditorContentRuntime,
} from "../runtime/content/content-runtime.ts";
import { type EditorDefinition } from "../api/document-runtime.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";
import { ReadTextBlockPrimitive as TextBlockPrimitive } from "../document/blocks/read-text-block-primitive.tsx";
import type { EditorRuntimePort } from "../runtime/document/render-port.ts";
import { registerEditorRuntimePort } from "../runtime/document/runtime-port-registry.ts";
import { compileCanonicalEditorDefinition } from "../runtime/definition/compiled-editor-definition.ts";
import type { TextPlaceholder } from "@repo/editor-dom/block-editor";

function createEditorContentRuntime(
  source: Parameters<typeof createEditorContentRuntimeWithSchemaInput>[0],
  definition: EditorDefinition = testEditableEditorDefinition,
): EditorContentRuntime {
  return createEditorContentRuntimeWithSchemaInput({
    ...source,
    blockDefinitions: source.blockDefinitions ?? definition.blocks,
    inlineMarks: source.inlineMarks ?? definition.inlineMarks,
    inlineAtoms: source.inlineAtoms ?? definition.inlineAtoms,
  });
}

describe("TextBlockPrimitive canonical projection", () => {
  it("keeps the stable input projection subscribed to canonical content", () => {
    const blockGraph = createBlockGraphFromTypes(["paragraph"]);
    const blockId = testBlockId(0);
    const subscribeBlockProjection = vi.fn(() => vi.fn());
    const projection = createBlockRichTextContentFromPlainText(
      "paragraph",
      "active",
    );
    const contentRuntime = {
      subscribeBlockProjection,
      readBlockProjection: vi.fn(() => projection),
    } as unknown as EditorContentRuntime;

    render(
      <TextBlockPrimitive
        block={createReadBlock(blockGraph.blocks[blockId]!, blockId)}
        editor={createReadRenderPort(
          createReadRuntime(),
          contentRuntime,
          testEditableEditorDefinition,
        )}
      />,
    );

    expect(subscribeBlockProjection).toHaveBeenCalled();
  });

  it("reads plain text snapshots without hydrating or observing a live Yjs block doc", () => {
    const rendered = renderReadBlock("paragraph", "snapshot text");

    expect(rendered.container.textContent).toContain("snapshot text");
    expect(
      rendered.container.querySelector(".editor-web-text.ProseMirror"),
    ).toBeNull();
    expect(
      rendered.container.querySelector(".editor-web-text > .ProseMirror"),
    ).toBeNull();
    rendered.contentRuntime.destroy();
  });

  it("renders snapshot text during server render instead of hydrating from an empty row", () => {
    const blockGraph = createBlockGraphFromTypes(["childText"]);
    const blockId = testBlockId(0);
    const documentData = materializeEditorDocumentData(
      documentDataFromBlockGraph(blockGraph),
      createEditorDocumentOrderData(blockGraph.rootBlockIds),
      {
        blocks: blockDataFromBlockGraph(blockGraph, {
          [blockId]: "server snapshot text",
        }),
      },
    );
    const contentRuntime = createEditorContentRuntime({
      blockGraphVersion: documentData.blockGraphVersion,
      blockTypesById: { [blockId]: "childText" },
      opaqueContentCheckpoints: documentData.opaqueContentCheckpoints,
      contentById: {
        [blockId]: createBlockRichTextContentFromPlainText(
          "childText",
          "server snapshot text",
        ),
      },
    });
    const editor = { focusBlock: vi.fn() } as unknown as EditorImplementation;

    try {
      const html = renderToString(
        <TextBlockPrimitive
          block={createReadBlock(blockGraph.blocks[blockId]!, blockId)}
          editor={createReadRenderPort(
            editor,
            contentRuntime,
            testEditableEditorDefinition,
          )}
        />,
      );

      expect(html).toContain("server snapshot text");
    } finally {
      contentRuntime.destroy();
    }
  });

  it("suppresses an active placeholder in an empty inactive paragraph", () => {
    const rendered = renderReadBlock("paragraph", "", {
      placeholder: {
        text: "Type / for commands",
        visibility: "active",
      },
    });

    expect(rendered.container.textContent).toBe("");
    const paragraph = rendered.container.querySelector(
      "p[data-block-node='paragraph']",
    );
    expect(paragraph?.getAttribute("data-editor-placeholder")).toBeNull();
    expect(
      paragraph?.querySelectorAll(
        'br[data-editor-read-trailing-break="true"][aria-hidden="true"]',
      ),
    ).toHaveLength(1);
    rendered.contentRuntime.destroy();
  });

  it("preserves an always placeholder in an empty read-only paragraph", () => {
    const rendered = renderReadBlock("paragraph", "", {
      placeholder: {
        text: "Type / for commands",
        visibility: "always",
      },
    });

    expect(
      rendered.container
        .querySelector("p[data-block-node='paragraph']")
        ?.getAttribute("data-editor-placeholder"),
    ).toBe("Type / for commands");
    rendered.contentRuntime.destroy();
  });

  it("suppresses an active placeholder in an empty read-only heading", () => {
    const rendered = renderReadBlock("heading", "", {
      placeholder: { text: "Heading", visibility: "active" },
    });

    expect(
      rendered.container
        .querySelector("h1[data-block-node='heading']")
        ?.getAttribute("data-editor-placeholder"),
    ).toBeNull();
    rendered.contentRuntime.destroy();
  });

  it.each(["paragraph", "heading"] as const)(
    "never emits a placeholder attribute for a non-empty %s",
    (type) => {
      for (const visibility of ["active", "always"] as const) {
        const rendered = renderReadBlock(type, "Populated", {
          placeholder: { text: "Placeholder", visibility },
        });

        expect(
          rendered.container
            .querySelector("[data-block-node]")
            ?.getAttribute("data-editor-placeholder"),
        ).toBeNull();
        rendered.contentRuntime.destroy();
      }
    },
  );

  it("does not emit a placeholder attribute for empty placeholder text", () => {
    const rendered = renderReadBlock("paragraph", "", {
      placeholder: { text: "", visibility: "always" },
    });

    expect(
      rendered.container
        .querySelector("p[data-block-node='paragraph']")
        ?.getAttribute("data-editor-placeholder"),
    ).toBeNull();
    rendered.contentRuntime.destroy();
  });

  it("keeps a terminal hard break logical while adding one hidden layout sentinel", () => {
    const rendered = renderReadBlock("paragraph", "");

    reconcileReadProjection(rendered, [
      { type: "text", text: "First line" },
      { type: "hard_break" },
    ]);

    const paragraph = rendered.container.querySelector<HTMLElement>(
      "p[data-block-node='paragraph']",
    )!;
    const sentinels = paragraph.querySelectorAll(
      'br[data-editor-read-trailing-break="true"]',
    );
    expect(readRenderedText(paragraph)).toBe("First line\n");
    expect(readRenderedText(rendered.container)).toBe("First line\n");
    expect(sentinels).toHaveLength(1);
    expect(sentinels[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(sentinels[0]?.getAttribute("aria-label")).toBeNull();
    expect(sentinels[0]?.textContent).toBe("");
    expect(sentinels[0]?.childNodes).toHaveLength(0);
    rendered.contentRuntime.destroy();
  });

  it("does not add a trailing layout sentinel for an interior hard break", () => {
    const rendered = renderReadBlock("paragraph", "");

    reconcileReadProjection(rendered, [
      { type: "text", text: "First line" },
      { type: "hard_break" },
      { type: "text", text: "Second line" },
    ]);

    expect(
      readRenderedText(
        rendered.container.querySelector("p[data-block-node='paragraph']")!,
      ),
    ).toBe("First line\nSecond line");
    expect(
      rendered.container.querySelector(
        'br[data-editor-read-trailing-break="true"]',
      ),
    ).toBeNull();
    rendered.contentRuntime.destroy();
  });

  it("uses one layout sentinel for multiple terminal hard breaks", () => {
    const rendered = renderReadBlock("paragraph", "");

    reconcileReadProjection(rendered, [
      { type: "text", text: "First line" },
      { type: "hard_break" },
      { type: "hard_break" },
    ]);

    expect(readRenderedText(rendered.container)).toBe("First line\n\n");
    expect(
      rendered.container.querySelectorAll(
        'br[data-editor-read-trailing-break="true"]',
      ),
    ).toHaveLength(1);
    rendered.contentRuntime.destroy();
  });

  it("preserves marked and atomic inline ordering before a terminal hard break", () => {
    const rendered = renderReadBlock("paragraph", "", {
      definition: testMentionDefinition,
    });

    reconcileReadProjection(rendered, [
      { type: "text", text: "Bold ", marks: [{ type: "strong" }] },
      mentionNode(mentionCases[0]),
      { type: "text", text: " italic", marks: [{ type: "em" }] },
      { type: "hard_break" },
    ]);

    const paragraph = rendered.container.querySelector<HTMLElement>(
      "p[data-block-node='paragraph']",
    )!;
    expect(readRenderedText(paragraph)).toBe("Bold @Ada Lovelace italic\n");
    expect(paragraph.querySelector("strong")?.textContent).toBe("Bold ");
    expect(paragraph.querySelector(".test-mention")?.textContent).toBe(
      "@Ada Lovelace",
    );
    expect(paragraph.querySelector("em")?.textContent).toBe(" italic");
    expect(
      paragraph.querySelectorAll('br[data-editor-read-trailing-break="true"]'),
    ).toHaveLength(1);
    rendered.contentRuntime.destroy();
  });

  it("projects every registered primitive inline mark without ProseMirror", () => {
    const rendered = renderReadBlock("paragraph", "");

    reconcileReadProjection(rendered, [
      { type: "text", text: "code", marks: [{ type: "code" }] },
      { type: "text", text: "under", marks: [{ type: "underline" }] },
      {
        type: "text",
        text: "strike",
        marks: [{ type: "strikethrough" }],
      },
    ]);

    expect(rendered.container.querySelector("code")?.textContent).toBe("code");
    expect(rendered.container.querySelector("u")?.textContent).toBe("under");
    expect(rendered.container.querySelector("s")?.textContent).toBe("strike");
    rendered.contentRuntime.destroy();
  });

  it("adds the trailing layout sentinel inside semantic heading output", () => {
    const rendered = renderReadBlock("heading", "");

    reconcileReadProjection(rendered, [
      { type: "text", text: "Heading" },
      { type: "hard_break" },
    ]);

    const heading = rendered.container.querySelector<HTMLElement>(
      "h1[data-block-node='heading']",
    )!;
    expect(readRenderedText(heading)).toBe("Heading\n");
    expect(
      heading.querySelectorAll(
        'br[data-editor-read-trailing-break="true"][aria-hidden="true"]',
      ),
    ).toHaveLength(1);
    expect(
      rendered.container.querySelector("p[data-block-node='paragraph']"),
    ).toBeNull();
    rendered.contentRuntime.destroy();
  });

  it("preserves an always placeholder in an empty read-only heading", () => {
    const rendered = renderReadBlock("heading", "", {
      placeholder: { text: "Heading", visibility: "always" },
    });

    const heading = rendered.container.querySelector<HTMLElement>(
      "h1[data-block-node='heading']",
    );
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("");
    expect(heading?.className).toBe("");
    expect(heading?.getAttribute("data-editor-placeholder")).toBe("Heading");
    expect(
      rendered.container.querySelector("p[data-block-node='paragraph']"),
    ).toBeNull();
    rendered.contentRuntime.destroy();
  });

  it("treats missing plain text snapshots as empty read text", () => {
    const blockGraph = createBlockGraphFromTypes(["paragraph"]);
    const blockId = testBlockId(0);
    const contentRuntime = {
      subscribeBlockProjection: vi.fn(() => vi.fn()),
      readBlockProjection: vi.fn(() => undefined),
    } as unknown as EditorContentRuntime;
    const editor = createReadRuntime();

    const rendered = render(
      <TextBlockPrimitive
        block={createReadBlock(blockGraph.blocks[blockId]!, blockId)}
        editor={createReadRenderPort(
          editor,
          contentRuntime,
          testEditableEditorDefinition,
        )}
      />,
    );

    expect(rendered.container.textContent).toBe("");
    expect(
      rendered.container
        .querySelector("[data-editor-read-row]")
        ?.getAttribute("data-empty"),
    ).toBe("true");
  });

  it("keeps read projection text stable while selection paint is owned by the list layer", () => {
    const rendered = renderReadBlock("paragraph", "abcdef");

    expect(
      rendered.container.querySelector("[data-editor-selection-paint]"),
    ).toBeNull();
    expect(rendered.container.textContent).toBe("abcdef");
    rendered.contentRuntime.destroy();
  });

  it("keeps inline marks visible when a formatted text block is rendered as a read projection", () => {
    const rendered = renderReadBlock("paragraph", "bold text");

    reconcileReadProjection(rendered, [
      { type: "text", text: "bold", marks: [{ type: "strong" }] },
      { type: "text", text: " text" },
    ]);

    expect(rendered.container.querySelector("strong")?.textContent).toBe(
      "bold",
    );
    expect(rendered.container.textContent).toBe("bold text");
    rendered.contentRuntime.destroy();
  });

  it("renders rich inline mention atoms from read projections without hydrating Yjs", () => {
    const rendered = renderReadBlock("paragraph", "", {
      definition: testMentionDefinition,
    });
    const mention = mentionCases[0];

    reconcileReadProjection(rendered, [
      mentionNode(mention),
      { type: "text", text: " " },
    ]);

    const mentionElement =
      rendered.container.querySelector<HTMLElement>(".test-mention");
    expect(mentionElement).not.toBeNull();
    expect(mentionElement?.textContent).toBe("@Ada Lovelace");
    expect(mentionElement?.getAttribute("data-id")).toBe(mention.id);
    expect(mentionElement?.getAttribute("aria-label")).toBe(
      "mention Ada Lovelace",
    );
    expect(rendered.container.textContent).toContain("@Ada Lovelace ");
    rendered.contentRuntime.destroy();
  });

  it.each(mentionCases)(
    "renders mention $id by resolving product display state in the definition renderer",
    (mention) => {
      const rendered = renderReadBlock("paragraph", "", {
        definition: testMentionDefinition,
      });

      reconcileReadProjection(rendered, [mentionNode(mention)]);

      const mentionElement =
        rendered.container.querySelector<HTMLElement>(".test-mention");
      expect(mentionElement).not.toBeNull();
      expect(mentionElement?.textContent).toBe(mention.displayText);
      expect(mentionElement?.getAttribute("data-id")).toBe(mention.id);
      expect(mentionElement?.getAttribute("aria-label")).toBe(
        `mention ${mention.label}`,
      );
      rendered.contentRuntime.destroy();
    },
  );

  it("keeps mixed rich inline content ordered around read-mode mentions", () => {
    const rendered = renderReadBlock("paragraph", "", {
      definition: testMentionDefinition,
    });
    const mention = mentionCases.find(
      (candidate) => candidate.id === "doc-plan",
    )!;

    reconcileReadProjection(rendered, [
      { type: "text", text: "Bold ", marks: [{ type: "strong" }] },
      mentionNode(mention),
      { type: "text", text: " italic", marks: [{ type: "em" }] },
      { type: "text", text: " tail" },
    ]);

    const paragraph = rendered.container.querySelector(
      "[data-block-node='paragraph']",
    );
    const strong = paragraph?.querySelector("strong");
    const mentionElement =
      paragraph?.querySelector<HTMLElement>(".test-mention");
    const em = paragraph?.querySelector("em");
    expect(paragraph?.textContent).toBe("Bold @Project Plan italic tail");
    expect(strong?.textContent).toBe("Bold ");
    expect(mentionElement?.textContent).toBe("@Project Plan");
    expect(em?.textContent).toBe(" italic");
    expect(
      strong &&
        mentionElement &&
        strong.compareDocumentPosition(mentionElement) &
          Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      mentionElement &&
        em &&
        mentionElement.compareDocumentPosition(em) &
          Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    rendered.contentRuntime.destroy();
  });

  it("keeps selected read-mode mention text as content while paint is owned by the list layer", () => {
    const rendered = renderReadBlock("paragraph", "", {
      definition: testMentionDefinition,
    });

    reconcileReadProjection(rendered, [mentionNode(mentionCases[0])]);

    expect(
      rendered.container.querySelector("[data-editor-selection-paint]"),
    ).toBeNull();
    expect(
      rendered.container
        .querySelector(".test-mention")
        ?.getAttribute("data-id"),
    ).toBe("user-ada");
    expect(rendered.container.textContent).toBe("@Ada Lovelace");
    rendered.contentRuntime.destroy();
  });

  it("rejects an atom occurrence when the active definition omits its type", () => {
    const rendered = renderReadBlock("paragraph", "");

    expect(() =>
      reconcileReadProjection(rendered, [mentionNode(mentionCases[0])]),
    ).toThrow(/type mention is not registered/i);
    rendered.contentRuntime.destroy();
  });

  it("renders heading read projections with the same semantic text node shape as live ProseMirror blocks", () => {
    const heading = renderReadBlock("heading", "Semantic heading");
    expect(
      heading.container.querySelector("h1[data-block-node='heading']")
        ?.textContent,
    ).toBe("Semantic heading");
    expect(
      heading.container.querySelector("p[data-block-node='paragraph']"),
    ).toBeNull();
    heading.contentRuntime.destroy();
  });

  it("renders current read projection shape without rich text validator work", () => {
    const rendered = renderReadBlock("heading", "");

    reconcileReadProjection(rendered, [
      { type: "text", text: "Trusted heading" },
    ]);

    expect(
      rendered.container.querySelector("h1[data-block-node='heading']")
        ?.textContent,
    ).toBe("Trusted heading");
    rendered.contentRuntime.destroy();
  });
});

const mentionCases = [
  {
    id: "user-ada",
    label: "Ada Lovelace",
    displayText: "@Ada Lovelace",
  },
  {
    id: "doc-plan",
    label: "Project Plan",
    displayText: "@Project Plan",
  },
  {
    id: "project-apollo",
    label: "Apollo",
    displayText: "@Apollo",
  },
  {
    id: "resource-flow",
    label: "Launch Flow",
    displayText: "@Launch Flow",
  },
  {
    id: "2026-05-31",
    label: "May 31, 2026",
    displayText: "@May 31, 2026",
  },
] as const;

const testMentionDefinition: EditorDefinition = {
  blocks: testEditableEditorDefinition.blocks,
  defaultRoot: "paragraph",
  inlineMarks: testEditableEditorDefinition.inlineMarks,
  inlineAtoms: [
    {
      type: "mention",
      metadata: { id: { type: "string", required: true } },
      render: (metadata) => {
        const id = metadata.id as string;
        const label =
          mentionCases.find((candidate) => candidate.id === id)?.label ??
          "Unknown";
        return (
          <span
            className="test-mention"
            data-id={id}
            aria-label={`mention ${label}`}
          >
            @{label}
          </span>
        );
      },
    },
  ],
};

type MentionCase = (typeof mentionCases)[number];

function mentionNode(mention: MentionCase): Record<string, unknown> {
  return {
    type: "mention",
    metadata: { id: mention.id },
  };
}

function reconcileReadProjection(
  rendered: ReturnType<typeof renderReadBlock>,
  inlineContent: readonly Record<string, unknown>[],
): void {
  act(() => {
    rendered.contentRuntime.applyExternalContentUpdate({
      blockGraphVersion: 1,
      blockId: rendered.blockId,
      blockType: rendered.block.type,
      readProjection: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [...inlineContent],
          },
        ],
      },
      origin: "test-read-projection",
    });
  });
}

function renderReadBlock(
  type: Block["type"],
  text: string,
  options: {
    focusBlock?: ReturnType<typeof vi.fn>;
    placeholder?: TextPlaceholder;
    definition?: EditorDefinition;
    editor?: EditorImplementation;
  } = {},
) {
  const definition = options.definition ?? testEditableEditorDefinition;
  const blockGraph = createBlockGraphFromTypes([type]);
  const blockId = testBlockId(0);
  const documentData = materializeEditorDocumentData(
    documentDataFromBlockGraph(blockGraph),
    createEditorDocumentOrderData(blockGraph.rootBlockIds),
    {
      blocks: blockDataFromBlockGraph(blockGraph, { [blockId]: text }),
    },
  );
  const contentRuntime = createEditorContentRuntime(documentData, definition);
  contentRuntime.reconcileContentData({
    blockGraphVersion: documentData.blockGraphVersion,
    blockIds: documentData.blockIds,
    blockTypesById: { [blockId]: type },
    opaqueContentCheckpoints: documentData.opaqueContentCheckpoints,
    contentById: {
      [blockId]: createBlockRichTextContentFromPlainText(type, text),
    },
    loadedAt: Date.now(),
  });
  const editor = options.editor ?? createReadRuntime(options.focusBlock);
  const block = createReadBlock(blockGraph.blocks[blockId]!, blockId);
  const readBlock = (
    <TextBlockPrimitive
      block={block}
      editor={createReadRenderPort(editor, contentRuntime, definition)}
      placeholder={options.placeholder}
    />
  );
  const rendered = render(readBlock);
  return { ...rendered, blockId, contentRuntime, block };
}

function createReadRuntime(
  focusBlock: ReturnType<typeof vi.fn> = vi.fn(),
): EditorImplementation {
  return {
    focusBlock,
  } as unknown as EditorImplementation;
}

function createReadBlock(
  block: Block,
  id: VersionedBlock["id"],
): VersionedBlock {
  return {
    id,
    type: block.type,
    parentId: block.parentId,
    metadataVersion: block.metadataVersion,
    contentVersion: block.contentVersion,
    tombstone: block.tombstone,
    ...(block.metadata === undefined ? {} : { metadata: block.metadata }),
  };
}

function createReadRenderPort(
  editor: EditorImplementation,
  contentRuntime: EditorContentRuntime,
  definition: EditorDefinition,
): EditorRuntimePort {
  const compiledDefinition = compileCanonicalEditorDefinition(definition);
  const runtime = {
    ...editor,
    editable: false,
    definition,
    compiledDefinition,
    contentRuntime,
  } as EditorRuntimePort;
  registerEditorRuntimePort(runtime, runtime);
  return runtime;
}

function readRenderedText(root: Element): string {
  let text = "";
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node instanceof HTMLBRElement) {
      if (!node.hasAttribute("data-editor-read-trailing-break")) text += "\n";
    } else if (node instanceof Element) {
      text += readRenderedText(node);
    }
  }
  return text;
}
