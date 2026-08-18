import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { BlockId, JsonObject } from "@repo/editor-core/kernel";
import type { BlockGraphPatch } from "@repo/editor-core/operations";
import type {
  BlockPlacement,
  StructuralDocumentValidator,
} from "@repo/editor-core/editing";
import type { InlineMarkDefinition } from "@repo/editor-core/content/marks";
import type { InlineMetadataFieldDefinition } from "@repo/editor-core/content/inline-atoms";
import type { InlineMarkCommandRange } from "@repo/editor-core/content/marks";
import type {
  RichTextAtomNodeJson,
  RichTextDocumentNodeJson,
  RichTextMarkJson,
} from "@repo/editor-core/content/rich-text";
import type { EditorLogicalOperation } from "@repo/editor-core/operations";
import type { EditorLogicalContentOperation } from "@repo/editor-core/operations";
import type { EditorContentOperationUpdate } from "@repo/editor-core/content/rich-text";
import type { EditorExternalStore } from "../../../store/contracts.ts";
import type {
  EditorSelectionTextAffinity,
  EditorSelectionTextAnchor,
  EditorSelectionTextAnchorResolver,
} from "../../../selection/model/types.ts";
import type {
  EditorManifestState,
} from "../state/command-state.ts";
import type { EditorBlockCommandRequest } from "../commands/command-request.ts";
import type { EditorOperationSuggestion } from "../operations/mutation.ts";
import type { EditorDocumentUpdate } from "../operations/document-update.ts";
import type { EditorHistoryResult } from "../history.ts";
import type { EditorTransactionSelection } from "../../../selection/model/types.ts";
import type {
  AppliedContentCommit,
  EditorContentCommitPort,
} from "../operations/content-commit.ts";
import type { EditorLocalMutationProvenance } from "../operations/local-mutation-provenance.ts";

export interface EditorStructuralTransactionOptions {
  readonly origin?: "local-command" | "undo" | "redo";
  readonly editorSuggestion?: EditorOperationSuggestion | null;
  readonly semanticOperation?: EditorLogicalOperation;
  readonly selectionEffect?: import("../operations/mutation.ts").EditorCanonicalSelectionEffect;
  readonly provenance?: EditorLocalMutationProvenance | null;
  /** Present the finalized local text selection before graph removal subscribers run. */
  readonly selectionPresentation?: "canonical-only" | "native-before-removal";
}

interface CanonicalEditorCommitBase {
  readonly transactionId: string;
  readonly baseDocumentRevision: number;
  readonly documentRevision: number;
  readonly selectionBefore: EditorTransactionSelection;
  readonly selectionAfter: EditorTransactionSelection;
  readonly historyAction: "command" | "undo" | "redo";
  readonly provenance: EditorLocalMutationProvenance | null;
}

export interface CanonicalEditorBlockPlacement {
  readonly parentId: BlockId | null;
  readonly previousSiblingId: BlockId | null;
  readonly nextSiblingId: BlockId | null;
}

export type CanonicalEditorBlockGraphChange =
  | {
      readonly kind: "create";
      readonly blockId: BlockId;
      readonly blockType: BlockType;
      readonly placement: CanonicalEditorBlockPlacement;
      readonly initialMetadata?: JsonObject;
    }
  | {
      readonly kind: "move" | "restore";
      readonly blockId: BlockId;
      readonly placement: CanonicalEditorBlockPlacement;
    }
  | { readonly kind: "delete"; readonly blockId: BlockId }
  | {
      readonly kind: "change-type";
      readonly blockId: BlockId;
      readonly blockType: BlockType;
    };

export type CanonicalEditorCommit =
  | (CanonicalEditorCommitBase & {
      readonly kind: "block-graph";
      readonly graphChanges: readonly CanonicalEditorBlockGraphChange[];
      readonly contentCommit?: AppliedContentCommit;
    })
  | (CanonicalEditorCommitBase & {
      readonly kind: "content";
      readonly blockId: BlockId;
      readonly blockType: BlockType;
      readonly operations: readonly EditorLogicalContentOperation[];
      readonly inverseOperations: readonly EditorLogicalContentOperation[];
      readonly yjsUpdate: EditorContentOperationUpdate;
    })
  | (CanonicalEditorCommitBase & {
      readonly kind: "block-metadata";
      readonly operation: import("@repo/editor-core/operations").UpdateBlockMetadataOperation;
    });

export type EditorManifestListener = (update: EditorDocumentUpdate) => void;
export type { EditorDocumentUpdate } from "../operations/document-update.ts";

export interface EditorBlockGraphPatchApplication {
  readonly origin:
    | "remote-materialized-patch"
    | "remote-replay"
    | "external-change";
  readonly blockGraphVersion: number;
  readonly patch: BlockGraphPatch;
  readonly updatedAt?: number;
}

export interface EditorSnapshotReconciliation {
  origin:
    | "external-snapshot"
    | "external-change"
    | "remote-replay"
    | "recovered-visible-state";
  blockGraphVersion: number;
  blocks: Readonly<Record<BlockId, VersionedBlock>>;
  rootBlockIds: readonly BlockId[];
  childIdsByParentId: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>;
}

export interface EditorInfo {
  documentRevision: number;
  blockGraphVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface EditorManifestData {
  blocks: Readonly<Record<BlockId, VersionedBlock>>;
  rootBlockIds: readonly BlockId[];
  childIdsByParentId: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>;
}

export interface EditorTextInsertion {
  readonly blockId: BlockId;
  readonly offset: number;
  readonly text: string;
}

export interface EditorTextDeletion {
  readonly blockId: BlockId;
  readonly range: InlineMarkCommandRange;
}

export interface EditorMarkUpdate {
  readonly blockId: BlockId;
  readonly range: InlineMarkCommandRange;
  readonly mark: RichTextMarkJson;
  readonly enabled: boolean;
}

export interface EditorInlineAtomUpdate {
  readonly blockId: BlockId;
  readonly range: InlineMarkCommandRange;
  readonly atom: RichTextAtomNodeJson;
}

export interface EditorContentMutationOptions {
  readonly editorSuggestion?: EditorOperationSuggestion | null;
  readonly selectionEffect?: import("../operations/mutation.ts").EditorCanonicalSelectionEffect;
}

export interface EditorBlockMetadataUpdateOptions {
  readonly editorSuggestion?: EditorOperationSuggestion | null;
  readonly selectionEffect?: import("../operations/mutation.ts").EditorCanonicalSelectionEffect;
}

export interface EditorBlockDeletion {
  readonly blockIds: readonly BlockId[];
  readonly includeDescendants: true;
  readonly expectedParents?: Readonly<Partial<Record<BlockId, BlockId | null>>>;
}

export interface EditorBlockDeletionResult {
  readonly deletedBlockIds: readonly BlockId[];
}

export interface EditorBlockTypeReplacement {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  /** Omitted preserves metadata; null removes it; an object replaces it. */
  readonly metadata?: JsonObject | null;
}

export interface EditorStructuralBlockMove {
  readonly blockIds: readonly BlockId[];
  /**
   * The destination boundary after the moved roots have been removed from
   * their source sibling sequence.
   */
  readonly destination: BlockPlacement;
}

export interface InitializeEditorImplementationOptions {
  store: EditorExternalStore;
  manifest: EditorManifestState;
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  defaultRootBlockType: BlockType;
  inlineMarks: readonly InlineMarkDefinition[];
  inlineAtomRichTextTypes?: readonly string[];
  inlineAtoms?: readonly {
    readonly type: string;
    readonly metadata: Readonly<Record<string, InlineMetadataFieldDefinition>>;
  }[];
  documentValidators?: readonly StructuralDocumentValidator[];
  onCanonicalCommit?: (commit: CanonicalEditorCommit) => void;
  /** Supplies the opaque publication identity for each finalized transaction. */
  createTransactionId?: () => string;
  onDispose?: () => void;
  contentCommit?: EditorContentCommitPort;
  readBlockPlainText?: (blockId: BlockId, blockType: BlockType) => string;
  readBlockContent?: (
    blockId: BlockId,
    blockType: BlockType,
  ) => RichTextDocumentNodeJson | null;
  validateBlockContent?: (
    blockType: BlockType,
    content: RichTextDocumentNodeJson,
  ) => boolean;
  resolveSelectionTextAnchor?: EditorSelectionTextAnchorResolver["resolveTextAnchor"];
  createSelectionTextAnchor?: (input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly textOffset: number;
    readonly affinity: EditorSelectionTextAffinity | null;
  }) =>
    | {
        readonly ok: true;
        readonly textAnchor: EditorSelectionTextAnchor;
        readonly textOffset: number;
      }
    | { readonly ok: false };
  /**
   * Operation-coordinator scope used while a text focus request creates its
   * canonical anchor and installs the active presentation. Low-level anchor
   * codecs never acquire content themselves.
   */
  acquireTextContentAccess?: (blockId: BlockId) => (() => void) | null;
  maximumHistoryEntries?: number;
  requestNativeFocus?: (
    request: EditorNativeFocusRequest,
  ) => EditorNativeFocusRequestResult;
  requestNativePresentation?: (
    request: EditorNativeFocusRequest,
  ) => EditorNativeFocusRequestResult;
  releaseNativeFocus?: (
    blockId: BlockId,
    targetKind: EditorNativeFocusTargetKind,
  ) => void;
  presentTextProjection?: (
    blockId: BlockId,
    options: EditorTextFocusOptions & {
      readonly canonicalSelectionRevision: number;
    },
  ) => EditorNativeFocusRequestResult;
  canPresentTextProjection?: (blockId: BlockId) => boolean;
  hasActiveTextProjection?: (blockId: BlockId) => boolean;
  blurEditor?: () => void;
  executeTextCommand?: (
    blockId: BlockId,
    request: EditorBlockCommandRequest,
  ) => boolean;
  readTextPlainText?: (blockId: BlockId) => string | null;
}

export interface EditorHistoryCommands {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly commandAvailability: EditorCommandAvailabilityReader;
  undo(): EditorHistoryResult;
  redo(): EditorHistoryResult;
}

export interface EditorCommandAvailability {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface EditorCommandAvailabilityReader {
  getSnapshot(): EditorCommandAvailability;
  subscribe(listener: () => void): () => void;
}

export type EditorNativeFocusTargetKind = "text" | "atomic";

export interface EditorNativeFocusRequest {
  readonly token: symbol;
  readonly blockId: BlockId;
  readonly targetKind: EditorNativeFocusTargetKind;
  readonly graphRevision: number;
  readonly preventScroll: boolean;
  readonly offset?: number;
  readonly placement?: "start" | "end";
  readonly affinity?: EditorSelectionTextAffinity | null;
}

export type EditorNativeFocusRequestResult =
  | { readonly status: "focused" }
  | { readonly status: "pending" }
  | { readonly status: "rejected"; readonly reason: string };

export type EditorFocusActionResult =
  | { readonly status: "focused" }
  | { readonly status: "pending" }
  | {
      readonly status: "rejected";
      readonly reason:
        | "disposed"
        | "missing-block"
        | "wrong-block-kind"
        | "invalid-selection-model"
        | "invalid-offset"
        | "native-focus-failed"
        | "stale-graph"
        | "selection-rejected";
    };

export interface EditorBlockFocusOptions {
  readonly preventScroll?: boolean;
}

export interface EditorTextFocusOptions {
  readonly offset?: number;
  readonly placement?: "start" | "end";
  readonly preventScroll?: boolean;
  readonly affinity?: EditorSelectionTextAffinity | null;
}
