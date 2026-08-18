import { render, screen } from "@testing-library/react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createBlockRecord } from "@repo/editor-core/metadata";
import type { BlockId } from "@repo/editor-core/kernel";
import type { BlockType } from "@repo/editor-core/document";
import { createSelectionController } from "@repo/editor-react/selection";
import {
  BlockRenderer,
  type BlockRendererProps,
} from "../document/blocks/block-renderer.tsx";
import type { EditorRuntimePort } from "../runtime/document/render-port.ts";
import type { Editor } from "../runtime/document/contracts.ts";
import type { EditorWithBlockOperations } from "../block-operations/editor-extension.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";

const blockId = "custom-a" as BlockId;
const blockType = "customBlock" as BlockType;

describe("BlockRenderer", () => {
  it("preserves extended renderer types without exposing runtime internals", () => {
    expectTypeOf<
      BlockRendererProps<EditorWithBlockOperations>["editor"]
    >().toHaveProperty("insertBlock");
    expectTypeOf<BlockRendererProps<Editor>["editor"]>().not.toHaveProperty(
      "insertBlock",
    );
    expectTypeOf<
      BlockRendererProps<EditorWithBlockOperations>["editor"]
    >().not.toHaveProperty("executeStructuralTransaction");
    expectTypeOf<
      BlockRendererProps<EditorWithBlockOperations>["editor"]
    >().not.toHaveProperty("contentRuntime");
  });

  it("invokes the registered renderer with block, editor, selection interaction, and ordinary children", () => {
    const selectionController = createSelectionController();
    const renderer = vi.fn(
      ({
        block,
        editor,
        selectionController: receivedSelectionController,
        children,
      }: BlockRendererProps) => (
        <div
          data-testid="custom-renderer"
          data-block-id={block.id}
          data-editor-identity={String(editor === renderPort)}
          data-selection-controller-identity={String(
            receivedSelectionController === selectionController,
          )}
        >
          {children}
        </div>
      ),
    );
    const definition = {
      ...testEditableEditorDefinition,
      blocks: {
        ...testEditableEditorDefinition.blocks,
        [blockType]: {
          kind: "atomic" as const,
          type: blockType,
          rootLayout: "normal" as const,
          renderer,
        },
      },
    };
    const renderPort = {
      definition,
    } as EditorRuntimePort;
    const block = createBlockRecord({
      id: blockId,
      type: blockType,
    });

    render(
      <BlockRenderer
        block={block}
        editor={renderPort}
        selectionController={selectionController}
      >
        <span data-testid="direct-child">Child</span>
      </BlockRenderer>,
    );

    expect(
      screen.getByTestId("custom-renderer").getAttribute("data-block-id"),
    ).toBe(blockId);
    expect(
      screen
        .getByTestId("custom-renderer")
        .getAttribute("data-editor-identity"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("custom-renderer")
        .getAttribute("data-selection-controller-identity"),
    ).toBe("true");
    expect(screen.getByTestId("direct-child").textContent).toBe("Child");
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(Object.keys(renderer.mock.calls[0]![0]).sort()).toEqual([
      "block",
      "children",
      "editor",
      "selectionController",
    ]);
  });

  it("throws the useful missing-renderer error", () => {
    const block = createBlockRecord({
      id: blockId,
      type: "missing",
    });
    const renderPort = {
      definition: testEditableEditorDefinition,
    } as EditorRuntimePort;
    const selectionController = createSelectionController();

    expect(() =>
      render(
        <BlockRenderer
          block={block}
          editor={renderPort}
          selectionController={selectionController}
        />,
      ),
    ).toThrow(
      "Editor block definition does not provide a renderer for missing.",
    );
  });
});
