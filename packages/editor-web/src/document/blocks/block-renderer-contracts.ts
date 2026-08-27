import type { VersionedBlock } from "@repo/editor-core/document";
import type { SelectionController } from "@repo/editor-react/selection";
import type { ReactNode } from "react";
import type { EditableEditor } from "../../runtime/document/contracts.ts";
import type { EditorRenderPort } from "../../runtime/document/render-port.ts";

export interface BlockRendererProps<
  TEditor extends EditableEditor = EditableEditor,
> {
  readonly block: VersionedBlock;
  readonly editor: EditorRenderPort<TEditor>;
  readonly selectionController: SelectionController;
  /**
   * Wrapper children is a stable descendant sequence to place directly. It
   * must not be counted, flattened, cloned, partitioned, or reconstructed by
   * the product renderer.
   */
  readonly children?: ReactNode;
}

export type EditorWebBlockRenderer<
  TEditor extends EditableEditor = EditableEditor,
> = {
  bivarianceHack(props: BlockRendererProps<TEditor>): ReactNode;
}["bivarianceHack"];
