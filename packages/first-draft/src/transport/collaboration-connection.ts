import {
  decodeFirstDraftMessage,
  type FirstDraftMessage,
  type FirstDraftServerMessage,
} from "./message-protocol.ts";

export interface FirstDraftConnectionSocket {
  binaryType: BinaryType;
  readonly readyState: number;
  send(data: ArrayBuffer): void;
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

export interface FirstDraftMessageDispatcher {
  readonly socket: FirstDraftConnectionSocket;
  subscribe(listener: (message: FirstDraftServerMessage) => void): () => void;
  subscribeDecodeErrors(listener: (error: Error) => void): () => void;
  subscribeSocketErrors(listener: (event: Event) => void): () => void;
  dispose(): void;
}

/** Owns the socket's sole binary decoder and message dispatch. */
export function createFirstDraftMessageDispatcher(
  socket: FirstDraftConnectionSocket,
): FirstDraftMessageDispatcher {
  socket.binaryType = "arraybuffer";
  const listeners = new Set<(message: FirstDraftServerMessage) => void>();
  const decodeErrorListeners = new Set<(error: Error) => void>();
  const socketErrorListeners = new Set<(event: Event) => void>();
  let disposed = false;

  const onMessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
      publishError(
        new Error("First Draft WebSocket received a non-binary frame"),
      );
      return;
    }
    const decoded = decodeFirstDraftMessage(data);
    if (!decoded.ok) {
      publishError(new Error(decoded.error));
      return;
    }
    const message = decoded.message;
    if (!isServerMessage(message)) return;
    for (const listener of [...listeners]) listener(message);
  };
  const onError = (event: Event) => {
    for (const listener of [...socketErrorListeners]) listener(event);
  };
  const publishError = (error: Error) => {
    for (const listener of [...decodeErrorListeners]) listener(error);
  };
  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", onError);

  const dispatcher: FirstDraftMessageDispatcher = {
    socket,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeDecodeErrors(listener) {
      if (disposed) return () => undefined;
      decodeErrorListeners.add(listener);
      return () => decodeErrorListeners.delete(listener);
    },
    subscribeSocketErrors(listener) {
      if (disposed) return () => undefined;
      socketErrorListeners.add(listener);
      return () => socketErrorListeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      listeners.clear();
      decodeErrorListeners.clear();
      socketErrorListeners.clear();
    },
  };
  return Object.freeze(dispatcher);
}

function isServerMessage(
  message: FirstDraftMessage,
): message is FirstDraftServerMessage {
  return (
    message.type !== "connect-first-draft-session" &&
    message.type !== "subscribe-first-draft-document" &&
    message.type !== "unsubscribe-first-draft-document" &&
    message.type !== "proposed-editor-transaction"
  );
}
