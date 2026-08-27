import {
  applyUpdate,
  createBlockContentDocContext,
  encodeStateAsUpdate,
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
  readCanonicalYjsBlockContent,
  YDoc,
} from "@repo/editor-yjs";
import {
  normalizeRichTextDocument,
  validateRichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import {
  boldMarkDefinition,
  codeMarkDefinition,
  italicMarkDefinition,
  linkMarkDefinition,
  strikethroughMarkDefinition,
  underlineMarkDefinition,
} from "@repo/editor-core/content/marks";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import { validateStructuralDocument } from "@repo/editor-core/editing";
import {
  type BlockId,
  type ContentVersion,
  type JsonObject,
  jsonValuesEqual,
} from "@repo/editor-core/kernel";
import { applyBlockMetadataUpdates } from "@repo/editor-core/metadata";
import { generateKeyBetween } from "fractional-indexing";
import type {
  EditorTransportBlockGraphChange,
  EditorTransportBlockPlacement,
  EditorTransportContentUpdate,
  EditorTransportTransaction,
} from "../transport/transport-types.ts";
import { firstDraftTransactionProposalsEqual } from "../transport/transaction-proposal-identity.ts";
import {
  firstDraftBlockModelDefinitions,
  firstDraftInlineAtomModels,
} from "./block-definitions.ts";
import {
  deserializeFirstDraftTransactionFromDatabase,
  readDatabaseBinary,
  serializeFirstDraftTransactionForDatabase,
} from "./persisted-transaction.ts";
import type {
  AcceptFirstDraftTransactionInput,
  AcceptFirstDraftTransactionResult,
} from "./persistence.ts";
import { validateFirstDraftTableStructure } from "../blocks/table/structural-validator.ts";

function compareOrderKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface FirstDraftPostgresQueryResult<
  Row extends Record<string, unknown>,
> {
  readonly rows: readonly Row[];
}

export interface FirstDraftPostgresTransactionClient {
  query<Row extends Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<FirstDraftPostgresQueryResult<Row>>;
}

interface DocumentRow extends Record<string, unknown> {
  readonly revision: unknown;
}

interface TransactionRow extends Record<string, unknown> {
  readonly transaction_id: unknown;
  readonly base_revision: unknown;
  readonly revision: unknown;
  readonly transaction_json: unknown;
  readonly accepted_at: unknown;
}

interface BlockRow extends Record<string, unknown> {
  readonly block_id: unknown;
  readonly block_type: unknown;
  readonly parent_block_id: unknown;
  readonly order_key: unknown;
  readonly metadata_json: unknown;
  readonly tombstone_json: unknown;
  readonly read_projection_json: unknown;
  readonly read_projection_version: unknown;
  readonly content_checkpoint_base64: unknown;
}

interface MutableBlock {
  readonly blockId: BlockId;
  blockType: BlockType;
  parentId: BlockId | null;
  orderKey: string;
  metadata: JsonObject;
  tombstone: JsonObject | null;
  readProjection: JsonObject | null;
  contentCheckpointBase64: string | null;
}

class FirstDraftSemanticError extends Error {}

export interface AcceptFirstDraftTransactionInPostgresOptions extends AcceptFirstDraftTransactionInput {
  readonly client: FirstDraftPostgresTransactionClient;
  readonly now?: number;
  readonly blockDefinitions?: Readonly<Record<BlockType, BlockDefinition>>;
  readonly onError?: (error: unknown) => void;
}

/** Assigns the next accepted revision and materializes state atomically. */
export async function acceptFirstDraftTransactionInPostgresTransaction(
  options: AcceptFirstDraftTransactionInPostgresOptions,
): Promise<AcceptFirstDraftTransactionResult> {
  const definitions =
    options.blockDefinitions ?? firstDraftBlockModelDefinitions;
  if (options.encodedTransaction.byteLength === 0) {
    return failure("invalid", "Encoded transaction frame is empty", false);
  }

  await options.client.query("BEGIN");
  let open = true;
  try {
    const documentResult = await options.client.query<DocumentRow>(
      `SELECT revision
       FROM public.editor_documents
       WHERE document_id = $1
       FOR UPDATE`,
      [options.documentId],
    );
    const document = documentResult.rows[0];
    if (!document) {
      await options.client.query("ROLLBACK");
      open = false;
      return failure("missing", "Editor document does not exist", false);
    }
    const existingResult = await options.client.query<TransactionRow>(
      `SELECT transaction_id, base_revision, revision, transaction_json, accepted_at
       FROM public.editor_transactions
       WHERE document_id = $1 AND transaction_id = $2`,
      [options.documentId, options.transaction.transactionId],
    );
    const existing = existingResult.rows[0];
    if (existing) {
      const persistedTransaction = deserializeFirstDraftTransactionFromDatabase(
        requiredString(existing.transaction_json, "transaction JSON"),
      );
      if (
        !persistedTransaction ||
        !firstDraftTransactionProposalsEqual(
          persistedTransaction,
          options.transaction,
        )
      ) {
        await options.client.query("ROLLBACK");
        open = false;
        return failure(
          "integrity",
          "Transaction identity was previously accepted with different content",
          false,
        );
      }
      const accepted = acceptedFromRow(options.documentId, existing);
      await options.client.query("COMMIT");
      open = false;
      return {
        ok: true,
        status: "existing",
        accepted,
        transaction: persistedTransaction,
      };
    }

    const currentRevision = requiredInteger(
      document.revision,
      "document revision",
    );
    const blockResult = await options.client.query<BlockRow>(
      `SELECT block_id, block_type, parent_block_id, order_key, metadata_json,
              tombstone_json, read_projection_json, read_projection_version,
              content_checkpoint_base64
       FROM public.editor_blocks
       WHERE document_id = $1
       ORDER BY order_key COLLATE "C", block_id
       FOR UPDATE`,
      [options.documentId],
    );
    const blocks = parseBlocks(blockResult.rows, definitions);
    const changedBlockIds = new Set<BlockId>();
    const now = options.now ?? Date.now();

    for (const change of options.transaction.graph?.changes ?? []) {
      applyGraphChange({
        change,
        blocks,
        definitions,
        changedBlockIds,
        now,
      });
    }
    if (options.transaction.metadata) {
      applyMetadataChanges({
        blocks,
        definitions,
        operation: options.transaction.metadata,
        changedBlockIds,
      });
    }
    const canonicalContent =
      options.transaction.content.length > 0
        ? await applyContentChanges({
            blocks,
            definitions,
            content: options.transaction.content,
            changedBlockIds,
          })
        : [];
    const acceptedTransaction: EditorTransportTransaction = Object.freeze({
      ...options.transaction,
      content: Object.freeze(canonicalContent),
    });
    const transactionJson =
      serializeFirstDraftTransactionForDatabase(acceptedTransaction);
    assertValidFirstDraftDocument(blocks, definitions);

    await persistChangedBlocks({
      client: options.client,
      documentId: options.documentId,
      blocks,
      changedBlockIds,
      now,
    });
    const revision = currentRevision + 1;
    await options.client.query(
      `INSERT INTO public.editor_transactions(
         document_id, transaction_id, base_revision, revision,
         transaction_json, accepted_at
       ) VALUES($1,$2,$3,$4,$5,$6)`,
      [
        options.documentId,
        options.transaction.transactionId,
        currentRevision,
        revision,
        transactionJson,
        now,
      ],
    );
    await options.client.query(
      `UPDATE public.editor_documents
       SET revision = $2, updated_at = $3
       WHERE document_id = $1`,
      [options.documentId, revision, now],
    );
    await options.client.query("COMMIT");
    open = false;
    return {
      ok: true,
      status: "accepted",
      accepted: {
        documentId: options.documentId,
        transactionId: options.transaction.transactionId,
        baseRevision: currentRevision,
        revision,
        acceptedAt: now,
      },
      transaction: acceptedTransaction,
    };
  } catch (error) {
    if (open) await rollbackBestEffort(options.client);
    if (!(error instanceof FirstDraftSemanticError)) options.onError?.(error);
    return error instanceof FirstDraftSemanticError
      ? failure("invalid", error.message, false)
      : failure(
          "unavailable",
          "First Draft transaction persistence is unavailable",
          true,
        );
  }
}

function applyGraphChange(input: {
  readonly change: EditorTransportBlockGraphChange;
  readonly blocks: Map<BlockId, MutableBlock>;
  readonly definitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly changedBlockIds: Set<BlockId>;
  readonly now: number;
}): void {
  const { change } = input;
  const current = input.blocks.get(change.blockId);
  if (change.kind === "create") {
    if (current) semantic(`Created block ${change.blockId} already exists`);
    if (!input.definitions[change.blockType]) {
      semantic(`Unknown First Draft block type ${change.blockType}`);
    }
    input.blocks.set(change.blockId, {
      blockId: change.blockId,
      blockType: change.blockType,
      parentId: change.placement.parentId,
      orderKey: resolveOrderKey(input.blocks, change.placement, change.blockId),
      metadata: change.initialMetadata ?? {},
      tombstone: null,
      readProjection: null,
      contentCheckpointBase64: null,
    });
    input.changedBlockIds.add(change.blockId);
    return;
  }
  if (!current) semantic(`Graph target ${change.blockId} does not exist`);
  if (change.kind === "delete") {
    if (current.tombstone)
      semantic(`Graph target ${change.blockId} is already deleted`);
    current.tombstone = { reason: "user-delete", deletedAt: input.now };
    current.contentCheckpointBase64 = null;
    current.readProjection = null;
  } else if (change.kind === "change-type") {
    if (current.tombstone)
      semantic("Cannot change the type of a deleted block");
    const definition = input.definitions[change.blockType];
    if (!definition)
      semantic(`Unknown First Draft block type ${change.blockType}`);
    current.blockType = change.blockType;
    if (definition.kind !== "text") {
      current.readProjection = null;
      current.contentCheckpointBase64 = null;
    }
  } else {
    if (change.kind === "move" && current.tombstone) {
      semantic("Cannot move a deleted block");
    }
    if (change.kind === "restore" && !current.tombstone) {
      semantic("Cannot restore a live block");
    }
    current.parentId = change.placement.parentId;
    current.orderKey = resolveOrderKey(
      input.blocks,
      change.placement,
      change.blockId,
    );
    current.tombstone = null;
  }
  input.changedBlockIds.add(change.blockId);
}

function applyMetadataChanges(input: {
  readonly blocks: Map<BlockId, MutableBlock>;
  readonly definitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly operation: NonNullable<EditorTransportTransaction["metadata"]>;
  readonly changedBlockIds: Set<BlockId>;
}): void {
  const versioned = toVersionedBlocks(input.blocks);
  const applied = applyBlockMetadataUpdates({
    operation: input.operation,
    blocks: versioned,
    blockDefinitions: input.definitions,
    getDirectChildIds: (parentId) =>
      sortedLiveChildren(input.blocks, parentId).map((block) => block.blockId),
  });
  if (!applied.ok) semantic(applied.errors.join("; "));
  for (const blockId of applied.affectedBlockIds) {
    input.blocks.get(blockId)!.metadata =
      applied.blocks[blockId]?.metadata ?? {};
    input.changedBlockIds.add(blockId);
  }
}

async function applyContentChanges(input: {
  readonly blocks: Map<BlockId, MutableBlock>;
  readonly definitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly content: readonly EditorTransportContentUpdate[];
  readonly changedBlockIds: Set<BlockId>;
}): Promise<readonly EditorTransportContentUpdate[]> {
  const accepted: EditorTransportContentUpdate[] = [];
  for (const update of input.content) {
    const block = input.blocks.get(update.blockId);
    if (
      !block ||
      block.tombstone ||
      block.blockType !== update.blockType ||
      input.definitions[block.blockType]?.kind !== "text"
    ) {
      semantic(`Content target ${update.blockId} is unavailable`);
    }
    if (
      update.update.format !== EDITOR_YJS_CONTENT_FORMAT ||
      update.update.version !== EDITOR_YJS_CONTENT_FORMAT_VERSION ||
      update.update.payload.byteLength === 0
    ) {
      semantic(`Content update for ${update.blockId} is unsupported`);
    }
    const document = new YDoc();
    try {
      const current = block.contentCheckpointBase64
        ? readDatabaseBinary(block.contentCheckpointBase64)
        : null;
      if (block.contentCheckpointBase64 && !current) {
        throw new Error("Persisted block content checkpoint is corrupt");
      }
      if (current) applyUpdate(document, current.copy(), "first-draft-current");
      applyUpdate(
        document,
        update.update.payload.copy(),
        "first-draft-accepted",
      );
      const context = createBlockContentDocContext({
        blockId: update.blockId,
        doc: document,
        destroyDocOnDestroy: false,
      });
      let projection: ReturnType<typeof readCanonicalYjsBlockContent>;
      try {
        projection = readCanonicalYjsBlockContent(context);
      } finally {
        context.destroy();
      }
      const richTextOptions = {
        inlineMarks: [
          boldMarkDefinition,
          italicMarkDefinition,
          codeMarkDefinition,
          linkMarkDefinition,
          strikethroughMarkDefinition,
          underlineMarkDefinition,
        ],
        inlineAtoms: firstDraftInlineAtomModels,
      };
      if (
        !projection ||
        !validateRichTextDocumentNodeJson(
          projection,
          `content for ${update.blockId}`,
          richTextOptions,
        ).valid
      ) {
        semantic(`Yjs content for ${update.blockId} is invalid`);
      }
      const canonical = normalizeRichTextDocument(
        update.blockType,
        projection,
        richTextOptions,
      );
      if (!jsonValuesEqual(projection, canonical)) {
        semantic(`Yjs content for ${update.blockId} is not canonical`);
      }
      block.readProjection = canonical as JsonObject;
      block.contentCheckpointBase64 = Buffer.from(
        encodeStateAsUpdate(document),
      ).toString("base64");
      input.changedBlockIds.add(update.blockId);
      accepted.push(
        Object.freeze({
          ...update,
          readProjection: canonical,
        }),
      );
    } catch (error) {
      if (error instanceof FirstDraftSemanticError) throw error;
      semantic(`Yjs update for ${update.blockId} is invalid`);
    } finally {
      document.destroy();
    }
  }
  return Object.freeze(accepted);
}

function assertValidFirstDraftDocument(
  blocks: ReadonlyMap<BlockId, MutableBlock>,
  definitions: Readonly<Record<BlockType, BlockDefinition>>,
): void {
  for (const block of blocks.values()) {
    const ownsTextContent =
      !block.tombstone && definitions[block.blockType]?.kind === "text";
    if (ownsTextContent) {
      if (!block.readProjection || !block.contentCheckpointBase64) {
        semantic(
          `Text block ${block.blockId} requires projection and checkpoint`,
        );
      }
    } else if (block.readProjection || block.contentCheckpointBase64) {
      semantic(`Contentless block ${block.blockId} cannot own text content`);
    }
  }
  const roots = sortedLiveChildren(blocks, null).map((block) => block.blockId);
  const children: Partial<Record<BlockId, readonly BlockId[]>> = {};
  for (const block of blocks.values()) {
    if (!block.tombstone) {
      children[block.blockId] = sortedLiveChildren(blocks, block.blockId).map(
        (child) => child.blockId,
      );
    }
  }
  const validation = validateStructuralDocument({
    blocks: toVersionedBlocks(blocks),
    rootBlockIds: roots,
    childIdsByParentId: children,
    blockDefinitions: definitions,
    readContent: (blockId) => {
      const block = blocks.get(blockId);
      if (!block?.readProjection || block.tombstone) return null;
      return {
        content: block.readProjection as never,
        plainText: "",
        version: null,
      };
    },
    validateContent: (_blockType, content) =>
      validateRichTextDocumentNodeJson(content).valid,
    validators: [validateFirstDraftTableStructure],
  });
  if (!validation.valid) {
    semantic(validation.issues.map((issue) => issue.message).join("; "));
  }
}

async function persistChangedBlocks(input: {
  readonly client: FirstDraftPostgresTransactionClient;
  readonly documentId: string;
  readonly blocks: ReadonlyMap<BlockId, MutableBlock>;
  readonly changedBlockIds: ReadonlySet<BlockId>;
  readonly now: number;
}): Promise<void> {
  const changed = [...input.changedBlockIds]
    .map((blockId) => input.blocks.get(blockId)!)
    .sort(
      (left, right) =>
        Number(Boolean(right.tombstone)) - Number(Boolean(left.tombstone)),
    );
  for (const block of changed) {
    await input.client.query(
      `INSERT INTO public.editor_blocks(
         document_id, block_id, block_type, parent_block_id, order_key,
         metadata_json, tombstone_json, read_projection_json,
         read_projection_version, content_checkpoint_base64, updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(document_id, block_id) DO UPDATE SET
         block_type = EXCLUDED.block_type,
         parent_block_id = EXCLUDED.parent_block_id,
         order_key = EXCLUDED.order_key,
         metadata_json = EXCLUDED.metadata_json,
         tombstone_json = EXCLUDED.tombstone_json,
         read_projection_json = EXCLUDED.read_projection_json,
         read_projection_version = EXCLUDED.read_projection_version,
         content_checkpoint_base64 = EXCLUDED.content_checkpoint_base64,
         updated_at = EXCLUDED.updated_at`,
      [
        input.documentId,
        block.blockId,
        block.blockType,
        block.parentId,
        block.orderKey,
        jsonOrNull(block.metadata),
        jsonOrNull(block.tombstone),
        jsonOrNull(block.readProjection),
        block.readProjection ? 1 : null,
        block.contentCheckpointBase64,
        input.now,
      ],
    );
  }
}

function resolveOrderKey(
  blocks: ReadonlyMap<BlockId, MutableBlock>,
  placement: EditorTransportBlockPlacement,
  movingBlockId: BlockId,
): string {
  if (placement.parentId !== null) {
    const parent = blocks.get(placement.parentId);
    if (!parent || parent.tombstone)
      semantic("Graph placement parent is unavailable");
    if (
      placement.parentId === movingBlockId ||
      isDescendant(blocks, placement.parentId, movingBlockId)
    ) {
      semantic("Graph placement creates a cycle");
    }
  }
  const siblings = [...blocks.values()]
    .filter(
      (block) =>
        !block.tombstone &&
        block.parentId === placement.parentId &&
        block.blockId !== movingBlockId,
    )
    .sort((left, right) => compareOrderKeys(left.orderKey, right.orderKey));
  const previousIndex =
    placement.previousSiblingId === null
      ? -1
      : siblings.findIndex(
          (block) => block.blockId === placement.previousSiblingId,
        );
  const nextIndex =
    placement.nextSiblingId === null
      ? siblings.length
      : siblings.findIndex(
          (block) => block.blockId === placement.nextSiblingId,
        );
  if (placement.previousSiblingId !== null && previousIndex < 0) {
    semantic("Previous sibling anchor is unavailable");
  }
  if (placement.nextSiblingId !== null && nextIndex < 0) {
    semantic("Next sibling anchor is unavailable");
  }
  if (previousIndex + 1 !== nextIndex) {
    semantic("Sibling anchors are not adjacent");
  }
  return generateKeyBetween(
    siblings[previousIndex]?.orderKey ?? null,
    siblings[nextIndex]?.orderKey ?? null,
  );
}

function isDescendant(
  blocks: ReadonlyMap<BlockId, MutableBlock>,
  candidateId: BlockId,
  ancestorId: BlockId,
): boolean {
  let cursor: BlockId | null = candidateId;
  const visited = new Set<BlockId>();
  while (cursor !== null) {
    if (cursor === ancestorId) return true;
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = blocks.get(cursor)?.parentId ?? null;
  }
  return false;
}

function parseBlocks(
  rows: readonly BlockRow[],
  definitions: Readonly<Record<BlockType, BlockDefinition>>,
): Map<BlockId, MutableBlock> {
  const blocks = new Map<BlockId, MutableBlock>();
  for (const row of rows) {
    const blockId = requiredString(row.block_id, "block ID") as BlockId;
    const blockType = requiredString(row.block_type, "block type") as BlockType;
    if (!definitions[blockType]) {
      throw new Error(`Persisted block ${blockId} has an unknown type`);
    }
    const projectionVersion = nullableInteger(row.read_projection_version);
    if (projectionVersion !== null && projectionVersion !== 1) {
      throw new Error("Persisted read projection version is unsupported");
    }
    blocks.set(blockId, {
      blockId,
      blockType,
      parentId: nullableString(row.parent_block_id) as BlockId | null,
      orderKey: requiredString(row.order_key, "block order key"),
      metadata: parseObject(row.metadata_json) ?? {},
      tombstone: parseObject(row.tombstone_json),
      readProjection: parseObject(row.read_projection_json),
      contentCheckpointBase64:
        row.content_checkpoint_base64 === null
          ? null
          : requiredString(row.content_checkpoint_base64, "content checkpoint"),
    });
  }
  return blocks;
}

function toVersionedBlocks(
  blocks: ReadonlyMap<BlockId, MutableBlock>,
): Readonly<Record<BlockId, VersionedBlock>> {
  return Object.freeze(
    Object.fromEntries(
      [...blocks].map(([blockId, block]) => [
        blockId,
        {
          id: block.blockId,
          type: block.blockType,
          parentId: block.parentId,
          tombstone: block.tombstone as VersionedBlock["tombstone"],
          ...(Object.keys(block.metadata).length > 0
            ? { metadata: block.metadata }
            : {}),
          metadataVersion: "1",
          contentVersion: block.readProjection ? ("1" as ContentVersion) : null,
        } satisfies VersionedBlock,
      ]),
    ) as Record<BlockId, VersionedBlock>,
  );
}

function sortedLiveChildren(
  blocks: ReadonlyMap<BlockId, MutableBlock>,
  parentId: BlockId | null,
): readonly MutableBlock[] {
  return [...blocks.values()]
    .filter((block) => !block.tombstone && block.parentId === parentId)
    .sort((left, right) => compareOrderKeys(left.orderKey, right.orderKey));
}

function acceptedFromRow(
  documentId: string,
  row: TransactionRow,
): Extract<
  AcceptFirstDraftTransactionResult,
  { readonly ok: true }
>["accepted"] {
  return {
    documentId,
    transactionId: requiredString(row.transaction_id, "transaction identity"),
    baseRevision: requiredInteger(row.base_revision, "accepted base revision"),
    revision: requiredInteger(row.revision, "accepted revision"),
    acceptedAt: requiredInteger(row.accepted_at, "acceptance time"),
  };
}

function parseObject(value: unknown): JsonObject | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Persisted JSON is corrupt");
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Persisted JSON object is corrupt");
  }
  return parsed as JsonObject;
}

function jsonOrNull(value: JsonObject | null): string | null {
  return value && Object.keys(value).length > 0 ? JSON.stringify(value) : null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Persisted ${label} is invalid`);
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value, "nullable string");
}

function requiredInteger(value: unknown, label: string): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (Number.isSafeInteger(number) && (number as number) >= 0) {
    return number as number;
  }
  throw new Error(`Persisted ${label} is invalid`);
}

function nullableInteger(value: unknown): number | null {
  return value === null ? null : requiredInteger(value, "integer");
}

function semantic(message: string): never {
  throw new FirstDraftSemanticError(message);
}

function failure(
  reason: Extract<
    AcceptFirstDraftTransactionResult,
    { readonly ok: false }
  >["reason"],
  message: string,
  retryable: boolean,
): Extract<AcceptFirstDraftTransactionResult, { readonly ok: false }> {
  return { ok: false, reason, message, retryable };
}

async function rollbackBestEffort(
  client: FirstDraftPostgresTransactionClient,
): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The original persistence failure remains authoritative.
  }
}
