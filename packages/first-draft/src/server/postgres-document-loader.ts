import type { EditorTextBlockContent } from "@repo/editor-core/codecs";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockId, JsonObject } from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import {
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
} from "@repo/editor-yjs/checkpoint-format";
import { firstDraftBlockModelDefinitions } from "./block-definitions.ts";
import type { FirstDraftPostgresTransactionClient } from "./postgres-acceptance.ts";
import { validateFirstDraftBootstrap } from "../bootstrap/bootstrap.ts";
import { deserializeFirstDraftTransactionFromDatabase } from "./persisted-transaction.ts";
import type {
  FirstDraftAcceptedTransaction,
  LoadFirstDraftAcceptedTransactionsResult,
  LoadFirstDraftBootstrapResult,
} from "./persistence.ts";

interface DocumentRow extends Record<string, unknown> {
  readonly revision: unknown;
}

interface BlockRow extends Record<string, unknown> {
  readonly block_id: unknown;
  readonly block_type: unknown;
  readonly parent_block_id: unknown;
  readonly order_key: unknown;
  readonly metadata_json: unknown;
  readonly read_projection_json: unknown;
  readonly read_projection_version: unknown;
  readonly content_checkpoint_base64: unknown;
}

export interface LoadFirstDraftDocumentFromPostgresOptions {
  readonly client: FirstDraftPostgresTransactionClient;
  readonly documentId: string;
  readonly onError?: (error: unknown) => void;
}

class InvalidPersistedFirstDraftDocument extends Error {}

/** Loads one authoritative editor snapshot scoped only by document identity. */
export async function loadFirstDraftDocumentFromPostgres(
  options: LoadFirstDraftDocumentFromPostgresOptions,
): Promise<LoadFirstDraftBootstrapResult> {
  let open = false;
  try {
    await options.client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    open = true;
    const documentResult = await options.client.query<DocumentRow>(
      `SELECT revision
       FROM public.editor_documents
       WHERE document_id = $1`,
      [options.documentId],
    );
    const document = documentResult.rows[0];
    if (!document) {
      await options.client.query("ROLLBACK");
      open = false;
      return {
        ok: false,
        reason: "missing",
        message: "Editor document does not exist",
      };
    }
    const revision = requiredInteger(document.revision, "document revision");
    const blocksResult = await options.client.query<BlockRow>(
      `SELECT block_id, block_type, parent_block_id, order_key,
              metadata_json, read_projection_json, read_projection_version,
              content_checkpoint_base64
       FROM public.editor_blocks
       WHERE document_id = $1 AND tombstone_json IS NULL
       ORDER BY order_key COLLATE "C", block_id`,
      [options.documentId],
    );
    const blocks = materializeBootstrapBlocks(blocksResult.rows);
    const bootstrap = validateFirstDraftBootstrap({
      documentId: options.documentId,
      revision,
      blockGraphVersion: 1,
      blocks,
    });
    await options.client.query("COMMIT");
    open = false;
    return {
      ok: true,
      bootstrap,
    };
  } catch (error) {
    if (open) await rollbackBestEffort(options.client);
    if (error instanceof InvalidPersistedFirstDraftDocument) {
      return { ok: false, reason: "invalid", message: error.message };
    }
    options.onError?.(error);
    return {
      ok: false,
      reason: "unavailable",
      message: "First Draft document loading is unavailable",
    };
  }
}

interface AcceptedTransactionRow extends Record<string, unknown> {
  readonly transaction_id: unknown;
  readonly base_revision: unknown;
  readonly revision: unknown;
  readonly transaction_json: unknown;
  readonly accepted_at: unknown;
}

export interface LoadFirstDraftAcceptedTransactionsFromPostgresOptions {
  readonly client: FirstDraftPostgresTransactionClient;
  readonly documentId: string;
  readonly revision: number;
  readonly onError?: (error: unknown) => void;
}

/** Reads one exact contiguous accepted-transaction suffix at a repeatable head. */
export async function loadFirstDraftAcceptedTransactionsFromPostgres(
  options: LoadFirstDraftAcceptedTransactionsFromPostgresOptions,
): Promise<LoadFirstDraftAcceptedTransactionsResult> {
  let open = false;
  try {
    if (!Number.isSafeInteger(options.revision) || options.revision < 0) {
      return {
        ok: false,
        reason: "invalid",
        message: "Requested First Draft revision is invalid",
      };
    }
    await options.client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    open = true;
    const documentResult = await options.client.query<DocumentRow>(
      `SELECT revision FROM public.editor_documents WHERE document_id = $1`,
      [options.documentId],
    );
    const document = documentResult.rows[0];
    if (!document) {
      await options.client.query("ROLLBACK");
      open = false;
      return {
        ok: false,
        reason: "missing",
        message: "Editor document does not exist",
      };
    }
    const currentRevision = requiredInteger(
      document.revision,
      "document revision",
    );
    if (options.revision > currentRevision) {
      await options.client.query("ROLLBACK");
      open = false;
      return {
        ok: false,
        reason: "revision-unavailable",
        resynchronizationReason: "revision-ahead",
        message: `Requested revision ${options.revision} is ahead of head ${currentRevision}`,
      };
    }
    const result = await options.client.query<AcceptedTransactionRow>(
      `SELECT transaction_id, base_revision, revision, transaction_json, accepted_at
       FROM public.editor_transactions
       WHERE document_id = $1 AND revision > $2
       ORDER BY revision`,
      [options.documentId, options.revision],
    );
    const transactions: FirstDraftAcceptedTransaction[] = [];
    let expectedBase = options.revision;
    const transactionIds = new Set<string>();
    for (const row of result.rows) {
      const transactionId = requiredString(
        row.transaction_id,
        "transaction identity",
      );
      const baseRevision = requiredInteger(
        row.base_revision,
        "transaction base revision",
      );
      const revision = requiredInteger(row.revision, "transaction revision");
      const acceptedAt = requiredInteger(
        row.accepted_at,
        "transaction acceptance time",
      );
      const serialized = requiredString(
        row.transaction_json,
        "transaction JSON",
      );
      const transaction =
        deserializeFirstDraftTransactionFromDatabase(serialized);
      if (
        !transaction ||
        transaction.transactionId !== transactionId ||
        transactionIds.has(transactionId) ||
        baseRevision !== expectedBase ||
        revision !== baseRevision + 1
      ) {
        invalid(
          "Persisted accepted transaction sequence is not contiguous and unique",
        );
      }
      transactionIds.add(transactionId);
      transactions.push({
        transactionId,
        baseRevision,
        revision,
        acceptedAt,
        transaction,
      });
      expectedBase = revision;
    }
    if (expectedBase !== currentRevision) {
      await options.client.query("ROLLBACK");
      open = false;
      return {
        ok: false,
        reason: "revision-unavailable",
        resynchronizationReason: "invalid-history",
        message: `Accepted transaction log cannot satisfy revision ${options.revision} through ${currentRevision}`,
      };
    }
    await options.client.query("COMMIT");
    open = false;
    return {
      ok: true,
      requestedRevision: options.revision,
      currentRevision,
      transactions,
    };
  } catch (error) {
    if (open) await rollbackBestEffort(options.client);
    if (error instanceof InvalidPersistedFirstDraftDocument) {
      return { ok: false, reason: "invalid", message: error.message };
    }
    options.onError?.(error);
    return {
      ok: false,
      reason: "unavailable",
      message: "First Draft transaction replay is unavailable",
    };
  }
}

function materializeBootstrapBlocks(
  rows: readonly BlockRow[],
): import("../bootstrap/bootstrap.ts").FirstDraftBootstrapBlock[] {
  const entries: import("../bootstrap/bootstrap.ts").FirstDraftBootstrapBlock[] =
    [];
  for (const row of rows) {
    const blockId = requiredString(row.block_id, "block identity") as BlockId;
    const blockType = requiredString(row.block_type, "block type") as BlockType;
    const definition = (
      firstDraftBlockModelDefinitions as Readonly<
        Record<BlockType, BlockDefinition>
      >
    )[blockType];
    if (!definition) invalid(`Persisted block ${blockId} has an unknown type`);
    const parentId = nullableString(row.parent_block_id) as BlockId | null;
    requiredString(row.order_key, "block order key");
    const metadata = nullableJsonObject(row.metadata_json, "block metadata");
    const projection = nullableJsonObject(
      row.read_projection_json,
      "block read projection",
    );
    const projectionVersion = nullableInteger(row.read_projection_version);
    if ((projection === null) !== (projectionVersion === null)) {
      invalid(`Persisted block ${blockId} has incomplete read projection data`);
    }
    if (projectionVersion !== null && projectionVersion !== 1) {
      invalid(
        `Persisted block ${blockId} has an unsupported projection version`,
      );
    }
    if (definition.kind === "text") {
      if (projection === null) {
        invalid(`Persisted text block ${blockId} has no read projection`);
      }
      const checkpoint = requiredString(
        row.content_checkpoint_base64,
        "block content checkpoint",
      );
      entries.push({
        block: createBlockRecord({
          id: blockId,
          type: blockType,
          parentId,
          ...(metadata ? { metadata } : {}),
        }),
        readProjection: projection as EditorTextBlockContent,
        checkpoint: {
          kind: "checkpoint" as const,
          format: EDITOR_YJS_CONTENT_FORMAT,
          version: EDITOR_YJS_CONTENT_FORMAT_VERSION,
          payloadBase64: checkpoint,
        },
      });
    } else if (projection !== null) {
      invalid(`Persisted non-text block ${blockId} owns text content`);
    } else {
      if (row.content_checkpoint_base64 !== null) {
        invalid(`Persisted non-text block ${blockId} owns a checkpoint`);
      }
      entries.push({
        block: createBlockRecord({
          id: blockId,
          type: blockType,
          parentId,
          ...(metadata ? { metadata } : {}),
        }),
      });
    }
  }
  return entries;
}

function nullableJsonObject(value: unknown, label: string): JsonObject | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid(`Persisted ${label} is invalid`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalid(`Persisted ${label} is invalid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    invalid(`Persisted ${label} is not an object`);
  }
  return parsed as JsonObject;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  return invalid(`Persisted ${label} is invalid`);
}

function nullableString(value: unknown): string | null {
  return value === null ? null : requiredString(value, "nullable identity");
}

function requiredInteger(value: unknown, label: string): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (Number.isSafeInteger(number) && Number(number) >= 0)
    return Number(number);
  return invalid(`Persisted ${label} is invalid`);
}

function nullableInteger(value: unknown): number | null {
  return value === null ? null : requiredInteger(value, "integer");
}

function invalid(message: string): never {
  throw new InvalidPersistedFirstDraftDocument(message);
}

async function rollbackBestEffort(
  client: FirstDraftPostgresTransactionClient,
): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original load failure.
  }
}
