type SocketIdentity = object;

export const MAX_LIVE_TRANSACTION_IDS_PER_SOCKET = 2_048;

const seenBySocket = new WeakMap<SocketIdentity, Map<string, true>>();
const failedSockets = new WeakSet<SocketIdentity>();

export function markLiveTransactionSeen(
  socket: SocketIdentity,
  transactionId: string,
): void {
  let seen = seenBySocket.get(socket);
  if (!seen) {
    seen = new Map();
    seenBySocket.set(socket, seen);
  }
  seen.delete(transactionId);
  seen.set(transactionId, true);
  while (seen.size > MAX_LIVE_TRANSACTION_IDS_PER_SOCKET) {
    const oldest = seen.keys().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
}

export function hasSeenLiveTransaction(
  socket: SocketIdentity,
  transactionId: string,
): boolean {
  return seenBySocket.get(socket)?.has(transactionId) ?? false;
}

export function forgetLiveTransaction(
  socket: SocketIdentity,
  transactionId: string,
): void {
  seenBySocket.get(socket)?.delete(transactionId);
}

export function recordSocketTransportError(socket: SocketIdentity): void {
  failedSockets.add(socket);
}

export function socketHasTransportError(socket: SocketIdentity): boolean {
  return failedSockets.has(socket);
}
