import type { EditorChangeCallback } from "@repo/editor-web/editor";
import { convertEditorTransactionToTransport } from "./editor-transaction-to-transport.ts";
import { encodeFirstDraftMessage } from "./message-protocol.ts";
import {
  markLiveTransactionSeen,
  socketHasTransportError,
} from "./live-transaction-ids.ts";

export interface EditorTransactionWebSocket {
  readonly readyState: number;
  send(data: ArrayBuffer): void;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/** Captures one socket and returns the editor's one-argument change callback. */
export function handleTransaction(
  socket: EditorTransactionWebSocket,
  onPublished?: (transactionId: string) => void,
): EditorChangeCallback {
  return function submitTransaction(transaction): void {
    if (socketHasTransportError(socket)) {
      throw new Error(
        "Cannot send editor transaction: WebSocket is in an error state",
      );
    }
    switch (socket.readyState) {
      case CONNECTING:
        throw new Error(
          "Cannot send editor transaction: WebSocket is connecting",
        );
      case CLOSING:
        throw new Error("Cannot send editor transaction: WebSocket is closing");
      case CLOSED:
        throw new Error("Cannot send editor transaction: WebSocket is closed");
      case OPEN:
        break;
      default:
        throw new Error(
          "Cannot send editor transaction: WebSocket state is invalid",
        );
    }

    const transportTransaction =
      convertEditorTransactionToTransport(transaction);
    const frame = encodeFirstDraftMessage({
      type: "proposed-editor-transaction",
      transaction: transportTransaction,
    });
    socket.send(frame);
    onPublished?.(transportTransaction.transactionId);
    markLiveTransactionSeen(socket, transportTransaction.transactionId);
  };
}
