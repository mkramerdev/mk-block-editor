import type { BlockType } from "../document/model/block.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import type { JsonObject } from "../kernel/json/json-value.ts";
import type { BlockSelectionModel } from "../selection/block-selection.ts";

export type BlockContent = {
  readonly required: readonly BlockType[];
  readonly additional?: BlockType | "block";
};
export type BlockData = Readonly<Record<string, unknown>>;
export type TextBlockSplitMap = Readonly<Record<string, BlockType>>;

/** Metadata ownership applied when an existing block is converted to this type. */
export interface BlockConversionPolicy {
  readonly metadata: "target-defaults";
}

/** Declarative direct-parent constraint. Omitting it allows roots and any wrapper. */
export interface BlockParentConstraint {
  readonly allowed: readonly BlockType[];
}

export type CanonicalListPolicy =
  | {
      readonly kind: "container";
      readonly itemType: BlockType;
    }
  | {
      readonly kind: "item";
      readonly containerType: BlockType;
      readonly primaryTextChildType: BlockType;
      readonly emptyEnter: "lift-primary-out-of-container";
    };

export interface BlockMetadataValidationContext {
  readonly metadata: JsonObject | undefined;
  readonly blockId: BlockId;
  readonly directChildIds: readonly BlockId[];
}

/** Returns semantic metadata errors for the current block graph without repairing data. */
export type BlockMetadataValidator = (
  context: BlockMetadataValidationContext,
) => readonly string[];

/** Explicit structural cleanup semantics for a wrapper whose minimum underflows. */
export interface WrapperUnderflowPolicy {
  /** Remove the wrapper and its sole surviving child wrapper after promoting that child's contents. */
  readonly kind: "promote-single-child-contents";
}

/**
 * Canonical Backspace semantics for a compound wrapper with one primary text
 * child followed by a wrapper whose children survive unwrapping.
 */
export interface CompoundWrapperPolicy {
  readonly kind: "primary-text-with-promoted-content";
  readonly primaryTextChildType: BlockType;
  readonly contentWrapperChildType: BlockType;
  readonly emptyPrimary: "remove-wrapper";
}

/** Product-owned runtime configuration for one persisted block type. */
export interface BlockDefinition {
  /** Structural behavior supplied by this definition. */
  readonly kind: "text" | "atomic" | "wrapper";
  /** Stable block type string used in persisted block records and operations. */
  readonly type: BlockType;
  /** Root-level layout owned declaratively by the definition. */
  readonly rootLayout: "normal" | "full";

  /** View-owned projection slot refined by platform editor definitions. */
  readonly renderer?: unknown;

  /** Optional semantic selection model supplied by the block type. */
  readonly selection?: BlockSelectionModel;
  /** Author-owned field access defaults. The editor assigns no storage semantics. */
  readonly data?: BlockData;
  /** Complete metadata materialized when a newly created block omits metadata. */
  readonly defaultMetadata?: JsonObject;
  /** Definition-owned semantic validation for metadata that depends on block identities. */
  readonly validateMetadata?: BlockMetadataValidator;

  /** Structural child model used by wrapper definitions. */
  readonly content?: BlockContent;
  /** Whether wrapper content forms an editing boundary. */
  readonly contentBoundary?: boolean;
  /** Concrete child type used to initialize wildcard wrapper content. */
  readonly defaultContent?: BlockType;
  /** Parent-sensitive split behavior used by text definitions. */
  readonly split?: TextBlockSplitMap;
  /** Optional allow-list for direct canonical parents. An empty list is invalid. */
  readonly parents?: BlockParentConstraint;
  /** Typed canonical list-container or list-item editing semantics. */
  readonly list?: CanonicalListPolicy;
  /** Definition-owned metadata behavior for canonical type conversion. */
  readonly conversion?: BlockConversionPolicy;
  /** Direct replacement target used by atomic definitions. */
  readonly replaceWith?: BlockType;
  /** Structural cleanup behavior used by wrapper definitions. */
  readonly underflow?: WrapperUnderflowPolicy;
  /** Canonical compound-wrapper behavior independent of renderer state. */
  readonly compound?: CompoundWrapperPolicy;
}
