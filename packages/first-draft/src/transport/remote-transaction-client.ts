import type {
  RemoteEditorTransaction,
  RemoteTransactionResult,
} from "@repo/editor-web/editor";
import type {
  FirstDraftOutboundPublisher,
  FirstDraftRemoteRefreshEditor,
} from "./outbound-publisher.ts";
import type {
  EditorTransactionAcceptedMessage,
  EditorTransactionPersistenceFailedMessage,
} from "./message-protocol.ts";
import type { EditorTransportTransaction } from "./transport-types.ts";
import type { FirstDraftMessageDispatcher } from "./collaboration-connection.ts";

export interface FirstDraftRemoteTransactionEditor {
  applyRemoteTransaction(
    transaction: RemoteEditorTransaction,
  ): RemoteTransactionResult;
}

export interface FirstDraftRemoteTransactionClientOptions {
  readonly documentId: string;
  readonly initialRevision: number;
  readonly outbox: FirstDraftOutboundPublisher;
  readonly onProtocolError?: (error: Error) => void;
  readonly onApplied?: (
    transaction: EditorTransportTransaction,
    result: Extract<RemoteTransactionResult, { status: "applied" }>,
  ) => void;
  readonly onDuplicate?: (transactionId: string) => void;
  readonly onRevisionAdvanced?: (
    revision: number,
    source: "local-acceptance" | "remote-replay",
  ) => void;
  readonly onAccepted?: (message: EditorTransactionAcceptedMessage) => void;
  readonly onPersistenceFailed?: (
    message: EditorTransactionPersistenceFailedMessage,
  ) => void;
}

/** Orders acceptance/replay ingress against one document-session outbox. */
export function attachFirstDraftRemoteTransactions(
  connection: FirstDraftMessageDispatcher,
  editor: FirstDraftRemoteTransactionEditor,
  options: FirstDraftRemoteTransactionClientOptions,
): () => void {
  let revision = options.initialRevision;
  const report = (error: unknown) => options.onProtocolError?.(toError(error));
  const onMessage: Parameters<FirstDraftMessageDispatcher["subscribe"]>[0] = (
    message,
  ): void => {
    if (message.type === "first-draft-protocol-error") {
      report(new Error(`${message.code}: ${message.message}`));
      return;
    }
    if (message.type === "editor-transaction-accepted") {
      if (message.documentId !== options.documentId) {
        report(new Error("Local First Draft acceptance document identity is invalid"));
        return;
      }
      let classification;
      try {
        classification = options.outbox.acceptLocal(message, revision);
      } catch (error) {
        report(error);
        return;
      }
      if (classification === "duplicate-local-acceptance") {
        options.onDuplicate?.(message.transactionId);
        return;
      }
      revision = message.revision;
      options.onRevisionAdvanced?.(revision, "local-acceptance");
      options.onAccepted?.(message);
      return;
    }
    if (message.type === "editor-transaction-persistence-failed") {
      if (message.documentId !== options.documentId) {
        report(new Error("First Draft persistence failure document identity is invalid"));
        return;
      }
      try {
        options.outbox.persistenceFailed(message);
      } catch (error) {
        report(error);
        return;
      }
      options.onPersistenceFailed?.(message);
      return;
    }
    if (message.type !== "first-draft-accepted-transaction-replay") return;
    if (message.documentId !== options.documentId) {
      report(new Error("Accepted First Draft replay document identity is invalid"));
      return;
    }

    let classification;
    try {
      classification = options.outbox.classifyReplay(message, revision);
    } catch (error) {
      report(error);
      return;
    }
    if (message.revision <= revision) {
      if (
        classification !== "local-duplicate" &&
        classification !== "remote-duplicate"
      ) {
        report(new Error("Accepted First Draft replay revision conflicts with local state"));
        return;
      }
      options.onDuplicate?.(message.transactionId);
      return;
    }
    if (
      message.baseRevision !== revision ||
      message.revision !== revision + 1
    ) {
      report(
        new Error(
          "Accepted First Draft transaction replay is missing or non-contiguous",
        ),
      );
      return;
    }
    if (
      classification === "local-duplicate" ||
      classification === "remote-duplicate"
    ) {
      report(new Error("Accepted First Draft replay repeats an identity at a new revision"));
      return;
    }
    if (classification === "remote-new") {
      const result = editor.applyRemoteTransaction({
        transaction: message.transaction,
        authorSelection: { kind: "no-author-selection" },
      });
      if (result.status === "rejected") {
        report(
          new Error(
            `Accepted remote editor transaction was rejected: ${result.message}`,
          ),
        );
        return;
      }
      options.onApplied?.(message.transaction, result);
      options.outbox.remoteApplied(
        message,
        result,
        editor as FirstDraftRemoteTransactionEditor & FirstDraftRemoteRefreshEditor,
      );
    } else {
      options.onDuplicate?.(message.transactionId);
    }
    revision = message.revision;
    options.onRevisionAdvanced?.(revision, "remote-replay");
  };

  const unsubscribeMessages = connection.subscribe(onMessage);
  const unsubscribeDecodeErrors = connection.subscribeDecodeErrors(report);
  return () => {
    unsubscribeMessages();
    unsubscribeDecodeErrors();
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
