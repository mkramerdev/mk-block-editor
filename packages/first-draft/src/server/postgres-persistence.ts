import { Pool, type PoolClient } from "pg";
import { acceptFirstDraftTransactionInPostgresTransaction } from "./postgres-acceptance.ts";
import {
  loadFirstDraftAcceptedTransactionsFromPostgres,
  loadFirstDraftDocumentFromPostgres,
} from "./postgres-document-loader.ts";
import {
  assertFirstDraftPostgresSchema,
  validateFirstDraftPostgresSchema,
  type FirstDraftPostgresSchemaValidation,
} from "./postgres-schema.ts";
import type {
  AcceptFirstDraftTransactionInput,
  AcceptFirstDraftTransactionResult,
  FirstDraftTransactionPersistence,
  FirstDraftDocumentLoader,
} from "./persistence.ts";

export interface FirstDraftPostgresPersistence
  extends FirstDraftTransactionPersistence,
    FirstDraftDocumentLoader {
  assertReady(): Promise<void>;
  checkReadiness(): Promise<FirstDraftPostgresSchemaValidation>;
  close(): Promise<void>;
}

export interface CreateFirstDraftPostgresPersistenceOptions {
  readonly connectionString: string;
  readonly onError?: (error: unknown) => void;
}

/** Creates a pool only; existing editor tables remain externally managed. */
export function createFirstDraftPostgresPersistence(
  options: CreateFirstDraftPostgresPersistenceOptions,
): FirstDraftPostgresPersistence {
  const pool = new Pool({ connectionString: options.connectionString });
  return {
    async assertReady() {
      const client = await pool.connect();
      try {
        await assertFirstDraftPostgresSchema(client);
      } finally {
        client.release();
      }
    },
    async checkReadiness() {
      let client: PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        options.onError?.(error);
        return {
          ok: false,
          issues: Object.freeze(["PostgreSQL is unavailable."]),
        };
      }
      try {
        return await validateFirstDraftPostgresSchema(client);
      } catch (error) {
        options.onError?.(error);
        return {
          ok: false,
          issues: Object.freeze(["PostgreSQL schema validation failed."]),
        };
      } finally {
        client.release();
      }
    },
    async loadBootstrap(documentId) {
      let client: PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        options.onError?.(error);
        return {
          ok: false,
          reason: "unavailable",
          message: "First Draft document loading is unavailable",
        };
      }
      try {
        return await loadFirstDraftDocumentFromPostgres({
          client,
          documentId,
          onError: options.onError,
        });
      } finally {
        client.release();
      }
    },
    async loadAcceptedTransactions(documentId, revision) {
      let client: PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        options.onError?.(error);
        return {
          ok: false,
          reason: "unavailable",
          message: "First Draft transaction replay is unavailable",
        };
      }
      try {
        return await loadFirstDraftAcceptedTransactionsFromPostgres({
          client,
          documentId,
          revision,
          onError: options.onError,
        });
      } finally {
        client.release();
      }
    },
    async accept(
      input: AcceptFirstDraftTransactionInput,
    ): Promise<AcceptFirstDraftTransactionResult> {
      let client: PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        options.onError?.(error);
        return {
          ok: false,
          reason: "unavailable",
          message: "First Draft transaction persistence is unavailable",
          retryable: true,
        };
      }
      try {
        return await acceptFirstDraftTransactionInPostgresTransaction({
          ...input,
          client,
          onError: options.onError,
        });
      } catch (error) {
        options.onError?.(error);
        return {
          ok: false,
          reason: "unavailable",
          message: "First Draft transaction persistence is unavailable",
          retryable: true,
        };
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
