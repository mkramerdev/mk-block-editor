import {
  EditorImmutableBinary,
  extractPlainTextFromRichTextDocument,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import { asBlockId } from "@repo/editor-core/kernel";
import {
  applyUpdate,
  createBlockContentDocContext,
  encodeStateAsUpdate,
  encodeStateVector,
  readCanonicalYjsBlockContent,
  writeCanonicalYjsBlockContent,
  YDoc,
} from "@repo/editor-yjs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeTestEditableEditor as initializeEditableEditor } from "../test-editor.ts";
import { createFirstDraftViewStateStore } from "../blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import { firstDraftBootstrapSnapshot } from "../read-model/bootstrap.ts";
import type { EditorTransportTransaction } from "../transport/transport-types.ts";
import { handleTransaction } from "../transport/handle-transaction.ts";
import {
  decodeFirstDraftMessage,
  encodeFirstDraftMessage,
} from "../transport/message-protocol.ts";
import { createFirstDraftPostgresPersistence } from "./postgres-persistence.ts";
import { recreateFirstDraftPostgresDatabase } from "./postgres-reset.ts";
import { assertFirstDraftPostgresSchema } from "./postgres-schema.ts";
import { seedFirstDraftPostgresDocument } from "./postgres-seed.ts";

const configuredPostgresUrl = Reflect.get(
  process.env,
  "EDITOR_DOCUMENT_POSTGRES_URL",
) as string | undefined;
const postgresUrl = configuredPostgresUrl?.trim()
  ? testDatabaseUrl(configuredPostgresUrl)
  : null;
const documentA = "01890f07-1c00-7000-8000-000000020001";
const documentB = "01890f07-1c00-7000-8000-000000020002";
const blockA = asBlockId("30000000-0000-4000-8000-000000000001");
const blockB = asBlockId("30000000-0000-4000-8000-000000000002");

describe.skipIf(postgresUrl === null)(
  "First Draft acceptance against a fresh canonical PostgreSQL database",
  () => {
    let pool: Pool;
    let persistence: ReturnType<typeof createFirstDraftPostgresPersistence>;

    beforeAll(async () => {
      await recreateFirstDraftPostgresDatabase(postgresUrl!);
      pool = new Pool({ connectionString: postgresUrl! });
      persistence = createFirstDraftPostgresPersistence({
        connectionString: postgresUrl!,
      });
      const tables = await pool.query<{
        schemaname: string;
        tablename: string;
      }>(
        `SELECT schemaname, tablename FROM pg_catalog.pg_tables
         WHERE tablename LIKE 'editor_%'
         ORDER BY schemaname, tablename`,
      );
      expect(tables.rows).toEqual([
        { schemaname: "public", tablename: "editor_blocks" },
        { schemaname: "public", tablename: "editor_documents" },
        { schemaname: "public", tablename: "editor_transactions" },
      ]);
    });

    beforeEach(async () => {
      await pool.query(
        "DELETE FROM public.editor_documents WHERE document_id = ANY($1::uuid[])",
        [[documentA, documentB]],
      );
    });

    afterAll(async () => {
      await pool.query(
        "DELETE FROM public.editor_documents WHERE document_id = ANY($1::uuid[])",
        [[documentA, documentB]],
      );
      await persistence.close();
      await pool.end();
    });

    it("assigns the locked document head and atomically stores metadata", async () => {
      await seedAtomicDocument(pool, documentA, 5);
      const transaction = metadataTransaction(
        "40000000-0000-4000-8000-000000000001",
        blockA,
        { owner: "Ada" },
        90,
        91,
      );

      const result = await accept(persistence, documentA, transaction);

      expect(result).toMatchObject({
        ok: true,
        status: "accepted",
        accepted: { baseRevision: 5, revision: 6 },
      });
      const document = await pool.query(
        "SELECT revision FROM public.editor_documents WHERE document_id = $1",
        [documentA],
      );
      const accepted = await pool.query(
        `SELECT base_revision, revision, transaction_json
         FROM public.editor_transactions WHERE document_id = $1`,
        [documentA],
      );
      const block = await pool.query(
        "SELECT metadata_json FROM public.editor_blocks WHERE document_id = $1 AND block_id = $2",
        [documentA, blockA],
      );
      expect(document.rows[0]?.revision).toBe(6);
      expect(accepted.rows[0]).toMatchObject({
        base_revision: 5,
        revision: 6,
      });
      expect(accepted.rows[0]?.transaction_json).not.toContain(
        '"baseRevision"',
      );
      expect(JSON.parse(block.rows[0]?.metadata_json as string)).toEqual({
        owner: "Ada",
      });
    });

    it("returns missing without writing", async () => {
      await seedAtomicDocument(pool, documentA, 4);
      const transaction = metadataTransaction(
        "40000000-0000-4000-8000-000000000002",
        blockA,
        { rejected: true },
      );
      const encodedTransaction = new Uint8Array(
        encodeFirstDraftMessage({
          type: "proposed-editor-transaction",
          transaction,
        }),
      );
      await expect(
        persistence.accept({
          documentId: "01890f07-1c00-7000-8000-000000020099",
          transaction,
          encodedTransaction,
        }),
      ).resolves.toMatchObject({ ok: false, reason: "missing" });
      const state = await pool.query(
        `SELECT d.revision, count(t.transaction_id)::int AS transactions
         FROM public.editor_documents d
         LEFT JOIN public.editor_transactions t USING(document_id)
         WHERE d.document_id = $1 GROUP BY d.revision`,
        [documentA],
      );
      expect(state.rows[0]).toEqual({ revision: 4, transactions: 0 });
    });

    it("serializes concurrent transactions through PostgreSQL with contiguous revisions", async () => {
      await seedAtomicDocument(pool, documentA, 10);
      const first = metadataTransaction(
        "40000000-0000-4000-8000-000000000010",
        blockA,
        { first: true },
      );
      const second = metadataTransaction(
        "40000000-0000-4000-8000-000000000011",
        blockA,
        { second: true },
      );

      const results = await Promise.all([
        accept(persistence, documentA, first),
        accept(persistence, documentA, second),
      ]);

      expect(
        results
          .flatMap((result) => (result.ok ? [result.accepted.revision] : []))
          .sort(),
      ).toEqual([11, 12]);
      const rows = await pool.query(
        `SELECT base_revision, revision FROM public.editor_transactions
         WHERE document_id = $1 ORDER BY revision`,
        [documentA],
      );
      expect(rows.rows).toEqual([
        { base_revision: 10, revision: 11 },
        { base_revision: 11, revision: 12 },
      ]);
    });

    it("does not serialize persistence for different document rows", async () => {
      await Promise.all([
        seedAtomicDocument(pool, documentA, 0),
        seedAtomicDocument(pool, documentB, 0),
      ]);
      const lock = await pool.connect();
      await lock.query("BEGIN");
      await lock.query(
        "SELECT revision FROM public.editor_documents WHERE document_id = $1 FOR UPDATE",
        [documentA],
      );
      const blocked = accept(
        persistence,
        documentA,
        metadataTransaction("40000000-0000-4000-8000-000000000012", blockA, {
          documentA: true,
        }),
      );
      const independent = accept(
        persistence,
        documentB,
        metadataTransaction("40000000-0000-4000-8000-000000000013", blockA, {
          documentB: true,
        }),
      );
      try {
        await expect(
          Promise.race([
            independent,
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("independent document was blocked")),
                1_000,
              ),
            ),
          ]),
        ).resolves.toMatchObject({ ok: true });
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
      }
      await expect(blocked).resolves.toMatchObject({ ok: true });
    });

    it("provides durable sequential and concurrent idempotency scoped by document", async () => {
      await Promise.all([
        seedAtomicDocument(pool, documentA, 2),
        seedAtomicDocument(pool, documentB, 20),
      ]);
      const transaction = metadataTransaction(
        "40000000-0000-4000-8000-000000000020",
        blockA,
        { idempotent: true },
      );
      const concurrent = await Promise.all([
        accept(persistence, documentA, transaction),
        accept(persistence, documentA, transaction),
      ]);
      expect(concurrent.every((result) => result.ok)).toBe(true);
      expect(
        concurrent.map((result) => result.ok && result.accepted.revision),
      ).toEqual([3, 3]);
      expect(await accept(persistence, documentA, transaction)).toMatchObject({
        ok: true,
        status: "existing",
        accepted: { baseRevision: 2, revision: 3 },
      });
      expect(await accept(persistence, documentB, transaction)).toMatchObject({
        ok: true,
        status: "accepted",
        accepted: { baseRevision: 20, revision: 21 },
      });
      const count = await pool.query(
        "SELECT count(*)::int AS count FROM public.editor_transactions WHERE transaction_id = $1",
        [transaction.transactionId],
      );
      expect(count.rows[0]?.count).toBe(2);

      const divergent = metadataTransaction(transaction.transactionId, blockA, {
        idempotent: false,
      });
      expect(await accept(persistence, documentA, divergent)).toMatchObject({
        ok: false,
        reason: "integrity",
      });
      const head = await pool.query(
        "SELECT revision FROM public.editor_documents WHERE document_id = $1",
        [documentA],
      );
      expect(head.rows[0]?.revision).toBe(3);
    });

    it("accepts command, undo, and redo as independent contiguous transactions", async () => {
      await seedAtomicDocument(pool, documentA, 0);
      const command = metadataTransaction(
        "40000000-0000-4000-8000-000000000021",
        blockA,
        { checked: true },
      );
      const undo: EditorTransportTransaction = {
        ...command,
        transactionId: "40000000-0000-4000-8000-000000000022",
        historyAction: "undo",
        metadata: {
          kind: "updateBlockMetadata",
          updates: [],
          deletions: [{ blockId: blockA, fields: ["checked"] }],
        },
      };
      const redo: EditorTransportTransaction = {
        ...command,
        transactionId: "40000000-0000-4000-8000-000000000023",
        historyAction: "redo",
      };

      await expect(
        accept(persistence, documentA, command),
      ).resolves.toMatchObject({
        ok: true,
        accepted: { revision: 1 },
      });
      await expect(accept(persistence, documentA, undo)).resolves.toMatchObject(
        {
          ok: true,
          accepted: { revision: 2 },
        },
      );
      await expect(accept(persistence, documentA, redo)).resolves.toMatchObject(
        {
          ok: true,
          accepted: { revision: 3 },
        },
      );
      const history = await pool.query<{
        revision: number;
        transaction_json: string;
      }>(
        `SELECT revision, transaction_json FROM public.editor_transactions
         WHERE document_id = $1 ORDER BY revision`,
        [documentA],
      );
      expect(history.rows.map(({ revision }) => revision)).toEqual([1, 2, 3]);
      expect(
        history.rows.map(
          ({ transaction_json }) => JSON.parse(transaction_json).historyAction,
        ),
      ).toEqual(["command", "undo", "redo"]);
    });

    it("rolls back a partially invalid metadata transaction without advancing the head", async () => {
      await seedAtomicDocument(pool, documentA, 30);
      const transaction: EditorTransportTransaction = {
        ...metadataTransaction("40000000-0000-4000-8000-000000000030", blockA, {
          validBeforeFailure: true,
        }),
        metadata: {
          kind: "updateBlockMetadata",
          updates: [
            { blockId: blockA, values: { validBeforeFailure: true } },
            {
              blockId: asBlockId("30000000-0000-4000-8000-000000000099"),
              values: { invalid: true },
            },
          ],
        },
      };

      expect(await accept(persistence, documentA, transaction)).toMatchObject({
        ok: false,
        reason: "invalid",
      });
      const state = await pool.query(
        `SELECT d.revision, b.metadata_json
         FROM public.editor_documents d JOIN public.editor_blocks b USING(document_id)
         WHERE d.document_id = $1 AND b.block_id = $2`,
        [documentA, blockA],
      );
      expect(state.rows[0]).toEqual({ revision: 30, metadata_json: null });
      const count = await pool.query(
        "SELECT count(*)::int AS count FROM public.editor_transactions WHERE document_id = $1",
        [documentA],
      );
      expect(count.rows[0]?.count).toBe(0);
    });

    it("rejects a transaction that would leave table rows unequal", async () => {
      await seedFirstDraftPostgresDocument({
        client: pool,
        documentId: documentA,
        snapshot: createFirstDraftSnapshot(),
      });
      const cellId = asBlockId("fd-table-cell-2-2");
      const transaction = graphTransaction(
        "40000000-0000-4000-8000-000000000041",
        { kind: "delete", blockId: cellId },
      );

      expect(await accept(persistence, documentA, transaction)).toMatchObject({
        ok: false,
        reason: "invalid",
      });
      const [document, cells] = await Promise.all([
        pool.query(
          "SELECT revision FROM public.editor_documents WHERE document_id = $1",
          [documentA],
        ),
        pool.query(
          `SELECT COUNT(*) FILTER (WHERE tombstone_json IS NOT NULL) AS tombstones
           FROM public.editor_blocks
           WHERE document_id = $1 AND block_type = 'tableCell'`,
          [documentA],
        ),
      ]);
      expect(document.rows[0]?.revision).toBe(0);
      expect(cells.rows[0]?.tombstones).toBe("0");
    });

    it("materializes create, move, delete, and restore graph operations", async () => {
      await seedAtomicDocument(pool, documentA, 0);
      const create = graphTransaction("40000000-0000-4000-8000-000000000040", {
        kind: "create",
        blockId: blockB,
        blockType: "divider",
        placement: {
          parentId: null,
          previousSiblingId: blockA,
          nextSiblingId: null,
        },
      });
      expect(await accept(persistence, documentA, create)).toMatchObject({
        ok: true,
      });
      expect(
        await accept(
          persistence,
          documentA,
          graphTransaction("40000000-0000-4000-8000-000000000041", {
            kind: "move",
            blockId: blockB,
            placement: {
              parentId: null,
              previousSiblingId: null,
              nextSiblingId: blockA,
            },
          }),
        ),
      ).toMatchObject({ ok: true });
      expect(
        await accept(
          persistence,
          documentA,
          graphTransaction("40000000-0000-4000-8000-000000000042", {
            kind: "delete",
            blockId: blockA,
          }),
        ),
      ).toMatchObject({ ok: true });
      expect(
        await accept(
          persistence,
          documentA,
          graphTransaction("40000000-0000-4000-8000-000000000043", {
            kind: "restore",
            blockId: blockA,
            placement: {
              parentId: null,
              previousSiblingId: blockB,
              nextSiblingId: null,
            },
          }),
        ),
      ).toMatchObject({ ok: true });
      const blocks = await pool.query(
        `SELECT block_id, tombstone_json FROM public.editor_blocks
         WHERE document_id = $1 ORDER BY order_key COLLATE "C"`,
        [documentA],
      );
      expect(blocks.rows).toEqual([
        { block_id: String(blockB), tombstone_json: null },
        { block_id: String(blockA), tombstone_json: null },
      ]);
    });

    it("restores a deleted text block from its incremental undo update and clears its retired checkpoint", async () => {
      const projection = richText("restored donor");
      const yjs = createYjsChange(blockA, projection, projection);
      await seedTextDocument(pool, documentA, projection, yjs.initialState);
      await pool.query(
        `INSERT INTO public.editor_blocks(
           document_id, block_id, block_type, parent_block_id, order_key,
           metadata_json, tombstone_json, read_projection_json,
           read_projection_version, updated_at
         ) VALUES($1,$2,'divider',NULL,'a2',NULL,NULL,NULL,NULL,1)`,
        [documentA, blockB],
      );

      expect(
        await accept(
          persistence,
          documentA,
          graphTransaction("40000000-0000-4000-8000-000000000044", {
            kind: "delete",
            blockId: blockA,
          }),
        ),
      ).toMatchObject({ ok: true, accepted: { revision: 1 } });
      const retired = await pool.query<{
        content_checkpoint_base64: string | null;
      }>(
        `SELECT content_checkpoint_base64
         FROM public.editor_blocks
         WHERE document_id = $1 AND block_id = $2`,
        [documentA, blockA],
      );
      expect(retired.rows[0]?.content_checkpoint_base64).toBeNull();

      const restore: EditorTransportTransaction = {
        transactionId: "40000000-0000-4000-8000-000000000045",
        historyAction: "undo",
        graph: {
          changes: [
            {
              kind: "restore",
              blockId: blockA,
              placement: {
                parentId: null,
                previousSiblingId: null,
                nextSiblingId: blockB,
              },
            },
          ],
        },
        metadata: null,
        content: [
          {
            blockId: blockA,
            blockType: "paragraph",
            update: {
              kind: "operation",
              format: "editor-yjs-rich-text",
              version: 2,
              payload: EditorImmutableBinary.copyOf(yjs.initialState),
            },
            readProjection: projection,
          },
        ],
      };
      const restored = await accept(persistence, documentA, restore);
      if (!restored.ok) throw new Error(restored.message);
      expect(restored).toMatchObject({
        ok: true,
        accepted: { revision: 2 },
      });
      const loaded = await persistence.loadBootstrap(documentA);
      if (!loaded.ok) throw new Error(loaded.message);
      expect(firstDraftBootstrapSnapshot(loaded.bootstrap).content[blockA]).toEqual(
        projection,
      );

      const redo = {
        ...graphTransaction("40000000-0000-4000-8000-000000000046", {
          kind: "delete",
          blockId: blockA,
        }),
        historyAction: "redo" as const,
      };
      expect(await accept(persistence, documentA, redo)).toMatchObject({
        ok: true,
        accepted: { revision: 3 },
      });
    });

    it("applies binary Yjs updates, stores the block checkpoint, and rejects malformed updates", async () => {
      const initial = richText("before");
      const next = richText("after");
      const yjs = createYjsChange(blockA, initial, next);
      await seedTextDocument(pool, documentA, initial, yjs.initialState);
      const transaction: EditorTransportTransaction = {
        transactionId: "40000000-0000-4000-8000-000000000050",
        historyAction: "command",
        graph: null,
        metadata: null,
        content: [
          {
            blockId: blockA,
            blockType: "paragraph",
            update: {
              kind: "operation",
              format: "editor-yjs-rich-text",
              version: 2,
              payload: EditorImmutableBinary.copyOf(yjs.update),
            },
            readProjection: next,
          },
        ],
      };

      expect(await accept(persistence, documentA, transaction)).toMatchObject({
        ok: true,
        accepted: { baseRevision: 0, revision: 1 },
      });
      const stored = await pool.query(
        `SELECT read_projection_json, content_checkpoint_base64
         FROM public.editor_blocks
         WHERE document_id = $1 AND block_id = $2`,
        [documentA, blockA],
      );
      expect(
        JSON.parse(stored.rows[0]?.read_projection_json as string),
      ).toEqual(next);
      expect(
        readYjsProjection(
          blockA,
          Buffer.from(
            stored.rows[0]?.content_checkpoint_base64 as string,
            "base64",
          ),
        ),
      ).toEqual(next);
      const checkpointBeforeDuplicate =
        stored.rows[0]?.content_checkpoint_base64;
      expect(await accept(persistence, documentA, transaction)).toMatchObject({
        ok: true,
        status: "existing",
      });
      const duplicateState = await pool.query(
        `SELECT revision, content_checkpoint_base64
         FROM public.editor_documents d
         JOIN public.editor_blocks b USING(document_id)
         WHERE d.document_id = $1 AND b.block_id = $2`,
        [documentA, blockA],
      );
      expect(duplicateState.rows[0]).toEqual({
        revision: 1,
        content_checkpoint_base64: checkpointBeforeDuplicate,
      });

      const invalidBytes: EditorTransportTransaction = {
        ...transaction,
        transactionId: "40000000-0000-4000-8000-000000000052",
        content: [
          {
            ...transaction.content[0]!,
            update: {
              ...transaction.content[0]!.update,
              payload: EditorImmutableBinary.copyOf(
                new Uint8Array([255, 0, 255]),
              ),
            },
          },
        ],
      };
      expect(await accept(persistence, documentA, invalidBytes)).toMatchObject({
        ok: false,
        reason: "invalid",
      });
      const head = await pool.query(
        "SELECT revision FROM public.editor_documents WHERE document_id = $1",
        [documentA],
      );
      expect(head.rows[0]?.revision).toBe(1);
    });

    it("accepts successive causal editor updates and reloads their complete content", async () => {
      await seedFirstDraftPostgresDocument({
        client: pool,
        documentId: documentA,
        snapshot: createFirstDraftSnapshot(),
      });
      const seeded = await persistence.loadBootstrap(documentA);
      if (!seeded.ok) throw new Error(seeded.message);
      const seededSnapshot = firstDraftBootstrapSnapshot(seeded.bootstrap);
      const headingEntry = Object.entries(seededSnapshot.content).find(
        ([, content]) =>
          extractPlainTextFromRichTextDocument(content) ===
          "Northstar Editor: private beta brief",
      );
      if (!headingEntry) throw new Error("Seeded heading is unavailable");
      const headingBlockId = asBlockId(headingEntry[0]);
      const frames: ArrayBuffer[] = [];
      const transactionIds = [
        "40000000-0000-4000-8000-000000000060",
        "40000000-0000-4000-8000-000000000061",
      ];
      const editor = initializeEditableEditor({
        definition: createFirstDraftEditorDefinition(
          createFirstDraftViewStateStore(),
        ),
        snapshot: seededSnapshot,
        onChange: handleTransaction({
          readyState: 1,
          send: (frame) => frames.push(frame.slice(0)),
        }),
        createTransactionId: () =>
          transactionIds.shift() ?? "unexpected-transaction",
      });
      expect(
        editor.insertText({ blockId: headingBlockId, offset: 0, text: "T" }),
      ).toBe(true);
      expect(
        editor.insertText({
          blockId: headingBlockId,
          offset: 1,
          text: "PASTED",
        }),
      ).toBe(true);
      editor.dispose();
      await vi.waitFor(() => expect(frames).toHaveLength(2));
      expect(frames).toHaveLength(2);
      const transactionA = proposedTransaction(frames[0]!);
      const transactionB = proposedTransaction(frames[1]!);

      const resultA = await accept(persistence, documentA, transactionA);
      const resultB = await accept(persistence, documentA, transactionB);
      expect(resultA).toMatchObject({
        ok: true,
        accepted: { baseRevision: 0, revision: 1 },
      });
      expect(resultB).toMatchObject({
        ok: true,
        accepted: { baseRevision: 1, revision: 2 },
      });

      const [document, transactions, stored] = await Promise.all([
        pool.query(
          "SELECT revision FROM public.editor_documents WHERE document_id = $1",
          [documentA],
        ),
        pool.query(
          `SELECT transaction_id, base_revision, revision
           FROM public.editor_transactions
           WHERE document_id = $1 ORDER BY revision`,
          [documentA],
        ),
        pool.query(
          `SELECT read_projection_json, content_checkpoint_base64
           FROM public.editor_blocks
           WHERE document_id = $1 AND block_id = $2`,
          [documentA, headingBlockId],
        ),
      ]);
      expect(document.rows[0]?.revision).toBe(2);
      expect(transactions.rows).toEqual([
        {
          transaction_id: "40000000-0000-4000-8000-000000000060",
          base_revision: 0,
          revision: 1,
        },
        {
          transaction_id: "40000000-0000-4000-8000-000000000061",
          base_revision: 1,
          revision: 2,
        },
      ]);
      expect(
        extractPlainTextFromRichTextDocument(
          JSON.parse(stored.rows[0]?.read_projection_json as string),
        ),
      ).toBe("TPASTEDNorthstar Editor: private beta brief");
      expect(
        extractPlainTextFromRichTextDocument(
          readYjsProjection(
            headingBlockId,
            Buffer.from(
              stored.rows[0]?.content_checkpoint_base64 as string,
              "base64",
            ),
          ),
        ),
      ).toBe("TPASTEDNorthstar Editor: private beta brief");

      const reloaded = await persistence.loadBootstrap(documentA);
      if (!reloaded.ok) throw new Error(reloaded.message);
      const reloadedSnapshot = firstDraftBootstrapSnapshot(reloaded.bootstrap);
      expect(reloaded.bootstrap.revision).toBe(2);
      expect(
        extractPlainTextFromRichTextDocument(
          reloadedSnapshot.content[headingBlockId]!,
        ),
      ).toBe("TPASTEDNorthstar Editor: private beta brief");
    });

    it.each(["A-then-B", "B-then-A"] as const)(
      "persists concurrent Yjs updates in receive order %s and hydrates the converged projection",
      async (receiveOrder) => {
        await seedFirstDraftPostgresDocument({
          client: pool,
          documentId: documentA,
          snapshot: createFirstDraftSnapshot(),
        });
        const seeded = await persistence.loadBootstrap(documentA);
        if (!seeded.ok) throw new Error(seeded.message);
        const seededSnapshot = firstDraftBootstrapSnapshot(seeded.bootstrap);
        const headingEntry = Object.entries(seededSnapshot.content).find(
          ([, content]) =>
            extractPlainTextFromRichTextDocument(content) ===
            "Northstar Editor: private beta brief",
        );
        if (!headingEntry) throw new Error("Seeded heading is unavailable");
        const headingBlockId = asBlockId(headingEntry[0]);
        const framesA: ArrayBuffer[] = [];
        const framesB: ArrayBuffer[] = [];
        const definition = () =>
          createFirstDraftEditorDefinition(createFirstDraftViewStateStore());
        const editorA = initializeEditableEditor({
          definition: definition(),
          snapshot: seededSnapshot,
          onChange: handleTransaction({
            readyState: 1,
            send: (frame) => framesA.push(frame.slice(0)),
          }),
          createTransactionId: () =>
            "40000000-0000-4000-8000-000000000062",
        });
        const editorB = initializeEditableEditor({
          definition: definition(),
          snapshot: seededSnapshot,
          onChange: handleTransaction({
            readyState: 1,
            send: (frame) => framesB.push(frame.slice(0)),
          }),
          createTransactionId: () =>
            "40000000-0000-4000-8000-000000000063",
        });
        const editingLeaseA = editorA.contentRuntime.acquireBlockContent(
          headingBlockId,
          "heading",
          "active-editing",
        );
        const editingLeaseB = editorB.contentRuntime.acquireBlockContent(
          headingBlockId,
          "heading",
          "active-editing",
        );
        expect(
          editorA.insertText({ blockId: headingBlockId, offset: 0, text: "A" }),
        ).toBe(true);
        expect(
          editorB.insertText({ blockId: headingBlockId, offset: 0, text: "B" }),
        ).toBe(true);
        expect(framesA).toHaveLength(1);
        expect(framesB).toHaveLength(1);
        const transactionA = proposedTransaction(framesA[0]!);
        const transactionB = proposedTransaction(framesB[0]!);
        const appliedToA = editorA.applyRemoteTransaction({
          transaction: remoteTransaction(transactionB),
          authorSelection: { kind: "no-author-selection" },
        });
        if (appliedToA.status === "rejected") {
          throw new Error(`${appliedToA.reason}: ${appliedToA.message}`);
        }
        const appliedToB = editorB.applyRemoteTransaction({
          transaction: remoteTransaction(transactionA),
          authorSelection: { kind: "no-author-selection" },
        });
        if (appliedToB.status === "rejected") {
          throw new Error(`${appliedToB.reason}: ${appliedToB.message}`);
        }
        const converged = editorA.readBlockPlainText(
          headingBlockId,
          "heading",
        );
        expect(
          editorB.readBlockPlainText(headingBlockId, "heading"),
        ).toBe(converged);
        expect(framesA).toHaveLength(1);
        expect(framesB).toHaveLength(1);
        editingLeaseA.release();
        editingLeaseB.release();
        editorA.dispose();
        editorB.dispose();

        const ordered =
          receiveOrder === "A-then-B"
            ? [transactionA, transactionB]
            : [transactionB, transactionA];
        expect(await accept(persistence, documentA, ordered[0]!)).toMatchObject({
          ok: true,
          accepted: { baseRevision: 0, revision: 1 },
        });
        expect(await accept(persistence, documentA, ordered[1]!)).toMatchObject({
          ok: true,
          accepted: { baseRevision: 1, revision: 2 },
        });

        const stored = await pool.query(
          `SELECT read_projection_json, content_checkpoint_base64
           FROM public.editor_blocks
           WHERE document_id = $1 AND block_id = $2`,
          [documentA, headingBlockId],
        );
        const storedProjection = JSON.parse(
          stored.rows[0]?.read_projection_json as string,
        );
        const storedCheckpointProjection = readYjsProjection(
          headingBlockId,
          Buffer.from(
            stored.rows[0]?.content_checkpoint_base64 as string,
            "base64",
          ),
        );
        expect(storedProjection).toEqual(storedCheckpointProjection);
        expect(extractPlainTextFromRichTextDocument(storedProjection)).toBe(
          converged,
        );
        const reloaded = await persistence.loadBootstrap(documentA);
        if (!reloaded.ok) throw new Error(reloaded.message);
        const reloadedSnapshot = firstDraftBootstrapSnapshot(reloaded.bootstrap);
        expect(
          extractPlainTextFromRichTextDocument(
            reloadedSnapshot.content[headingBlockId]!,
          ),
        ).toBe(converged);
      },
    );

    it("loads the authoritative document snapshot and Yjs checkpoint by document ID", async () => {
      const projection = richText("loaded from PostgreSQL");
      const yjs = createYjsChange(blockA, projection, projection);
      await seedTextDocument(pool, documentA, projection, yjs.initialState);

      const loaded = await persistence.loadBootstrap(documentA);

      if (!loaded.ok) throw new Error(loaded.message);
      const snapshot = firstDraftBootstrapSnapshot(loaded.bootstrap);
      expect(loaded).toMatchObject({
        ok: true,
        bootstrap: {
          documentId: documentA,
          revision: 0,
        },
      });
      expect(snapshot.blockGraphVersion).toBe(1);
      expect(snapshot.rootBlockIds).toEqual([blockA]);
      expect(snapshot.content[blockA]).toEqual(projection);
      const checkpoint = snapshot.opaqueContentCheckpoints[blockA];
      expect(checkpoint).toBeDefined();
      expect(readYjsProjection(
        blockA,
        Buffer.from(checkpoint!.payloadBase64, "base64"),
      )).toEqual(
        projection,
      );
    });

    it("diagnoses an incomplete public schema without repairing it", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DROP TABLE public.editor_transactions");
        await expect(assertFirstDraftPostgresSchema(client)).rejects.toThrow(
          "First Draft PostgreSQL schema is incompatible:\nmissing public.editor_transactions.\nRun `pnpm db:reset:first-draft` for local development.",
        );
        const stillMissing = await client.query(
          `SELECT to_regclass('public.editor_transactions') AS table_name`,
        );
        expect(stillMissing.rows[0]?.table_name).toBeNull();
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });
  },
);

async function seedAtomicDocument(
  pool: Pool,
  documentId: string,
  revision: number,
): Promise<void> {
  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO public.editor_documents(
         document_id, revision, created_at, updated_at
       ) VALUES($1,$2,1,1)`,
      [documentId, revision],
    );
    await pool.query(
      `INSERT INTO public.editor_blocks(
         document_id, block_id, block_type, parent_block_id, order_key,
         metadata_json, tombstone_json, read_projection_json,
         read_projection_version, updated_at
       ) VALUES($1,$2,'divider',NULL,'a0',NULL,NULL,NULL,NULL,1)`,
      [documentId, blockA],
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function seedTextDocument(
  pool: Pool,
  documentId: string,
  projection: RichTextDocumentNodeJson,
  state: Uint8Array,
): Promise<void> {
  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO public.editor_documents(
         document_id, revision, created_at, updated_at
       ) VALUES($1,0,1,1)`,
      [documentId],
    );
    await pool.query(
      `INSERT INTO public.editor_blocks(
         document_id, block_id, block_type, parent_block_id, order_key,
         metadata_json, tombstone_json, read_projection_json,
         read_projection_version, content_checkpoint_base64, updated_at
       ) VALUES($1,$2,'paragraph',NULL,'a0',NULL,NULL,$3,1,$4,1)`,
      [
        documentId,
        blockA,
        JSON.stringify(projection),
        Buffer.from(state).toString("base64"),
      ],
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

function testDatabaseUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = "/editor_document_first_draft_test";
  return url.toString();
}

function metadataTransaction(
  transactionId: string,
  blockId: typeof blockA,
  values: Record<string, boolean | string>,
): EditorTransportTransaction {
  return {
    transactionId,
    historyAction: "command",
    graph: null,
    metadata: {
      kind: "updateBlockMetadata",
      updates: [{ blockId, values }],
    },
    content: [],
  };
}

function graphTransaction(
  transactionId: string,
  change: NonNullable<EditorTransportTransaction["graph"]>["changes"][number],
): EditorTransportTransaction {
  return {
    transactionId,
    historyAction: "command",
    graph: { changes: [change] },
    metadata: null,
    content: [],
  };
}

async function accept(
  persistence: ReturnType<typeof createFirstDraftPostgresPersistence>,
  documentId: string,
  transaction: EditorTransportTransaction,
) {
  const frame = encodeFirstDraftMessage({
    type: "proposed-editor-transaction",
    transaction,
  });
  return persistence.accept({
    documentId,
    transaction,
    encodedTransaction: new Uint8Array(frame),
  });
}

function richText(text: string): RichTextDocumentNodeJson {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function createYjsChange(
  blockId: typeof blockA,
  initial: RichTextDocumentNodeJson,
  next: RichTextDocumentNodeJson,
): { readonly initialState: Uint8Array; readonly update: Uint8Array } {
  const doc = new YDoc();
  const context = createBlockContentDocContext({
    blockId,
    doc,
    destroyDocOnDestroy: false,
  });
  try {
    writeCanonicalYjsBlockContent(context, initial, "test-initial");
    const initialState = encodeStateAsUpdate(doc);
    const initialVector = encodeStateVector(doc);
    writeCanonicalYjsBlockContent(context, next, "test-update");
    return {
      initialState,
      update: encodeStateAsUpdate(doc, initialVector),
    };
  } finally {
    context.destroy();
    doc.destroy();
  }
}

function readYjsProjection(blockId: typeof blockA, state: Uint8Array) {
  const doc = new YDoc();
  try {
    applyUpdate(doc, state);
    const context = createBlockContentDocContext({
      blockId,
      doc,
      destroyDocOnDestroy: false,
    });
    try {
      return readCanonicalYjsBlockContent(context);
    } finally {
      context.destroy();
    }
  } finally {
    doc.destroy();
  }
}

function proposedTransaction(frame: ArrayBuffer): EditorTransportTransaction {
  const decoded = decodeFirstDraftMessage(frame);
  if (!decoded.ok || decoded.message.type !== "proposed-editor-transaction") {
    throw new Error("Expected a proposed editor transaction");
  }
  return decoded.message.transaction;
}

function remoteTransaction(transaction: EditorTransportTransaction) {
  return {
    transactionId: transaction.transactionId,
    historyAction: transaction.historyAction,
    graph: transaction.graph,
    metadata: transaction.metadata,
    content: transaction.content,
  };
}
