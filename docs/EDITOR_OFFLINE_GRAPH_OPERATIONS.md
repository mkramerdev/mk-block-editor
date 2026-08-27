# Offline graph operations

**Status: Proposed; not implemented in the current repository.**

This document records a possible future offline graph-operation design. The
current First Draft client retains unresolved finalized transactions in a
mounted-surface, in-memory outbox and publishes them over a WebSocket. It has no
durable browser database, offline editing, queued graph rebase, or
crash-recovery submission log. The transport is therefore not offline-safe.

## Current invariants

The following statements describe the implementation that exists today:

- `EditorOperation` is the canonical logical replay format for structure,
  metadata, and block-local content.
- The editor owns semantic placement, graph validation, one bounded linear
  history, and atomic canonical transaction preparation/commit.
- A finalized local transaction is converted by
  `@repo/editor-first-draft/transport`, retained by the in-memory outbound
  publisher until acceptance is known, and sent to `@repo/editor-realtime`.
- The service validates and accepts transactions against the current
  PostgreSQL revision, then broadcasts accepted transactions for replay.
- A disconnect freezes editing. An explicit retry performs revision catch-up,
  correlates already accepted entries, and resends unresolved entries with
  their original identities. Nothing is durably queued in the browser.
- Complete snapshots and remote operations still pass through the current
  definition-aware validation and canonical runtime boundaries.

## Proposed future behavior

A future offline-capable product layer could persist accepted state and one
active transaction queue in a browser-owned durable store. That layer would
sit outside the generic editor packages and would retain the original editor
transaction identity, semantic operation identity, local ordering, dependency
information, and the accepted base revision.

Conceptually, a durable queue item could contain:

```ts
interface ProposedOfflineTransaction {
  readonly editorTransactionId: string;
  readonly operationId: string;
  readonly localSequence: number;
  readonly acceptedBaseRevision: number;
  readonly operation: EditorOperation;
  readonly dependencies: readonly string[];
}
```

The exact schema, storage technology, and package boundary are intentionally
unspecified because none exists in this repository.

### Proposed reconnect sequence

1. Fetch the authoritative PostgreSQL graph head and accepted transaction
   sequence.
2. Load locally durable pending transactions in local order.
3. Replay them purely over accepted state, rejecting operations whose semantic
   dependencies can no longer be satisfied.
4. Prepare the FIFO head against the current accepted revision and durably
   record the exact physical submission attempt.
5. Send that attempt; uncertain delivery must reuse its identity.
6. On acceptance, atomically advance local accepted state and remove the
   correlated pending transaction.

### Proposed conflict rules

Rebase should operate on canonical identities and semantic placement, never on
array indexes captured from an old graph:

- inserts retain their created block identities and resolve a current semantic
  destination;
- moves require the source subtree to remain live and the destination to remain
  structurally valid;
- deletes are idempotent only when the intended identity has already been
  removed compatibly;
- metadata changes require explicit field conflict policy;
- rich-text updates retain their block-local content-runtime authority;
- dependent operations fail together when an earlier created identity or
  placement can no longer be established; and
- history continues to store editor operations, not database ordering values or
  complete document snapshots.

### Proposed ownership

The generic editor would continue to own semantic planning, validation,
history, and canonical application. A future product persistence adapter would
own durable queue identity, ordering-value allocation, retry policy, and pure
rebase. `@repo/editor-realtime` and the First Draft PostgreSQL acceptance layer
would remain authoritative for accepted revisions.

This design must not be read as a guarantee that current First Draft edits
survive browser closure, network loss, or a failed direct WebSocket
publication.
