import type {
  RemoteEditorTransaction,
  RemoteTransactionResult,
} from "@repo/editor-web/editor";
import {
  forgetLiveTransaction,
  hasSeenLiveTransaction,
  markLiveTransactionSeen,
  recordSocketTransportError,
} from "./live-transaction-ids.ts";
import type {
  EditorTransactionAcceptedMessage,
  EditorTransactionPersistenceFailedMessage,
} from "./message-protocol.ts";
import type { FirstDraftMessageDispatcher } from "./collaboration-connection.ts";

export interface FirstDraftRemoteTransactionSocket {
  binaryType: BinaryType;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: Event) => void): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  removeEventListener(type: "error", listener: (event: Event) => void): void;
}

export interface FirstDraftRemoteTransactionEditor {
  applyRemoteTransaction(
    transaction: RemoteEditorTransaction,
  ): RemoteTransactionResult;
}

export interface FirstDraftRemoteTransactionClientOptions {
  readonly documentId?: string;
  readonly initialRevision?: number;
  readonly onProtocolError?: (error: Error) => void;
  readonly onApplied?: (
    result: Extract<RemoteTransactionResult, { status: "applied" }>,
  ) => void;
  readonly onDuplicate?: (transactionId: string) => void;
  readonly onAccepted?: (message: EditorTransactionAcceptedMessage) => void;
  readonly onPersistenceFailed?: (
    message: EditorTransactionPersistenceFailedMessage,
  ) => void;
}

/** Installs the live receiver and returns its lifecycle disposer. */
export function attachFirstDraftRemoteTransactions(
  connection: FirstDraftMessageDispatcher,
  editor: FirstDraftRemoteTransactionEditor,
  options: FirstDraftRemoteTransactionClientOptions = {},
): () => void {
  const socket = connection.socket;
  let revision = options.initialRevision ?? 0;
  const report = (message: string) =>
    options.onProtocolError?.(new Error(message));
  const onMessage: Parameters<FirstDraftMessageDispatcher["subscribe"]>[0] = (
    message,
  ): void => {
    if (message.type === "first-draft-protocol-error") {
      report(`${message.code}: ${message.message}`);
      return;
    }
    if (message.type === "editor-transaction-accepted") {
      if (
        (options.documentId !== undefined &&
          message.documentId !== options.documentId) ||
        message.baseRevision !== revision ||
        message.revision !== revision + 1
      ) {
        report("Local First Draft acceptance is missing or non-contiguous");
        return;
      }
      revision = message.revision;
      options.onAccepted?.(message);
      return;
    }
    if (message.type === "editor-transaction-persistence-failed") {
      options.onPersistenceFailed?.(message);
      return;
    }
    if (message.type === "first-draft-accepted-transaction-replay") {
      if (
        message.revision <= revision &&
        hasSeenLiveTransaction(socket, message.transaction.transactionId)
      ) {
        options.onDuplicate?.(message.transaction.transactionId);
        return;
      }
      if (
        (options.documentId !== undefined &&
          message.documentId !== options.documentId) ||
        message.baseRevision !== revision ||
        message.revision !== revision + 1
      ) {
        report(
          "Accepted First Draft transaction replay is missing or non-contiguous",
        );
        return;
      }
      const transaction = message.transaction;
      if (!hasSeenLiveTransaction(socket, transaction.transactionId)) {
        markLiveTransactionSeen(socket, transaction.transactionId);
        const result = editor.applyRemoteTransaction({
          transaction,
          authorSelection: { kind: "no-author-selection" },
        });
        if (result.status === "rejected") {
          forgetLiveTransaction(socket, transaction.transactionId);
          report(
            `Accepted remote editor transaction was rejected: ${result.message}`,
          );
          return;
        }
        options.onApplied?.(result);
      } else {
        options.onDuplicate?.(transaction.transactionId);
      }
      revision = message.revision;
      return;
    }
  };
  const onError = (): void => {
    recordSocketTransportError(socket);
    report("First Draft WebSocket entered an error state");
  };
  const unsubscribeMessages = connection.subscribe(onMessage);
  const unsubscribeDecodeErrors = connection.subscribeDecodeErrors((error) =>
    report(error.message),
  );
  const unsubscribeSocketErrors = connection.subscribeSocketErrors(onError);
  return () => {
    unsubscribeMessages();
    unsubscribeDecodeErrors();
    unsubscribeSocketErrors();
  };
}
