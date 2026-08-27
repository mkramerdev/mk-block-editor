"use client";

import { createElement, useCallback, type ReactNode } from "react";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { SelectionController } from "@repo/editor-react/selection";
import type { EditableEditorRuntimePort } from "../../runtime/document/render-port.ts";
import { BlockRenderer } from "./block-renderer.tsx";
import { BlockErrorBoundary } from "./block-error-boundary.tsx";
import { editorSelectionBoundsDataAttributes } from "../selection/bounds/selection-bounds.ts";
import type { EditorBlockDomRegistryRegistrar } from "./block-dom-registry.ts";

export interface BlockShellProps {
  block: VersionedBlock;
  editor: EditableEditorRuntimePort;
  selectionController: SelectionController;
  blockDomRegistrar: EditorBlockDomRegistryRegistrar;
  children?: ReactNode;
  rootLayout?: "normal" | "full" | null;
}

function BlockShellBase({
  block,
  editor,
  selectionController,
  blockDomRegistrar,
  children,
  rootLayout = null,
}: BlockShellProps) {
  const blockKind = editor.definition.blocks[block.type]?.kind;
  const shellElement =
    editor.definition.blocks[block.type]?.shellElement ?? "div";
  const wrapper = blockKind === "wrapper";
  const setShellRef = useCallback(
    (shell: HTMLElement | null) => {
      if (!shell) return;
      return blockDomRegistrar.registerBlockShell(block.id, shell);
    },
    [blockDomRegistrar, block.id],
  );
  return createElement(
    shellElement,
    {
      ref: setShellRef,
      className: "editor-web-block",
      "data-editor-block-shell": "true",
      "data-editor-root-layout": rootLayout ?? undefined,
      "data-editor-block-id": block.id,
      "data-editor-block-type": block.type,
      "data-editor-parent-id": block.parentId ?? "",
      "data-editor-wrapper": String(wrapper),
      ...editorSelectionBoundsDataAttributes(block.id),
      role:
        shellElement === "div" && rootLayout !== null ? "listitem" : undefined,
    },
    <BlockErrorBoundary blockId={block.id}>
      <BlockRenderer
        block={block}
        editor={editor}
        selectionController={selectionController}
      >
        {children}
      </BlockRenderer>
    </BlockErrorBoundary>,
  );
}

export const BlockShell = BlockShellBase;
