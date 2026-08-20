import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { EditorTextBlockContent } from "@repo/editor-core/codecs";
import type { BlockId } from "@repo/editor-core/kernel";
import type { BlockSelectionModel } from "@repo/editor-core/selection";
import type {
  RichTextDocumentNodeJson,
  RichTextInlineNodeJson,
  EditorContentOperationUpdate,
} from "@repo/editor-core/content/rich-text";
import type {
  BlockMetadataUpdate,
  EditorLogicalBlockMetadataOperation,
  EditorLogicalContentOperation,
} from "@repo/editor-core/operations";
import type {
  EditorBlockMetadataUpdateOptions,
  EditorBlockDeletion,
  EditorBlockDeletionResult,
  EditorBlockTypeReplacement,
  EditorStructuralBlockMove,
  EditorContentMutationOptions,
  EditorInlineAtomUpdate,
  EditorMarkUpdate,
  EditorTextDeletion,
  EditorTextInsertion,
  EditorCommandAvailabilityReader,
  EditorHistoryResult,
  EditorTransactionResult,
  EditorTransactionSelectionEffect,
  EditorFocusActionResult,
  CanonicalEditorBlockGraphChange,
} from "@repo/editor-react/editor";
import type {
  EditorReadCurrentSelectionInlineMarkFormatStatesOptions,
  EditorSelectionTextAffinity,
  FormatSelectionInlineMarkOptions,
  FormatSelectionInlineMarkResult,
  ReadSelectionInlineMarkFormatStatesResult,
} from "@repo/editor-react/selection";
import type {
  BlockPlacement,
  CanonicalBlockFragment,
  StructuralEditRange,
} from "@repo/editor-core/editing";
import type {
  EditorSelection,
  EditorLogicalSelectionPoint,
  EditorStableSelection,
  EditorTransactionSelection,
  EditorSelectionTextAnchorResolutionResult,
} from "@repo/editor-react/selection";
import type {
  EditorAdditionalSelectionReader,
  RemoteEditorTransaction,
  RemoteSelectionSnapshot,
  RemoteTransactionResult,
} from "../collaboration/contracts.ts";
import type {
  EditorCanonicalSelectionReader,
  EditorLocalSelectionPaintReader,
} from "@repo/editor-react/selection";
import type { ReactNode } from "react";
import type {
  EditableEditorDefinition,
  EditorDefinition,
  ReadEditorDefinition,
} from "../definition/contracts.ts";
import type { EditorDocumentGeometryReader } from "../../document/geometry/editor-document-geometry.ts";

export type {
  EditorBlockMetadataUpdateOptions,
  EditorBlockDeletion,
  EditorBlockDeletionResult,
  EditorBlockTypeReplacement,
  EditorStructuralBlockMove,
  EditorContentMutationOptions,
  EditorInlineAtomUpdate,
  EditorMarkUpdate,
  EditorTextDeletion,
  EditorTextInsertion,
  EditorTransactionSelectionEffect,
  EditorFocusActionResult,
  EditorCanonicalSelectionEffect,
} from "@repo/editor-react/editor";

export interface EditorLayoutConfig {
  readonly sideLeftWidth: string;
  readonly sideRightWidth: string;
}

export interface EditorDocumentProps<TEditor extends Editor = Editor> {
  readonly editor: TEditor;
  readonly layout?: EditorLayoutConfig;
  readonly renderDocumentLayers?: EditorDocumentLayerRenderer<TEditor>;
  readonly onSelectionDragStart?: EditorSelectionDragCallback;
  readonly onSelectionDragUpdate?: EditorSelectionDragCallback;
  readonly onSelectionDragEnd?: EditorSelectionDragCallback;
}

export interface EditorSelectionDragSnapshot {
  readonly selection: EditorSelection;
  readonly anchor: EditorLogicalSelectionPoint;
  readonly focus: EditorLogicalSelectionPoint;
  readonly pointer: {
    readonly clientX: number;
    readonly clientY: number;
  };
}

export type EditorSelectionDragCallback = (
  snapshot: EditorSelectionDragSnapshot,
) => void;

export type EditorDocumentLayerRenderer<TEditor extends Editor = Editor> = (
  context: EditorDocumentLayerRenderContext<TEditor>,
) => ReactNode;

export type EditorDocumentLayerKeydownResult = "handled" | "unhandled";

export interface EditorDocumentLayerKeyboardEvent {
  readonly key: string;
  readonly code: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
}

export type EditorDocumentLayerKeydownHandler = (
  event: EditorDocumentLayerKeyboardEvent,
) => EditorDocumentLayerKeydownResult;

/** Product-owned document layers may claim a gesture before editor routing. */
export interface EditorDocumentLayerInteractionPort {
  readonly registerKeydownHandler: (
    handler: EditorDocumentLayerKeydownHandler,
  ) => () => void;
}

export interface EditorDocumentLayerRenderContext<
  TEditor extends Editor = Editor,
> {
  readonly editor: TEditor;
  readonly selection: EditorCanonicalSelectionReader;
  readonly readBlockPlainText: (blockId: BlockId) => string | null;
  readonly interactions: EditorDocumentLayerInteractionPort;
}

export interface EditorBlockMetadataChange {
  readonly kind: "block-metadata";
  readonly blockId: BlockId;
  readonly update: EditorLogicalBlockMetadataOperation;
}

export interface EditorBlockContentChange<TContentUpdate = unknown> {
  readonly kind: "block-content";
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly operations: readonly EditorLogicalContentOperation[];
  readonly update: TContentUpdate;
  readonly readProjection: EditorTextBlockContent;
}

export interface EditorBlockGraphChange {
  readonly kind: "block-graph";
  readonly blockId: BlockId | null;
  readonly changes: readonly CanonicalEditorBlockGraphChange[];
}

export interface EditorTransaction {
  readonly transactionId: string;
  readonly selectionBefore: EditorTransactionSelection;
  readonly selectionAfter: EditorTransactionSelection;
}

interface EditorGraphSemanticChangeBase<
  Change extends
    | EditorBlockMetadataChange
    | EditorBlockContentChange
    | EditorBlockGraphChange,
> extends EditorTransaction {
  readonly kind: Change["kind"];
  readonly changedBlockIds: readonly BlockId[];
  readonly deletedBlockIds: readonly BlockId[];
  readonly change: Change;
  readonly historyAction: "command" | "undo" | "redo";
  readonly baseDocumentRevision: number;
  readonly documentRevision: number;
}

export interface EditorBlockContentSemanticChange extends EditorTransaction {
  readonly kind: "block-content";
  readonly baseDocumentRevision: number;
  readonly documentRevision: number;
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly operations: readonly EditorLogicalContentOperation[];
  readonly inverseOperations: readonly EditorLogicalContentOperation[];
  readonly yjsUpdate: EditorContentOperationUpdate;
  readonly readProjection: EditorTextBlockContent;
  readonly selectionBefore: EditorTransactionSelection;
  readonly selectionAfter: EditorTransactionSelection;
  readonly historyAction: "command" | "undo" | "redo";
}

export interface EditorBlockMetadataSemanticChange extends EditorGraphSemanticChangeBase<EditorBlockMetadataChange> {
  readonly canonicalOperation: EditorLogicalBlockMetadataOperation;
}

export interface EditorBlockGraphSemanticChange extends EditorGraphSemanticChangeBase<EditorBlockGraphChange> {
  readonly graphChanges: readonly CanonicalEditorBlockGraphChange[];
  readonly metadataOperation?: EditorLogicalBlockMetadataOperation;
  readonly contentChanges: readonly EditorBlockContentChange<EditorContentOperationUpdate>[];
}

export type EditorSemanticChange =
  | EditorBlockContentSemanticChange
  | EditorBlockMetadataSemanticChange
  | EditorBlockGraphSemanticChange;

export type EditorChangeCallback = (
  change: EditorSemanticChange,
) => void | Promise<void>;

export type EditorTypingTriggerSessionId = string & {
  readonly __editorTypingTriggerSessionId: unique symbol;
};

export type EditorTypingTriggerId = string;

export interface EditorTypingTriggerSessionReference {
  readonly sessionId: EditorTypingTriggerSessionId;
  readonly revision: number;
}

export type EditorTypingTriggerSessionDismissal =
  EditorTypingTriggerSessionReference;

export interface EditorTypingTriggerSession {
  readonly id: EditorTypingTriggerSessionId;
  readonly triggerId: EditorTypingTriggerId;
  readonly trigger: string;
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly range: {
    readonly from: number;
    readonly to: number;
  };
  readonly query: string;
  readonly revision: number;
  readonly selection: {
    readonly blockId: BlockId;
    readonly offset: number;
  };
}

export interface EditorTypingTriggerInlineReplacement extends EditorTypingTriggerSessionReference {
  readonly content: readonly RichTextInlineNodeJson[];
}

export interface EditorTypingTriggerFragmentReplacement extends EditorTypingTriggerSessionReference {
  readonly fragment: CanonicalBlockFragment;
  readonly selectionBlockId: BlockId;
  readonly selectionOffset?: number;
}

export interface EditorReadRuntime {
  readonly definition: EditorDefinition;
  readonly selection: EditorCanonicalSelectionReader;
  readonly selectionPaint: EditorLocalSelectionPaintReader;
  readonly geometry: EditorDocumentGeometryReader;
  getBlock(blockId: BlockId): VersionedBlock | null;
  getParentId(blockId: BlockId): BlockId | null;
  getRootBlockIds(): readonly BlockId[];
  getChildBlockIds(parentId: BlockId): readonly BlockId[];
  getDirectChildBlocks(parentId: BlockId): readonly VersionedBlock[];
  getLastChildBlockId(parentId: BlockId | null): BlockId | null;
  readBlockSelectionModel(blockId: BlockId): BlockSelectionModel | null;
  readBlockContent(
    blockId: BlockId,
    blockType: BlockType,
  ): RichTextDocumentNodeJson | null;
  subscribeBlock(blockId: BlockId, listener: () => void): () => void;
  subscribeRootBlockIds(listener: () => void): () => void;
  subscribeChildBlockIds(parentId: BlockId, listener: () => void): () => void;
  subscribeDirectChildBlocks(
    parentId: BlockId,
    listener: () => void,
  ): () => void;
  applyRemoteTransaction(
    transaction: RemoteEditorTransaction,
  ): RemoteTransactionResult;
  getDiagnostics(): EditorDiagnostics;
  dispose(): void;
}

export interface ReadEditor extends EditorReadRuntime {
  readonly definition: ReadEditorDefinition;
  readonly editable: false;
}

export interface EditableEditor extends EditorReadRuntime {
  readonly definition: EditableEditorDefinition;
  readonly editable: true;
  readonly additionalSelections: EditorAdditionalSelectionReader;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly commandAvailability: EditorCommandAvailabilityReader;
  undo(): EditorHistoryResult;
  redo(): EditorHistoryResult;
  getTypingTriggerSession(): EditorTypingTriggerSession | null;
  subscribeTypingTriggerSession(listener: () => void): () => void;
  dismissTypingTriggerSession(
    dismissal: EditorTypingTriggerSessionDismissal,
  ): boolean;
  replaceTypingTriggerWithInlineContent(
    replacement: EditorTypingTriggerInlineReplacement,
    options?: EditorContentMutationOptions,
  ): boolean;
  replaceTypingTriggerWithCanonicalFragment(
    replacement: EditorTypingTriggerFragmentReplacement,
    options?: EditorContentMutationOptions,
  ): boolean;
  /** Focuses the exact registered atomic target and settles whole-block selection. */
  focusBlock(
    blockId: BlockId,
    options?: EditorBlockFocusOptions,
  ): EditorFocusActionResult;
  focusText(
    blockId: BlockId,
    options?: EditorTextFocusOptions,
  ): EditorFocusActionResult;
  blurEditor(): void;
  /** Explicitly clears canonical selection without changing native focus. */
  clearSelection(): boolean;
  subscribeStandaloneSelectionSettlements(
    listener: (selection: EditorStableSelection) => void,
  ): () => void;
  resolveSelectionTextAnchor(
    point: EditorLogicalSelectionPoint,
  ): EditorSelectionTextAnchorResolutionResult;
  readBlockSelectionModel(blockId: BlockId): BlockSelectionModel | null;
  transaction(callback: () => unknown): EditorTransactionResult;
  deleteRange(range: StructuralEditRange): void;
  insertBlocks(
    placement: BlockPlacement,
    fragment: CanonicalBlockFragment,
  ): {
    readonly rootBlockIds: readonly BlockId[];
    readonly start: CanonicalBlockFragment["start"];
    readonly end: CanonicalBlockFragment["end"];
  };
  deleteBlocks(input: EditorBlockDeletion): EditorBlockDeletionResult;
  replaceBlockTypes(replacements: readonly EditorBlockTypeReplacement[]): void;
  moveBlocks(input: EditorStructuralBlockMove): EditorTransactionResult;
  joinTextBlocks(
    leftBlockId: BlockId,
    rightBlockId: BlockId,
  ): {
    readonly survivorBlockId: BlockId;
    readonly joinOffset: number;
  };
  setTransactionSelection(effect: EditorTransactionSelectionEffect): void;
  updateBlockMetadata(
    updates: readonly BlockMetadataUpdate[],
    options?: EditorBlockMetadataUpdateOptions,
  ): boolean;
  insertText(
    insertion: EditorTextInsertion,
    options?: EditorContentMutationOptions,
  ): boolean;
  deleteText(
    deletion: EditorTextDeletion,
    options?: EditorContentMutationOptions,
  ): boolean;
  readCurrentSelectionInlineMarkFormatStates(
    input: EditorReadCurrentSelectionInlineMarkFormatStatesOptions,
  ): ReadSelectionInlineMarkFormatStatesResult;
  formatSelectionInlineMark(
    input: FormatSelectionInlineMarkOptions,
  ): FormatSelectionInlineMarkResult;
  updateMark(
    update: EditorMarkUpdate,
    options?: EditorContentMutationOptions,
  ): boolean;
  updateInlineAtom(
    update: EditorInlineAtomUpdate,
    options?: EditorContentMutationOptions,
  ): boolean;
  insertCanonicalBlockFragment(
    placement: BlockPlacement,
    fragment: CanonicalBlockFragment,
  ): EditorTransactionResult;
  /** Reads the current live document without collaboration or durability state. */
  readSnapshot(): import("@repo/editor-core/codecs").EditorInstanceSnapshot;
  /** Replaces the authoritative set of ephemeral additional selections. */
  setSelections(snapshot: RemoteSelectionSnapshot): void;
}

export interface EditorBlockFocusOptions {
  readonly preventScroll?: boolean;
}

export interface EditorTextFocusOptions {
  readonly offset?: number;
  readonly placement?: "start" | "end";
  readonly preventScroll?: boolean;
  readonly affinity?: EditorSelectionTextAffinity | null;
}

export type Editor = ReadEditor | EditableEditor;

export interface EditorDiagnostics {
  readonly blockGraphVersion: number;
  readonly cleanupFailureCount: number;
}
