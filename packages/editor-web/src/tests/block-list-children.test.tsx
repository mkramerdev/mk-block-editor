import { Children, useLayoutEffect, useState } from "react";
import { act, render, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { moveBlocks, removeBlocks } from "@repo/editor-core/editing";
import { type BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import type { EditorImplementation } from "@repo/editor-react/editor";
import type { BlockRendererProps } from "../api/block-renderer.ts";
import type { EditorDefinition } from "../runtime/definition/contracts.ts";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import { useTestEditor as useEditor } from "./test-editor-initializers.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";

const firstWrapperId = "ordinary-children-first-wrapper" as BlockId;
const firstChildId = "ordinary-children-first" as BlockId;
const secondChildId = "ordinary-children-second" as BlockId;
const secondWrapperId = "ordinary-children-second-wrapper" as BlockId;
const thirdChildId = "ordinary-children-third" as BlockId;
const fourthChildId = "ordinary-children-fourth" as BlockId;

let nextLeafInstance = 0;
const leafRenderers = new Map<BlockId, ReturnType<typeof vi.fn>>();

function LeafRenderer({ block, children }: BlockRendererProps) {
  const renderSpy = leafRenderers.get(block.id) ?? vi.fn();
  leafRenderers.set(block.id, renderSpy);
  renderSpy();
  const [instance] = useState(() => `${block.id}:${++nextLeafInstance}`);
  return (
    <div
      data-testid={`leaf-${block.id}`}
      data-instance={instance}
      data-child-count={Children.count(children)}
      data-has-children={String(children !== undefined)}
    />
  );
}

function SplitWrapperRenderer({ block, children }: BlockRendererProps) {
  const elements = Children.toArray(children);
  return (
    <section data-testid={`wrapper-${block.id}`}>
      {elements[0] ?? null}
      <span data-testid="product-ui-between-children" />
      <div hidden data-testid="hidden-wrapper-children">
        {elements.slice(1)}
      </div>
    </section>
  );
}

function AllChildrenWrapperRenderer({ block, children }: BlockRendererProps) {
  return <section data-testid={`wrapper-${block.id}`}>{children}</section>;
}

const definition: EditorDefinition = {
  inlineAtoms: [],
  ...testEditableEditorDefinition,
  blocks: {
    ...testEditableEditorDefinition.blocks,
    quote: {
      ...testEditableEditorDefinition.blocks.quote!,
      renderer: SplitWrapperRenderer,
      content: { required: ["block"], additional: "block" },
      defaultContent: "divider",
    },
    code: {
      ...testEditableEditorDefinition.blocks.code!,
      renderer: AllChildrenWrapperRenderer,
      content: { required: ["block"], additional: "block" },
      defaultContent: "video",
    },
    divider: {
      ...testEditableEditorDefinition.blocks.divider!,
      renderer: LeafRenderer,
    },
    image: {
      ...testEditableEditorDefinition.blocks.image!,
      renderer: LeafRenderer,
    },
    video: {
      ...testEditableEditorDefinition.blocks.video!,
      renderer: LeafRenderer,
    },
    audio: {
      ...testEditableEditorDefinition.blocks.audio!,
      renderer: LeafRenderer,
    },
  },
};

const blockSpecs = [
  {
    id: firstWrapperId,
    type: "quote" as BlockType,
    parentId: null,
  },
  {
    id: firstChildId,
    type: "divider" as BlockType,
    parentId: firstWrapperId,
  },
  {
    id: secondChildId,
    type: "image" as BlockType,
    parentId: firstWrapperId,
  },
  {
    id: secondWrapperId,
    type: "code" as BlockType,
    parentId: null,
  },
  {
    id: thirdChildId,
    type: "video" as BlockType,
    parentId: secondWrapperId,
  },
  {
    id: fourthChildId,
    type: "audio" as BlockType,
    parentId: secondWrapperId,
  },
] as const;

function createTraversalSnapshot() {
  const snapshot = createTestEditorSnapshot(
    blockSpecs.map(({ id, type }) => ({ id, type })),
  );
  return {
    ...snapshot,
    blocks: Object.fromEntries(
      blockSpecs.map((block) => [
        block.id,
        createBlockRecord({
          id: block.id,
          type: block.type,
          parentId: block.parentId,
        }),
      ]),
    ),
    rootBlockIds: [firstWrapperId, secondWrapperId],
    childIdsByParentId: {
      [firstWrapperId]: [firstChildId, secondChildId],
      [secondWrapperId]: [thirdChildId, fourthChildId],
    },
  };
}

function TestDocument({
  captureEditor,
}: {
  readonly captureEditor: (editor: EditorImplementation) => void;
}) {
  const editor = useEditor({
    definition,
    snapshot: createTraversalSnapshot(),
  });
  captureEditor(editor as EditorImplementation);
  return <EditorDocument editor={editor} />;
}

describe("recursive block traversal", () => {
  it("composes ordered ordinary children and preserves identity across moves", () => {
    nextLeafInstance = 0;
    let editor: EditorImplementation | null = null;
    const view = render(
      <TestDocument captureEditor={(value) => (editor = value)} />,
    );
    if (!editor) throw new Error("expected the editor to be captured");

    const roots = view.container.querySelector(".editor-web-block-list");
    expect(roots).not.toBeNull();
    expect(
      Array.from(roots!.children)
        .filter(
          (element) =>
            element instanceof HTMLElement &&
            element.dataset.editorBlockShell === "true",
        )
        .map((element) => (element as HTMLElement).dataset.editorBlockId),
    ).toEqual([firstWrapperId, secondWrapperId]);

    const firstWrapper = view.getByTestId(`wrapper-${firstWrapperId}`);
    const secondWrapper = view.getByTestId(`wrapper-${secondWrapperId}`);
    expect(
      within(firstWrapper).getByTestId(`leaf-${firstChildId}`),
    ).toBeTruthy();
    expect(
      within(firstWrapper).getByTestId(`leaf-${secondChildId}`),
    ).toBeTruthy();
    expect(
      within(secondWrapper).getByTestId(`leaf-${thirdChildId}`),
    ).toBeTruthy();
    expect(
      within(secondWrapper).getByTestId(`leaf-${fourthChildId}`),
    ).toBeTruthy();
    expect(view.getByTestId("product-ui-between-children")).toBeTruthy();
    expect(view.getByTestId("hidden-wrapper-children")).toHaveAttribute(
      "hidden",
    );
    for (const leaf of [
      firstChildId,
      secondChildId,
      thirdChildId,
      fourthChildId,
    ]) {
      expect(view.getByTestId(`leaf-${leaf}`)).toHaveAttribute(
        "data-child-count",
        "0",
      );
      expect(view.getByTestId(`leaf-${leaf}`)).toHaveAttribute(
        "data-has-children",
        "false",
      );
    }

    const thirdInstance = view
      .getByTestId(`leaf-${thirdChildId}`)
      .getAttribute("data-instance");
    act(() => {
      const result = editor!.executeStructuralTransaction({
        origin: "block-list-children/reorder",
        operations: [
          moveBlocks({
            blockIds: [thirdChildId],
            sourcePlacement: {
              parentId: secondWrapperId,
              childIndex: 0,
            },
            destinationPlacement: {
              parentId: secondWrapperId,
              childIndex: 1,
            },
          }),
        ],
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
    });
    expect(
      view.getByTestId(`leaf-${thirdChildId}`).getAttribute("data-instance"),
    ).toBe(thirdInstance);
    act(() => {
      const result = editor!.executeStructuralTransaction({
        origin: "block-list-children/reparent",
        operations: [
          moveBlocks({
            blockIds: [firstChildId],
            sourcePlacement: {
              parentId: firstWrapperId,
              childIndex: 0,
            },
            destinationPlacement: {
              parentId: secondWrapperId,
              childIndex: 2,
            },
          }),
        ],
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
    });

    expect(
      within(firstWrapper).queryByTestId(`leaf-${firstChildId}`),
    ).toBeNull();
    expect(
      within(secondWrapper).getAllByTestId(`leaf-${firstChildId}`),
    ).toHaveLength(1);
    expect(editor.getRootBlockIds()).toEqual([firstWrapperId, secondWrapperId]);
    expect(editor.getChildBlockIds(firstWrapperId)).toEqual([secondChildId]);
    expect(editor.getChildBlockIds(secondWrapperId)).toEqual([
      fourthChildId,
      thirdChildId,
      firstChildId,
    ]);
    expect(
      [
        ...editor.getRootBlockIds(),
        ...editor.getChildBlockIds(firstWrapperId),
        ...editor.getChildBlockIds(secondWrapperId),
      ].sort(),
    ).toEqual(blockSpecs.map((block) => block.id).sort());

    view.unmount();
  });

  it("does not execute unrelated block renderers when root membership changes", () => {
    nextLeafInstance = 0;
    leafRenderers.clear();
    const rootIds = Array.from(
      { length: 128 },
      (_, index) =>
        `isolated-root-${String(index).padStart(3, "0")}` as BlockId,
    );
    const snapshot = createTestEditorSnapshot(
      rootIds.map((id) => ({ id, type: "divider" as BlockType })),
    );
    let editor: EditorImplementation | null = null;

    function LargeRootDocument() {
      const runtime = useEditor({ definition, snapshot });
      useLayoutEffect(() => {
        editor = runtime as EditorImplementation;
      }, [runtime]);
      return <EditorDocument editor={runtime} />;
    }

    const view = render(<LargeRootDocument />);
    if (!editor) throw new Error("expected the editor to be captured");
    const removedId = rootIds[64]!;
    const unaffectedIds = rootIds.filter((blockId) => blockId !== removedId);
    const shellsBefore = new Map(
      unaffectedIds.map((blockId) => [
        blockId,
        view.container.querySelector(`[data-editor-block-id="${blockId}"]`),
      ]),
    );
    const renderCountsBefore = new Map(
      rootIds.map((blockId) => [
        blockId,
        leafRenderers.get(blockId)?.mock.calls.length ?? 0,
      ]),
    );

    act(() => {
      const result = editor!.executeStructuralTransaction({
        origin: "block-list-children/remove-one-of-many",
        operations: [
          removeBlocks({
            blockIds: [removedId],
            includeDescendants: true,
            expectedParents: { [removedId]: null },
          }),
        ],
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
    });

    expect(
      view.container.querySelector(`[data-editor-block-id="${removedId}"]`),
    ).toBeNull();
    for (const blockId of unaffectedIds) {
      expect(leafRenderers.get(blockId)?.mock.calls.length).toBe(
        renderCountsBefore.get(blockId),
      );
      expect(
        view.container.querySelector(`[data-editor-block-id="${blockId}"]`),
      ).toBe(shellsBefore.get(blockId));
    }
    view.unmount();
    editor.dispose();
  });
});
