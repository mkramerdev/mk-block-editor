import type { VersionedBlock } from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { EditorBlockContentOperationBatch } from "./logical-operations.ts";

export interface ResolvedBlockGraphPlacement {
  readonly blockId: BlockId;
  readonly parentId: BlockId | null;
  readonly childIndex: number;
  readonly previousSiblingId: BlockId | null;
  readonly nextSiblingId: BlockId | null;
}

export type EditorBlockGraphOperationKind = "transformBlocks";

export interface EditorTransformBlocksOperationBody<
  Payload = TransformBlocksPayload,
> {
  readonly kind: "transformBlocks";
  readonly payload: Payload;
}

export type EditorBlockGraphOperationBody<Payload = TransformBlocksPayload> =
  EditorTransformBlocksOperationBody<Payload>;

export interface BlockGraphPatch {
  readonly affectedBlockIds: readonly BlockId[];
  readonly upsertedBlocks: readonly VersionedBlock[];
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  /**
   * Final semantic placements resolved against this graph. Persistence
   * consumers may translate these transient neighbors into their own ordering
   * representation; history stores only parentId and childIndex.
   */
  readonly resolvedPlacements?: readonly ResolvedBlockGraphPlacement[];
  /**
   * Blocks removed by a durable transform are retained as tombstoned
   * `move-replace` records when the operation is applied. This gives every
   * consumer one structural meaning instead of mixing hard deletes with
   * synthesized tombstones.
   */
  readonly removedBlockIds?: readonly BlockId[];
}

/** Durable graph and ordered block-content changes committed atomically. */
export interface TransformBlocksPayload extends BlockGraphPatch {
  readonly targetId: string;
  readonly contentOperations?: readonly EditorBlockContentOperationBatch[];
}
