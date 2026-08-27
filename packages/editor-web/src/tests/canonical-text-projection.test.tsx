import { act, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  createBlockRichTextContentFromPlainText,
  type RichTextInlineNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { EditorImplementation } from "@repo/editor-react/editor";
import type { Block, VersionedBlock } from "@repo/editor-core/document";
import {
  blockDataFromBlockGraph,
  createEditorDocumentOrderData,
  createBlockGraphFromTypes,
  createTestContentOperationUpdate,
  documentDataFromBlockGraph,
  materializeEditorDocumentData,
  testBlockId,
} from "./editor-web-test-helpers.ts";
import {
  createEditorContentRuntime as createEditorContentRuntimeWithSchemaInput,
  type EditorContentRuntime,
  type EditorContentRuntimeSource,
} from "../runtime/content/content-runtime.ts";
import { type EditableEditorDefinition } from "../api/editor-definition.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";
import { InactiveTextBlockPrimitive as TextBlockPrimitive } from "../document/blocks/inactive-text-block-primitive.tsx";
import type { EditableEditorRuntimePort } from "../runtime/document/render-port.ts";
import { registerEditorRuntimePort } from "../runtime/document/runtime-port-registry.ts";
import { compileCanonicalEditorDefinition } from "../runtime/definition/compiled-editor-definition.ts";
import type { TextPlaceholder } from "@repo/editor-dom/block-editor";
import type { TextDomPresentation } from "../document/blocks/text-dom-presentation.ts";

function createEditorContentRuntime(
  source: Omit<
    EditorContentRuntimeSource,
    "blockDefinitions" | "inlineMarks" | "inlineAtoms"
  > &
    Partial<
      Pick<
        EditorContentRuntimeSource,
        "blockDefinitions" | "inlineMarks" | "inlineAtoms"
      >
    >,
  definition: EditableEditorDefinition = testEditableEditorDefinition,
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
    const blockGraph = createBlockGraphFromTypes(["textBlock"]);
    const blockId = testBlockId(0);
    const subscribeBlockProjection = vi.fn(() => vi.fn());
    const projection = createBlockRichTextContentFromPlainText(
      "textBlock",
      "active",
    );
    const contentRuntime = {
      subscribeBlockProjection,
      readBlockProjection: vi.fn(() => projection),
    } as unknown as EditorContentRuntime;

    render(
      <TextBlockPrimitive
        block={createInactiveBlock(blockGraph.blocks[blockId]!, blockId)}
        editor={createInactiveRenderPort(
          createInactiveEditorDouble(),
          contentRuntime,
          testEditableEditorDefinition,
        )}
      />,
    );

    expect(subscribeBlockProjection).toHaveBeenCalled();
  });

  it("reads plain text snapshots without hydrating or observing a live Yjs block doc", () => {
    const rendered = renderInactiveBlock("textBlock", "snapshot text");

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
          block={createInactiveBlock(blockGraph.blocks[blockId]!, blockId)}
          editor={createInactiveRenderPort(
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

  it("suppresses an active placeholder in an empty inactive textBlock", () => {
    const rendered = renderInactiveBlock("textBlock", "", {
      placeholder: {
        text: "Type / for commands",
        visibility: "active",
      },
    });

    expect(rendered.container.textContent).toBe("");
    const textBlock = rendered.container.querySelector(
      "p[data-block-node='paragraph']",
    );
    expect(textBlock?.getAttribute("data-editor-placeholder")).toBeNull();
    expect(
      textBlock?.querySelectorAll(
        'br[data-editor-canonical-trailing-break="true"][aria-hidden="true"]',
      ),
    ).toHaveLength(1);
    rendered.contentRuntime.destroy();
  });

  it("preserves an always placeholder in an empty inactive textBlock", () => {
    const rendered = renderInactiveBlock("textBlock", "", {
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


  it.each(["textBlock", "alternateTextBlock"] as const)(
    "never emits a placeholder attribute for a non-empty %s",
    (type) => {
      for (const visibility of ["active", "always"] as const) {
        const rendered = renderInactiveBlock(type, "Populated", {
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
    const rendered = renderInactiveBlock("textBlock", "", {
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
    const rendered = renderInactiveBlock("textBlock", "");

    reconcileReadProjection(rendered, [
      { type: "text", text: "First line" },
      { type: "hard_break" },
    ]);

    const textBlock = rendered.container.querySelector<HTMLElement>(
      "p[data-block-node='paragraph']",
    )!;
    const sentinels = textBlock.querySelectorAll(
      'br[data-editor-canonical-trailing-break="true"]',
    );
    expect(readRenderedText(textBlock)).toBe("First line\n");
    expect(readRenderedText(rendered.container)).toBe("First line\n");
    expect(sentinels).toHaveLength(1);
    expect(sentinels[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(sentinels[0]?.getAttribute("aria-label")).toBeNull();
    expect(sentinels[0]?.textContent).toBe("");
    expect(sentinels[0]?.childNodes).toHaveLength(0);
    rendered.contentRuntime.destroy();
  });

  it("does not add a trailing layout sentinel for an interior hard break", () => {
    const rendered = renderInactiveBlock("textBlock", "");

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
        'br[data-editor-canonical-trailing-break="true"]',
      ),
    ).toBeNull();
    rendered.contentRuntime.destroy();
  });

  it("uses one layout sentinel for multiple terminal hard breaks", () => {
    const rendered = renderInactiveBlock("textBlock", "");

    reconcileReadProjection(rendered, [
      { type: "text", text: "First line" },
      { type: "hard_break" },
      { type: "hard_break" },
    ]);

    expect(readRenderedText(rendered.container)).toBe("First line\n\n");
    expect(
      rendered.container.querySelectorAll(
        'br[data-editor-canonical-trailing-break="true"]',
      ),
    ).toHaveLength(1);
    rendered.contentRuntime.destroy();
  });

  it("preserves marked and atomic inline ordering before a terminal hard break", () => {
    const rendered = renderInactiveBlock("textBlock", "", {
      definition: testMentionDefinition,
    });

    reconcileReadProjection(rendered, [
      { type: "text", text: "Bold ", marks: [{ type: "strong" }] },
      mentionNode(mentionCases[0]),
      { type: "text", text: " italic", marks: [{ type: "em" }] },
      { type: "hard_break" },
    ]);

    const textBlock = rendered.container.querySelector<HTMLElement>(
      "p[data-block-node='paragraph']",
    )!;
    expect(readRenderedText(textBlock)).toBe("Bold @Ada Lovelace italic\n");
    expect(textBlock.querySelector("strong")?.textContent).toBe("Bold ");
    expect(textBlock.querySelector(".test-mention")?.textContent).toBe(
      "@Ada Lovelace",
    );
    expect(textBlock.querySelector("em")?.textContent).toBe(" italic");
    expect(
      textBlock.querySelectorAll('br[data-editor-canonical-trailing-break="true"]'),
    ).toHaveLength(1);
    rendered.contentRuntime.destroy();
  });

  it("renders renderer-supplied semantic DOM around all canonical inline content", () => {
    const rendered = renderInactiveBlock("alternateTextBlock", "", {
      definition: testMentionDefinition,
      placeholder: { text: "Semantic placeholder", visibility: "always" },
      textDomPresentation: {
        element: "h2",
        attributes: { "data-neutral-presentation": "alternate" },
      },
    });

    reconcileReadProjection(rendered, [
      { type: "text", text: "Bold", marks: [{ type: "strong" }] },
      {
        type: "text",
        text: " link",
        marks: [{ type: "link", attrs: { href: "https://example.test" } }],
      },
      mentionNode(mentionCases[0]),
      { type: "hard_break" },
    ]);

    const semantic = rendered.container.querySelector<HTMLElement>(
      "h2[data-block-node='paragraph'][data-neutral-presentation='alternate']",
    )!;
    expect(semantic).not.toBeNull();
    expect(semantic.querySelector("strong")?.textContent).toBe("Bold");
    expect(semantic.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.test",
    );
    expect(semantic.querySelector("[data-editor-inline-atom='true']")).not.toBeNull();
    expect(semantic.querySelector("br:not([data-editor-canonical-trailing-break])")).not.toBeNull();
    expect(semantic.querySelector("br[data-editor-canonical-trailing-break]"))
      .not.toBeNull();
    expect(rendered.container.querySelector("p[data-block-node]")).toBeNull();
    rendered.contentRuntime.destroy();
  });

  it("keeps the default renderer-owned presentation paragraph-shaped", () => {
    const rendered = renderInactiveBlock("alternateTextBlock", "Default");
    expect(
      rendered.container.querySelector("p[data-block-node='paragraph']")
        ?.textContent,
    ).toBe("Default");
    rendered.contentRuntime.destroy();
  });

  it("keeps placeholder attributes and the empty trailing break on the semantic element", () => {
    const rendered = renderInactiveBlock("textBlock", "", {
      placeholder: { text: "Semantic placeholder", visibility: "always" },
      textDomPresentation: { element: "h3" },
    });
    const semantic = rendered.container.querySelector<HTMLElement>(
      "h3[data-block-node='paragraph']",
    )!;
    expect(semantic.getAttribute("data-editor-placeholder")).toBe(
      "Semantic placeholder",
    );
    expect(
      semantic.querySelector(
        ":scope > br[data-editor-canonical-trailing-break='true']",
      ),
    ).not.toBeNull();
    expect(rendered.container.querySelector("p[data-block-node]")).toBeNull();
    rendered.contentRuntime.destroy();
  });

  it("projects every registered primitive inline mark without ProseMirror", () => {
    const rendered = renderInactiveBlock("textBlock", "");

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



  it("treats missing plain text snapshots as empty canonical text", () => {
    const blockGraph = createBlockGraphFromTypes(["textBlock"]);
    const blockId = testBlockId(0);
    const contentRuntime = {
      subscribeBlockProjection: vi.fn(() => vi.fn()),
      readBlockProjection: vi.fn(() => undefined),
    } as unknown as EditorContentRuntime;
    const editor = createInactiveEditorDouble();

    const rendered = render(
      <TextBlockPrimitive
        block={createInactiveBlock(blockGraph.blocks[blockId]!, blockId)}
        editor={createInactiveRenderPort(
          editor,
          contentRuntime,
          testEditableEditorDefinition,
        )}
      />,
    );

    expect(rendered.container.textContent).toBe("");
    expect(
      rendered.container
        .querySelector("[data-editor-inactive-text-root]")
        ?.getAttribute("data-empty"),
    ).toBe("true");
  });

  it("keeps canonical projection text stable while selection paint is owned by the list layer", () => {
    const rendered = renderInactiveBlock("textBlock", "abcdef");

    expect(
      rendered.container.querySelector("[data-editor-selection-paint]"),
    ).toBeNull();
    expect(rendered.container.textContent).toBe("abcdef");
    rendered.contentRuntime.destroy();
  });

  it("keeps inline marks visible when a formatted text block is rendered as a canonical projection", () => {
    const rendered = renderInactiveBlock("textBlock", "bold text");

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

  it("renders rich inline mention atoms from canonical projections without hydrating Yjs", () => {
    const rendered = renderInactiveBlock("textBlock", "", {
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

  it("parses marks and inline-atom metadata once per subscribed projection update", () => {
    let metadataSchemaReads = 0;
    let atomRenders = 0;
    const metadata = {} as EditableEditorDefinition["inlineAtoms"][number]["metadata"];
    Object.defineProperty(metadata, "id", {
      enumerable: true,
      get() {
        metadataSchemaReads += 1;
        return { type: "string", required: true } as const;
      },
    });
    const definition: EditableEditorDefinition = {
      ...testMentionDefinition,
      inlineAtoms: [{
        ...testMentionDefinition.inlineAtoms[0]!,
        metadata,
        render: (atomMetadata) => {
          atomRenders += 1;
          return testMentionDefinition.inlineAtoms[0]!.render(atomMetadata);
        },
      }],
    };
    const rendered = renderInactiveBlock("textBlock", "", { definition });
    const inlineContent = [
      { type: "text", text: "Marked ", marks: [{ type: "strong" }] },
      mentionNode(mentionCases[0]),
    ] as const satisfies readonly RichTextInlineNodeJson[];
    metadataSchemaReads = 0;
    atomRenders = 0;

    reconcileReadProjection(rendered, inlineContent);

    expect(atomRenders).toBe(2);
    expect(metadataSchemaReads).toBe(3);
    expect(rendered.container.querySelector("strong")?.textContent).toBe(
      "Marked ",
    );
    expect(rendered.container.querySelector(".test-mention")).not.toBeNull();
    rendered.contentRuntime.destroy();
  });

  it.each(mentionCases)(
    "renders mention $id by resolving product display state in the definition renderer",
    (mention) => {
      const rendered = renderInactiveBlock("textBlock", "", {
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

  it("keeps mixed rich inline content ordered around inactive mentions", () => {
    const rendered = renderInactiveBlock("textBlock", "", {
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

    const textBlock = rendered.container.querySelector(
      "[data-block-node='paragraph']",
    );
    const strong = textBlock?.querySelector("strong");
    const mentionElement =
      textBlock?.querySelector<HTMLElement>(".test-mention");
    const em = textBlock?.querySelector("em");
    expect(textBlock?.textContent).toBe("Bold @Project Plan italic tail");
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

  it("keeps selected inactive mention text as content while paint is owned by the list layer", () => {
    const rendered = renderInactiveBlock("textBlock", "", {
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
    const rendered = renderInactiveBlock("textBlock", "");

    expect(() =>
      reconcileReadProjection(rendered, [mentionNode(mentionCases[0])]),
    ).toThrow(/type mention is not registered/i);
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

const testMentionDefinition: EditableEditorDefinition = {
  blocks: testEditableEditorDefinition.blocks,
  defaultRoot: "textBlock",
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

function mentionNode(mention: MentionCase): RichTextInlineNodeJson {
  return {
    type: "mention",
    metadata: { id: mention.id },
  };
}

function reconcileReadProjection(
  rendered: ReturnType<typeof renderInactiveBlock>,
  inlineContent: readonly RichTextInlineNodeJson[],
): void {
  act(() => {
    rendered.contentRuntime.applyExternalContentUpdate({
      blockGraphVersion: 1,
      blockId: rendered.blockId,
      blockType: rendered.block.type,
      update: createTestContentOperationUpdate(rendered.contentRuntime),
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
      revision: 1,
    });
  });
}

function renderInactiveBlock(
  type: Block["type"],
  text: string,
  options: {
    focusBlock?: ReturnType<typeof vi.fn>;
    placeholder?: TextPlaceholder;
    definition?: EditableEditorDefinition;
    editor?: EditorImplementation;
    textDomPresentation?: TextDomPresentation;
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
  const contentRuntime = createEditorContentRuntime(
    {
      blockGraphVersion: documentData.blockGraphVersion,
      blockTypesById: { [blockId]: type },
      opaqueContentCheckpoints: documentData.opaqueContentCheckpoints,
      contentById: documentData.contentById,
    },
    definition,
  );
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
  const editor = options.editor ?? createInactiveEditorDouble(options.focusBlock);
  const block = createInactiveBlock(blockGraph.blocks[blockId]!, blockId);
  const readBlock = (
    <TextBlockPrimitive
      block={block}
      editor={createInactiveRenderPort(editor, contentRuntime, definition)}
      placeholder={options.placeholder}
      textDomPresentation={options.textDomPresentation}
    />
  );
  const rendered = render(readBlock);
  return { ...rendered, blockId, contentRuntime, block };
}

function createInactiveEditorDouble(
  focusBlock: ReturnType<typeof vi.fn> = vi.fn(),
): EditorImplementation {
  return {
    focusBlock,
  } as unknown as EditorImplementation;
}

function createInactiveBlock(
  block: VersionedBlock,
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

function createInactiveRenderPort(
  editor: EditorImplementation,
  contentRuntime: EditorContentRuntime,
  definition: EditableEditorDefinition,
): EditableEditorRuntimePort {
  const compiledDefinition = compileCanonicalEditorDefinition(definition);
  const runtime = {
    ...editor,
    editable: true,
    definition,
    compiledDefinition,
    contentRuntime,
  };
  assertInactiveRenderPort(runtime);
  registerEditorRuntimePort(runtime, runtime);
  return runtime;
}

function assertInactiveRenderPort(
  value: object,
): asserts value is EditableEditorRuntimePort {
  if (
    !("definition" in value) ||
    !("compiledDefinition" in value) ||
    !("contentRuntime" in value)
  ) {
    throw new Error("inactive render-port fixture is incomplete");
  }
}

function readRenderedText(root: Element): string {
  let text = "";
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node instanceof HTMLBRElement) {
      if (!node.hasAttribute("data-editor-canonical-trailing-break")) text += "\n";
    } else if (node instanceof Element) {
      text += readRenderedText(node);
    }
  }
  return text;
}
