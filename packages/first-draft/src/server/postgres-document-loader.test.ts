import { describe, expect, it, vi } from "vitest";
import type { EditorTransportTransaction } from "../transport/transport-types.ts";
import { serializeFirstDraftTransactionForDatabase } from "./persisted-transaction.ts";
import { loadFirstDraftAcceptedTransactionsFromPostgres } from "./postgres-document-loader.ts";

function transaction(transactionId: string, blockId: string): EditorTransportTransaction {
  return {
    transactionId,
    historyAction: "command",
    graph: { changes: [{ kind: "delete", blockId }] },
    metadata: null,
    content: [],
  };
}

function row(baseRevision: number, transactionId = `transaction-${baseRevision + 1}`) {
  const value = transaction(transactionId, `block-${baseRevision + 1}`);
  return {
    transaction_id: transactionId,
    base_revision: baseRevision,
    revision: baseRevision + 1,
    transaction_json: serializeFirstDraftTransactionForDatabase(value),
    accepted_at: 1_700_000_000_000 + baseRevision,
  };
}

function client(head: number, rows: readonly Record<string, unknown>[]) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT revision")) return { rows: [{ revision: head }] };
      if (sql.startsWith("SELECT transaction_id")) return { rows };
      return { rows: [] };
    }),
  };
}

describe("First Draft accepted transaction replay", () => {
  it("acknowledges an already-current bootstrap without a snapshot", async () => {
    const result = await loadFirstDraftAcceptedTransactionsFromPostgres({
      client: client(5, []),
      documentId: "document-a",
      revision: 5,
    });
    expect(result).toEqual({
      ok: true,
      requestedRevision: 5,
      currentRevision: 5,
      transactions: [],
    });
  });

  it("returns several intervening transactions exactly once in revision order", async () => {
    const result = await loadFirstDraftAcceptedTransactionsFromPostgres({
      client: client(5, [row(2), row(3), row(4)]),
      documentId: "document-a",
      revision: 2,
    });
    expect(result.ok && result.transactions.map((entry) => entry.revision)).toEqual([3, 4, 5]);
    expect(result.ok && result.currentRevision).toBe(5);
  });

  it.each([
    ["missing", [row(2), row(4)]],
    ["duplicate", [row(2, "same-transaction"), row(3, "same-transaction")]],
    ["non-contiguous", [row(3)]],
  ])("fails an invalid %s replay explicitly", async (_label, rows) => {
    const result = await loadFirstDraftAcceptedTransactionsFromPostgres({
      client: client(5, rows),
      documentId: "document-a",
      revision: 2,
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });
});
