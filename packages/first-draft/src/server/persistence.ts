import type { EditorTransportTransaction } from "../transport/transport-types.ts";
import type { ValidatedFirstDraftBootstrap } from "../read-model/bootstrap.ts";

export interface AcceptFirstDraftTransactionInput {
  readonly documentId: string;
  readonly transaction: EditorTransportTransaction;
  readonly encodedTransaction: Uint8Array;
}

export interface FirstDraftAcceptedTransactionIdentity {
  readonly documentId: string;
  readonly transactionId: string;
  readonly baseRevision: number;
  readonly revision: number;
  readonly acceptedAt: number;
}

export type FirstDraftPersistenceFailureReason =
  | "missing"
  | "invalid"
  | "integrity"
  | "unavailable";

export type AcceptFirstDraftTransactionResult =
  | {
      readonly ok: true;
      readonly status: "accepted" | "existing";
      readonly accepted: FirstDraftAcceptedTransactionIdentity;
      /** The canonical transaction persisted in the accepted revision log. */
      readonly transaction: EditorTransportTransaction;
    }
  | {
      readonly ok: false;
      readonly reason: FirstDraftPersistenceFailureReason;
      readonly message: string;
      readonly retryable: boolean;
    };

/** Database-only boundary; it deliberately has no WebSocket or room methods. */
export interface FirstDraftTransactionPersistence {
  accept(
    input: AcceptFirstDraftTransactionInput,
  ): Promise<AcceptFirstDraftTransactionResult>;
}

export interface FirstDraftAcceptedTransaction {
  readonly transactionId: string;
  readonly baseRevision: number;
  readonly revision: number;
  readonly acceptedAt: number;
  readonly transaction: EditorTransportTransaction;
}

export type LoadFirstDraftBootstrapResult =
  | {
      readonly ok: true;
      readonly bootstrap: ValidatedFirstDraftBootstrap;
    }
  | {
      readonly ok: false;
      readonly reason: "missing" | "invalid" | "unavailable";
      readonly message: string;
    };

export type LoadFirstDraftAcceptedTransactionsResult =
  | {
      readonly ok: true;
      readonly requestedRevision: number;
      readonly currentRevision: number;
      readonly transactions: readonly FirstDraftAcceptedTransaction[];
    }
  | {
      readonly ok: false;
      readonly reason:
        | "missing"
        | "revision-unavailable"
        | "invalid"
        | "unavailable";
      readonly message: string;
    };

/** Product-owned authoritative bootstrap and revision replay application service. */
export interface FirstDraftDocumentLoader {
  loadBootstrap(documentId: string): Promise<LoadFirstDraftBootstrapResult>;
  loadAcceptedTransactions(
    documentId: string,
    revision: number,
  ): Promise<LoadFirstDraftAcceptedTransactionsResult>;
}
