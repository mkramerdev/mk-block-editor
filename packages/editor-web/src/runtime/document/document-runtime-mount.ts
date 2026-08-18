import type { ComponentType } from "react";
import type { EditorBlockDomRegistryReader } from "../../document/blocks/block-dom-registry.ts";
import type { CaptureStructuralSelection } from "../../document/selection/controller/browser-selection-types.ts";
import type { TransientPointerSelectionPaint } from "../../document/selection/paint/selection-paint-layer.tsx";
import type {
  EditorSelectionTextAnchorResolver,
  SelectionCompositionSessionSnapshot,
} from "@repo/editor-react/selection";
import type { EditorDocumentLayerKeyboardDispatcher } from "./document-layer-interactions.ts";
import type { EditorSelectionDragCallback } from "./contracts.ts";

export interface EditorDocumentRuntimeMountProps {
  readonly listElement: HTMLDivElement | null;
  readonly blockDom: EditorBlockDomRegistryReader;
  readonly textAnchorResolver: EditorSelectionTextAnchorResolver;
  readonly captureStructuralSelection: CaptureStructuralSelection;
  readonly composition: SelectionCompositionSessionSnapshot | null;
  readonly documentLayerKeyboard: EditorDocumentLayerKeyboardDispatcher;
  readonly onTransientPointerPaintChange: (
    paint: TransientPointerSelectionPaint | null,
  ) => void;
  readonly onSelectionDragStart?: EditorSelectionDragCallback;
  readonly onSelectionDragUpdate?: EditorSelectionDragCallback;
  readonly onSelectionDragEnd?: EditorSelectionDragCallback;
}

export type EditorDocumentRuntimeMount =
  ComponentType<EditorDocumentRuntimeMountProps>;
