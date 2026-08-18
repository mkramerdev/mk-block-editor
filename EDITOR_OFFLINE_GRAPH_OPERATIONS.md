# Offline Block Graph Operations

## Goal

Offline block graph edits must not replay as full snapshot overwrites.

Block content can use Yjs binary updates for mergeable text/content state, but block graph operations need their own operation-log and rebase model.

Block graph operations include:

- block creation;
- block deletion;
- block move/reorder;
- parent/container changes;
- one-field metadata updates that affect graph behavior.

## Offline Flow

The Editor first applies a semantic graph operation using
`{ parentId, childIndex }`. After the operation is coherent, it emits the
resolved neighboring sibling IDs. The product persistence adapter uses that
short-lived gap description to allocate its own persistent ordering value.

The product writes the resulting semantic transaction once, as an active
SQLite outbox transaction. That row is both the crash-recovery input and the
future transport unit; the editor does not retain a pending-operation list and
SQLite does not duplicate the operation in a second queue:

```ts
interface ActiveEditorOutboxTransaction {
  outboxEntryId: string;
  editorTransactionId: string;
  operationId: string;
  localSequence: number;
  operation: EditorCommitOperation;
  dependencies: readonly string[];
  selectionRevision: number;
  selectionBefore: EditorTransactionSelection;
  selectionAfter: EditorTransactionSelection;
}
```

On reconnect:

1. Fetch the current Postgres block graph head.
2. Load active outbox transactions from SQLite in local order.
3. Purely replay them over accepted state to reconstruct visible state and
   reject irreconcilable dependency chains.
4. Prepare the FIFO head against the current accepted revision and durably
   store its exact commit identity, submission JSON, and hash.
5. Lease and send that exact attempt; uncertain delivery reuses it.
6. Apply the accepted record and remove its correlated outbox transaction in
   one SQLite transaction.

## Required Conflict Rules

Create block:

- block id must be stable across offline/replay;
- if the target parent still exists, insert by recorded intent;
- if the target parent was deleted, either reject the operation or move it to an explicit fallback location.

Delete block:

- deletion must be idempotent;
- tombstones should be used so concurrent content edits and moves can be resolved deterministically;
- if the block was already deleted remotely, the local delete can become an accepted no-op.

Move/reorder block:

- replay accepted product rows through the product startup adapter to rebuild
  explicit Editor root and child sequences;
- apply the recorded forward or inverse structural `EditorOperation` through
  the ordinary operation executor against the current Editor graph;
- allocate a fresh product ordering value for every newly emitted placement;
- if the moved block was deleted remotely, reject or no-op the move.

Content edits for deleted blocks:

- if graph tombstone wins, content updates for that block must be ignored or rejected;
- do not resurrect deleted blocks from content updates alone.

Concurrent product creates at the same position:

- order deterministically in the persistence layer using its ordering value
  plus a stable tie-breaker such as `{clientId, clientSequence}`.

Metadata changes:

- use explicit field-level merge rules where possible;
- otherwise use a documented last-writer or conflict policy.

## Source Commit Rules

Postgres should reject stale graph commits unless they can be safely applied.

On stale rejection:

1. storage fetches the latest graph head;
2. storage rebases queued outbox transactions;
3. an exact-base rejection releases only that rejected physical attempt,
   preserves the original editor transaction and semantic operation IDs, and
   prepares a new commit ID after accepted catch-up;
4. storage retries only transactions that pure replay still accepts;
5. unsafe operations and their dependent chains leave the active outbox and
   are surfaced to the editor/product.

## Ownership

`storage-sqlite` owns accepted state and the active outbox. SQLite is the
authority; replay is pure and ordinary replay status is not persisted.

The generic Editor owns semantic placement, graph validation, and its single
linear operation-pair history. Product persistence owns ordering-value
allocation, outbox transaction identity, rebase rules, and deterministic
conflict handling.

Structural commands, undo, and redo all apply `EditorOperation` values through
the ordinary atomic operation executor. Subtree removal, restoration, and
replacement are single reductions; history stores only the affected operation
data and never persistent ordering values or complete document snapshots.

Complete snapshots enter through one mandatory definition-aware validation
pipeline. Product row ordering may materialize the semantic snapshot, but it
cannot waive generic containment, definition, metadata, inline-content, or
structural invariants.

Local publication ordering is atomic document/selection settlement, history
recording and availability update, semantic `onChange`, then product persistence
conversion.

`demo-postgres` owns source-of-truth revision checks and commit acceptance/rejection.

`product-web` must not contain offline graph replay, rebase, or conflict-resolution logic.
