import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createVersionedBlockRecord } from "@repo/editor-core/metadata";
import { asContentVersion } from "@repo/editor-core/kernel";
import type { BlockId } from "@repo/editor-core/kernel";
import { BlockShell } from "../document/blocks/block-shell.tsx";
import { createEditorBlockDomRegistry } from "../document/blocks/block-dom-registry.ts";

vi.mock("../document/blocks/block-renderer", () => ({
  BlockRenderer: () => <div data-testid="block-renderer" />,
}));

const selectionController = {} as never;

function block(id = "shell-block" as BlockId, parentId: BlockId | null = null) {
  return createVersionedBlockRecord({
    id,
    type: "textBlock",
    parentId,
    version: {
      metadataVersion: "1",
      contentVersion: asContentVersion("1"),
    },
  });
}

function renderShell(
  rootLayout: "normal" | "full" | null = "normal",
  shellElement?: "div" | "ol" | "ul" | "li",
) {
  const registry = createEditorBlockDomRegistry();
  const value = block();
  const editor = {
    definition: {
      blocks: {
        textBlock: { kind: "text", type: "textBlock", shellElement },
      },
    },
  } as never;
  const view = render(
    <BlockShell
      block={value}
      editor={editor}
      selectionController={selectionController}
      blockDomRegistrar={registry.registrar}
      rootLayout={rootLayout}
    />,
  );
  return { ...view, registry, block: value };
}

describe("BlockShell structural boundary", () => {
  it("registers and token-safely cleans up the structural shell", () => {
    const value = renderShell();
    const shell = value.container.querySelector<HTMLElement>(
      '[data-editor-block-shell="true"]',
    );
    expect(value.registry.reader.getBlockShell(value.block.id)).toBe(shell);

    value.unmount();
    expect(value.registry.reader.getBlockShell(value.block.id)).toBeNull();
  });

  it("renders identity, bounds, layout, and renderer metadata", () => {
    const { container, block } = renderShell("full");
    const shell = container.querySelector<HTMLElement>(
      '[data-editor-block-shell="true"]',
    );
    expect(shell).toMatchObject({
      dataset: expect.objectContaining({
        editorBlockId: block.id,
        editorBlockType: "textBlock",
        editorParentId: "",
        editorRootLayout: "full",
        editorSelectionBounds: "true",
      }),
    });
    expect(screen.getByTestId("block-renderer").parentElement).toBe(shell);
  });

  it("has no native focus target or focus-establishing pointer behavior", () => {
    const { container } = renderShell();
    const shell = container.querySelector<HTMLElement>(
      '[data-editor-block-shell="true"]',
    )!;
    const nativeFocus = vi.spyOn(shell, "focus");

    fireEvent.mouseDown(shell, { button: 0 });
    fireEvent.click(shell, { button: 0 });
    shell.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(shell.hasAttribute("tabindex")).toBe(false);
    expect(nativeFocus).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(shell);
  });

  it("keeps product chrome and selection paint out of the shell", () => {
    const { container } = renderShell();
    expect(container.querySelector("[draggable='true']")).toBeNull();
    expect(container.querySelector(".editor-web-block-toolbar")).toBeNull();
    expect(container.querySelector("[data-editor-local-selection]")).toBeNull();
  });

  it("uses list-item semantics only for projected roots", () => {
    const root = renderShell("normal");
    expect(root.container.querySelector('[role="listitem"]')).not.toBeNull();
    root.unmount();

    const nested = renderShell(null);
    expect(nested.container.querySelector('[role="listitem"]')).toBeNull();
  });

  it.each(["ol", "ul", "li"] as const)(
    "registers a semantic %s shell without making it focusable",
    (element) => {
      const value = renderShell(null, element);
      const shell = value.container.querySelector<HTMLElement>(element)!;
      expect(shell.dataset.editorBlockId).toBe(value.block.id);
      expect(value.registry.reader.getBlockShell(value.block.id)).toBe(shell);
      expect(shell.hasAttribute("tabindex")).toBe(false);
      expect(shell.hasAttribute("role")).toBe(false);
    },
  );
});
