import type { VersionedBlock } from "@repo/editor-core/document";
import type { SelectionController } from "@repo/editor-react/selection";
import type { ReactNode } from "react";
import type { EditorReadRuntime } from "../../runtime/document/contracts.ts";
import type { EditorRenderPort } from "../../runtime/document/render-port.ts";

export interface BlockRendererProps<
  TEditor extends EditorReadRuntime = EditorReadRuntime,
> {
  readonly block: VersionedBlock;
  readonly editor: EditorRenderPort<TEditor>;
  readonly selectionController: SelectionController;
  readonly children?: ReactNode;
}

export type EditorWebBlockRenderer<
  TEditor extends EditorReadRuntime = EditorReadRuntime,
> = {
  bivarianceHack(props: BlockRendererProps<TEditor>): ReactNode;
}["bivarianceHack"];
