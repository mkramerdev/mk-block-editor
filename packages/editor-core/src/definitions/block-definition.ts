import type { BlockType } from "../document/model/block.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import type { JsonObject } from "../kernel/json/json-value.ts";
import type { BlockSelectionModel } from "../selection/block-selection.ts";

export type BlockContent = {
  readonly required: readonly BlockType[];
  readonly additional?: BlockType | "block";
};
export type BlockData = Readonly<Record<string, unknown>>;

/** Declarative direct-parent constraint. Omitting it allows roots and any wrapper. */
export interface BlockParentConstraint {
  readonly allowed: readonly BlockType[];
}

export interface BlockMetadataValidationContext {
  readonly metadata: JsonObject | undefined;
  readonly blockId: BlockId;
  readonly directChildIds: readonly BlockId[];
}

/** Returns semantic metadata errors for the current block graph without repairing data. */
export type BlockMetadataValidator = (
  context: BlockMetadataValidationContext,
) => readonly string[];

/** Product-neutral runtime configuration for one opaque persisted block type. */
export interface BlockDefinition {
  /** Structural behavior supplied by this definition. */
  readonly kind: "text" | "atomic" | "wrapper";
  /** Stable block type string used in persisted block records and operations. */
  readonly type: BlockType;
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
  /** Optional allow-list for direct canonical parents. An empty list is invalid. */
  readonly parents?: BlockParentConstraint;
}
