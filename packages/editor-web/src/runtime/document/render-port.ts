import type { EditorImplementation } from "@repo/editor-react/editor";
import type {
  EditorLogicalSelectionPoint,
  EditorSelectionTextAffinity,
  SelectionController,
} from "@repo/editor-react/selection";
import type { EditorExternalStore } from "@repo/editor-react/store";
import type { BlockSelectionModel } from "@repo/editor-core/selection";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorContentRuntime } from "@repo/editor-core/content";
import type { EditorContentRuntimeResources } from "../content/runtime-resources.ts";
import type { CanonicalContentResources } from "../content/canonical-resources.ts";
import type { EditableEditorDefinition } from "../definition/contracts.ts";
import type { CompiledCanonicalEditorDefinition } from "../definition/compiled-editor-definition.ts";
import type { EditableEditor } from "./contracts.ts";
import type { EditorBlockCommandRequest } from "@repo/editor-react/editor";
import type { EditorBlockDomRegistryReader } from "../../document/blocks/block-dom-registry.ts";
import type { EditorView } from "@repo/editor-dom/prosemirror";
import type { TextPlaceholder } from "@repo/editor-dom/block-editor";
import type { EditorDocumentGeometryRegistration } from "../../document/geometry/editor-document-geometry.ts";
import type { EditorDocumentRuntimeMount } from "./document-runtime-mount.ts";
import type { EditorCommandDefinition } from "../definition/contracts.ts";
import type { CompiledEditorKeybindings } from "../keybindings/compiled-keybindings.ts";
import type { ResolvedNativeFocusTarget } from "./native-focus-coordinator.ts";
import type { ResolvedTextDomPresentation } from "../../document/blocks/text-dom-presentation.ts";

/**
 * Renderer infrastructure layered onto the caller's public editor type.
 * Concrete editor mutation internals are intentionally absent.
 */
export interface EditorRendererInfrastructure {
  readonly definition: EditableEditorDefinition;
  readonly compiledDefinition: CompiledCanonicalEditorDefinition;
  isDisposed(): boolean;
  getSelectionGraphRevision(): number;
  readBlockPlainText(blockId: BlockId, blockType: BlockType): string;
  readBlockSelectionModel(blockId: BlockId): BlockSelectionModel | null;
  getDirectChildBlocks(parentId: BlockId): readonly VersionedBlock[];
  subscribeBlock(blockId: BlockId, listener: () => void): () => void;
  subscribeChildBlockIds(parentId: BlockId, listener: () => void): () => void;
  subscribeDirectChildBlocks(
    parentId: BlockId,
    listener: () => void,
  ): () => void;
  subscribeRootBlockIds(listener: () => void): () => void;
}

interface EditableRendererInfrastructure {
  createSelectionTextPoint(
    blockId: BlockId,
    textOffset: number,
    affinity?: EditorSelectionTextAffinity | null,
  ): EditorLogicalSelectionPoint | null;
}

export type EditorRenderPort<
  TEditor extends EditableEditor = EditableEditor,
> = TEditor & EditorRendererInfrastructure & EditableRendererInfrastructure;

interface CanonicalRuntimeInfrastructure {
  readonly contentResources: CanonicalContentResources;
  readonly contentRuntime: EditorContentRuntime;
  readonly selectionController: SelectionController;
  readonly geometryRegistration: EditorDocumentGeometryRegistration;
  readonly DocumentRuntimeMount: EditorDocumentRuntimeMount;
}

interface EditableEditorInfrastructure {
  readonly commands: ReadonlyMap<string, EditorCommandDefinition>;
  readonly keybindings: CompiledEditorKeybindings;
  readonly contentResources: EditorContentRuntimeResources;
  readonly store: EditorExternalStore;
  acquireTextEditingDocument(): () => void;
  bindNativeFocusOwnerDocument(document: Document): void;
  registerAtomicFocusTarget(blockId: BlockId, target: HTMLElement): () => void;
  resolveNativeFocusTarget(
    target: EventTarget | null,
  ): ResolvedNativeFocusTarget;
  requestTextPresentation(
    blockId: BlockId,
    options: {
      readonly offset: number;
      readonly canonicalSelectionRevision: number;
      readonly preventScroll?: boolean;
      readonly affinity?: EditorSelectionTextAffinity | null;
    },
  ): boolean;
  isTextProjectionActive(blockId: BlockId): boolean;
  subscribeToTextBlockActivity(
    blockId: BlockId,
    listener: () => void,
  ): () => void;
  registerTextEditingHost(input: {
    readonly blockId: BlockId;
    readonly shell: HTMLElement;
    readonly projection: HTMLElement;
    readonly slot: HTMLElement;
    readonly className: string;
    readonly placeholder?: TextPlaceholder;
    readonly textDomPresentation: ResolvedTextDomPresentation;
  }): {
    update(options: {
      readonly className: string;
      readonly placeholder?: TextPlaceholder;
      readonly textDomPresentation: ResolvedTextDomPresentation;
    }): void;
    dispose(): void;
  };
  acknowledgeTextActivation(
    blockId: BlockId,
    root: HTMLElement,
    canonicalOffset: number,
    nativeNode: Node,
    nativeOffset: number,
  ): boolean;
  readonly nativeSelectionSynchronization: {
    reconcileTextSelection(
      blockId: BlockId,
      anchorOffset: number,
      focusOffset: number,
    ): boolean;
  };
  projectActiveTextSelection(
    blockId: BlockId,
    anchorOffset: number,
    focusOffset: number,
  ): boolean;
  attachBlockShellRegistry(reader: EditorBlockDomRegistryReader): () => void;
  readTextSelectionOffset(blockId: BlockId): number | null;
  executeTextCommand(
    blockId: BlockId,
    request: EditorBlockCommandRequest,
  ): boolean;
  setTextCompositionPinned(blockId: BlockId, pinned: boolean): boolean;
  restoreCommittedTextProjectionAfterComposition(blockId: BlockId): void;
  projectFinalizedTextContent(blockId: BlockId): void;
  readActiveTextView(): EditorView | null;
}

/** Editor-web's internal mounted-document integration port. */
export type EditableEditorRuntimePort<
  TEditor extends EditableEditor = EditableEditor,
> = EditorImplementation &
  EditorRenderPort<TEditor> &
  CanonicalRuntimeInfrastructure &
  EditableEditorInfrastructure;
