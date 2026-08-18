import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import type { BlockId } from "@repo/editor-core/kernel";
import { createYjsBlockContentCheckpoint } from "@repo/editor-yjs";
import { generateNKeysBetween } from "fractional-indexing";
import {
  assertFirstDraftPostgresSchema,
  type FirstDraftPostgresSchemaClient,
} from "./postgres-schema.ts";

export interface SeedFirstDraftPostgresDocumentResult {
  readonly documentId: string;
  readonly blockCount: number;
}

/** Inserts document data only; schema installation is deliberately separate. */
export async function seedFirstDraftPostgresDocument(input: {
  readonly client: FirstDraftPostgresSchemaClient;
  readonly documentId: string;
  readonly snapshot: EditorInstanceSnapshot;
  readonly now?: number;
}): Promise<SeedFirstDraftPostgresDocumentResult> {
  if (!isUuid(input.documentId)) {
    throw new TypeError("First Draft documentId must be a UUID");
  }
  await assertFirstDraftPostgresSchema(input.client);
  const sourceBlockIds = Object.keys(input.snapshot.blocks) as BlockId[];
  if (sourceBlockIds.length === 0) {
    throw new TypeError("First Draft seed snapshot must contain a block");
  }
  const databaseBlockIds = new Map(
    sourceBlockIds.map(
      (blockId, index) => [blockId, deterministicBlockId(index)] as const,
    ),
  );
  const orderKeys = generateNKeysBetween(null, null, sourceBlockIds.length);
  const now = input.now ?? Date.now();

  await input.client.query("BEGIN");
  try {
    await input.client.query(
      `INSERT INTO public.editor_documents(
         document_id, revision, created_at, updated_at
       ) VALUES($1, 0, $2, $2)`,
      [input.documentId, now],
    );
    for (const [index, sourceBlockId] of sourceBlockIds.entries()) {
      const block = input.snapshot.blocks[sourceBlockId];
      const blockId = databaseBlockIds.get(sourceBlockId);
      if (!block || !blockId) {
        throw new TypeError("First Draft seed snapshot graph is incomplete");
      }
      const parentBlockId =
        block.parentId === null
          ? null
          : (databaseBlockIds.get(block.parentId) ?? null);
      if (block.parentId !== null && parentBlockId === null) {
        throw new TypeError(
          `First Draft seed parent ${block.parentId} is missing`,
        );
      }
      const projection = input.snapshot.content[sourceBlockId] ?? null;
      const checkpoint =
        projection === null
          ? null
          : createYjsBlockContentCheckpoint(blockId, projection);
      await input.client.query(
        `INSERT INTO public.editor_blocks(
           document_id, block_id, block_type, parent_block_id, order_key,
           metadata_json, tombstone_json, read_projection_json,
           read_projection_version, content_checkpoint_base64, updated_at
         ) VALUES($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10)`,
        [
          input.documentId,
          blockId,
          block.type,
          parentBlockId,
          orderKeys[index],
          block.metadata === undefined ? null : JSON.stringify(block.metadata),
          projection === null ? null : JSON.stringify(projection),
          projection === null ? null : 1,
          checkpoint === null
            ? null
            : Buffer.from(checkpoint.payload.copy()).toString("base64"),
          now,
        ],
      );
    }
    await input.client.query("COMMIT");
    return { documentId: input.documentId, blockCount: sourceBlockIds.length };
  } catch (error) {
    await rollbackBestEffort(input.client);
    throw error;
  }
}

function deterministicBlockId(index: number): BlockId {
  return `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` as BlockId;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

async function rollbackBestEffort(
  client: FirstDraftPostgresSchemaClient,
): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the seed failure.
  }
}
