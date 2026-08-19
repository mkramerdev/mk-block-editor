import type { RichTextDocumentNodeJson } from "../../content/rich-text/rich-inline-types.ts";
import type { BlockType, VersionedBlock } from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { JsonObject } from "../../kernel/json/json-value.ts";
import type { ContentVersion } from "../../kernel/versioning/versions.ts";
import type {
  EditorBlockContentOperationBatch,
  EditorLogicalContentOperation,
} from "../../operations/language/logical-operations.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { CanonicalBlockRecord } from "../canonical-fragment.ts";

export interface BlockPlacement {
  readonly parentId: BlockId | null;
  readonly childIndex: number;
}

export interface ResolvedBlockPlacement extends BlockPlacement {
  readonly previousSiblingId: BlockId | null;
  readonly nextSiblingId: BlockId | null;
}

export type StructuralEditRangeBoundary =
  | {
      readonly kind: "text";
      readonly blockId: BlockId;
      readonly offset: number;
    }
  | {
      readonly kind: "block";
      readonly blockId: BlockId;
    };

export type StructuralEditRangeBlock =
  | {
      readonly kind: "text";
      readonly blockId: BlockId;
      readonly blockType: BlockType;
      readonly parentId: BlockId | null;
      readonly from: number;
      readonly to: number;
      readonly expectedContentVersion: ContentVersion | string | null;
    }
  | {
      readonly kind: "content";
      readonly blockId: BlockId;
      readonly blockType: BlockType;
      readonly parentId: BlockId | null;
      readonly expectedContentVersion?: ContentVersion | string | null;
    }
  | {
      readonly kind: "block";
      readonly blockId: BlockId;
      readonly blockType: BlockType;
      readonly parentId: BlockId | null;
    };

/**
 * A resolved, platform-independent edit range. Its blocks are in canonical
 * reading order and already encode selection-model decisions such as wrapper
 * preservation, complete block removal, and feature-owned internal selections.
 */
export interface StructuralEditRange {
  readonly graphRevision: number;
  readonly selectionRevision: number;
  readonly blocks: readonly StructuralEditRangeBlock[];
  readonly start: StructuralEditRangeBoundary;
  readonly end: StructuralEditRangeBoundary;
}

export interface TransactionRestoredBlockRecord {
  readonly block: VersionedBlock;
  readonly placement: BlockPlacement;
}

export interface TransactionBlockReplacement {
  readonly block: VersionedBlock;
}

export type TransactionSelectionTarget =
  | {
      readonly kind: "text-offset";
      readonly blockId: BlockId;
      readonly offset: number;
    }
  | { readonly kind: "block-start"; readonly blockId: BlockId }
  | { readonly kind: "block-end"; readonly blockId: BlockId }
  | { readonly kind: "atomic"; readonly blockId: BlockId }
  | { readonly kind: "none" };

export type TransactionContentInput =
  | {
      readonly kind: "value";
      readonly content: RichTextDocumentNodeJson;
      readonly plainText: string;
    }
  | { readonly kind: "split-output"; readonly outputId: string };

/** Replaces the complete canonical metadata value for one live block. */
export interface ReplaceBlockMetadataOperation {
  readonly kind: "replaceBlockMetadata";
  readonly blockId: BlockId;
  readonly expectedMetadataVersion: string;
  /** A complete metadata object, or null to remove metadata explicitly. */
  readonly metadata: JsonObject | null;
}

export type StructuralTransactionOperation =
  | {
      readonly kind: "deleteRange";
      readonly range: StructuralEditRange;
    }
  | {
      readonly kind: "joinTextBlocks";
      readonly leftBlockId: BlockId;
      readonly rightBlockId: BlockId;
    }
  | {
      /** Append the donor's canonical inline content without owning graph removal. */
      readonly kind: "appendTextBlockContent";
      readonly destinationBlockId: BlockId;
      readonly sourceBlockId: BlockId;
      readonly expectedDestinationContentVersion:
        | ContentVersion
        | string
        | null;
      readonly expectedSourceContentVersion: ContentVersion | string | null;
      readonly operation: Extract<
        EditorLogicalContentOperation,
        { readonly kind: "insertInlineContent" }
      >;
    }
  | {
      /** Replays one finalized logical operation during structural history. */
      readonly kind: "applyContentOperation";
      readonly operation: EditorLogicalContentOperation;
    }
  | {
      readonly kind: "splitText";
      readonly blockId: BlockId;
      readonly offset: number;
      readonly selectionRange?: {
        readonly from: number;
        readonly to: number;
      };
      readonly expectedContentVersion: ContentVersion | string | null;
      readonly outputId: string;
    }
  | {
      readonly kind: "insertBlocks";
      readonly placement: BlockPlacement;
      readonly blocks: readonly CanonicalBlockRecord[];
    }
  | {
      readonly kind: "restoreBlocks";
      readonly blocks: readonly TransactionRestoredBlockRecord[];
    }
  | {
      readonly kind: "removeBlocks";
      readonly blockIds: readonly BlockId[];
      readonly includeDescendants: boolean;
      readonly expectedParents?: Readonly<
        Partial<Record<BlockId, BlockId | null>>
      >;
    }
  | {
      readonly kind: "moveBlocks";
      readonly blockIds: readonly BlockId[];
      readonly sourcePlacement: BlockPlacement;
      readonly destinationPlacement: BlockPlacement;
    }
  | {
      /** Places one existing block at an exact stable history position. */
      readonly kind: "placeBlock";
      readonly blockId: BlockId;
      readonly placement: BlockPlacement;
    }
  | {
      readonly kind: "replaceBlocks";
      readonly blocks: readonly TransactionBlockReplacement[];
    }
  | {
      readonly kind: "replaceContent";
      readonly blockId: BlockId;
      readonly expectedContentVersion: ContentVersion | string | null;
      readonly value: TransactionContentInput;
      readonly operation?: EditorLogicalContentOperation;
    }
  | ReplaceBlockMetadataOperation
  | {
      readonly kind: "setSelection";
      readonly target: TransactionSelectionTarget;
    };

export interface StructuralTransactionPlan {
  readonly origin: string;
  readonly operations: readonly StructuralTransactionOperation[];
  readonly preconditions?: StructuralTransactionPreconditions;
}

export interface StructuralTransactionPreconditions {
  readonly contentVersions?: Readonly<
    Record<BlockId, ContentVersion | string | null>
  >;
  readonly blocks?: readonly {
    readonly blockId: BlockId;
    readonly type: BlockType;
    readonly parentId: BlockId | null;
  }[];
}

export interface TransactionReadableContent {
  readonly content: RichTextDocumentNodeJson;
  readonly plainText: string;
  readonly version: ContentVersion | string | null;
}

export interface StructuralTransactionContext {
  readonly graphRevision?: number;
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly readContent: (
    blockId: BlockId,
    blockType: BlockType,
  ) => TransactionReadableContent | null;
  readonly validateContent: (
    blockType: BlockType,
    content: RichTextDocumentNodeJson,
  ) => boolean;
  /** Host version assigned to content changed by this transaction. */
  readonly nextContentVersion?: ContentVersion | string;
  /** Host version assigned to metadata changed by this transaction. */
  readonly nextMetadataVersion?: string;
}

export interface AppliedStructuralTransaction {
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly contentOperations: readonly EditorBlockContentOperationBatch[];
  readonly stagedContent: Readonly<
    Partial<Record<BlockId, TransactionReadableContent>>
  >;
  readonly selection: TransactionSelectionTarget;
  readonly affectedBlockIds: readonly BlockId[];
  readonly splitOutputs: Readonly<Record<string, SplitTextOutput>>;
}

export interface ApplyStructuralTransactionOptions {
  /**
   * Operation previews intentionally allow temporarily invalid wrapper
   * sequences so a later mutation in the same active transaction can repair
   * them. Final application always validates the complete draft.
   */
  readonly validateFinal?: boolean;
}

export type StructuralTransactionResult =
  | { readonly ok: true; readonly transaction: AppliedStructuralTransaction }
  | {
      readonly ok: false;
      readonly operationIndex: number | null;
      readonly failureKind:
        | "invalid-plan"
        | "stale-precondition"
        | "invalid-boundary"
        | "invalid-structure"
        | "invalid-content"
        | "invalid-selection";
      readonly message: string;
    };

export interface SplitTextOutput {
  readonly content: RichTextDocumentNodeJson;
  readonly plainText: string;
}
