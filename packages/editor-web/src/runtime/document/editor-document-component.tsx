"use client";

import { type CSSProperties } from "react";
import { BlockList } from "../../document/editor/block-list.tsx";
import { resolveEditorRuntimePort } from "./runtime-port-registry.ts";
import type {
  EditableEditor,
  EditorDocumentProps,
  EditorLayoutConfig,
} from "./contracts.ts";
import type { EditableEditorRuntimePort } from "./render-port.ts";

const neutralEditorLayout: EditorLayoutConfig = {
  sideLeftWidth: "0px",
  sideRightWidth: "0px",
};

type EditorLayoutStyle = CSSProperties & {
  "--editor-side-left-width": string;
  "--editor-side-right-width": string;
};

export function EditorDocument<TEditor extends EditableEditor>({
  editor,
  interactionEnabled = true,
  layout,
  childOrderProjection,
  children,
  trailingContent,
  renderDocumentLayers,
  onSelectionDragStart,
  onSelectionDragUpdate,
  onSelectionDragEnd,
}: EditorDocumentProps<TEditor>) {
  const renderEditor = resolveEditorRuntimePort(editor);
  const effectiveLayout = layout ?? neutralEditorLayout;
  const layoutStyle: EditorLayoutStyle = {
    "--editor-side-left-width": effectiveLayout.sideLeftWidth,
    "--editor-side-right-width": effectiveLayout.sideRightWidth,
  };
  return (
    <div
      role="region"
      aria-label="Document editor"
      className="editor-web-document"
      data-editor-web="document"
      data-testid="editor-document"
      style={layoutStyle}
    >
      <BlockList
        definition={renderEditor.definition}
        contentRuntime={renderEditor.contentRuntime}
        editor={renderEditor as EditableEditorRuntimePort<TEditor>}
        interactionEnabled={interactionEnabled}
        childOrderProjection={childOrderProjection}
        rootLeadingContent={children}
        renderDocumentLayers={renderDocumentLayers}
        onSelectionDragStart={onSelectionDragStart}
        onSelectionDragUpdate={onSelectionDragUpdate}
        onSelectionDragEnd={onSelectionDragEnd}
      />
      {trailingContent}
    </div>
  );
}
