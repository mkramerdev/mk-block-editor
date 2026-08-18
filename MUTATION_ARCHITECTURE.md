# Editor mutation architecture

Every accepted local change uses an explicit content or graph route:

```text
content proposal or semantic content action
  -> forward canonical operations
  -> commitPreparedContentTransaction
  -> content runtime prepare/apply/release

graph, metadata, or structural action
  -> typed internal transaction plan
  -> applyPreparedGraphTransaction

compound product action
  -> editor.transaction
  -> stage typed public structural/content operations against one preview
  -> applyPreparedGraphTransaction
```

The public mutation surface is deliberately narrow:

```text
Editor
|-- transaction
|   |-- insertBlocks
|   |-- deleteBlocks
|   |-- deleteRange
|   |-- joinTextBlocks
|   |-- updateBlockMetadata
|   `-- setTransactionSelection
|-- insertText
|-- deleteText
|-- updateMark
|-- updateInlineAtom
`-- updateBlockMetadata
```

The singular methods represent one complete semantic action.
`transaction(callback)` composes typed semantic structure and metadata against
one preview and accepts one final canonical selection intent. Calls made inside that callback
only extend the prepared plan; they do not independently commit, record
history, publish, or notify. Structural planners validate graph structure and
product-level intent before invoking the graph coordinator. Content producers
submit forward operations; the content runtime preparation boundary validates
their canonical meaning and derives history inverses. The internal logical and
structural operation unions are not public dispatchers.

## Canonical transaction language

Structural planners produce graph changes plus ordered content operations
grouped by block:

```text
structural planner
|-- graph changes
`-- per-block ordered logical content operations
```

Each block has at most one operation batch in a transaction. Operations inside
that batch execute in order, so later coordinates are interpreted against the
intermediate content produced by earlier operations. Duplicate block batches,
empty batches, invalid ranges, unavailable blocks, invalid marks or atoms, and
content incompatible with the resulting block definition are rejected before
publication.

The same precise operation language is used by public semantic planners,
ProseMirror proposals, structural planners, compound product actions, history,
persistence, replay, and the local and Yjs runtimes. Structural transaction
payloads contain no alternative content mutation format. Persisted operations
with any other structural content field are invalid.

Introduced text blocks obtain default initial content from their resulting
block definition. A planner supplies logical operations only when that default
must change. Removed blocks retain their exact prior canonical content in the
inverse transaction, so undo restores text, marks, hard breaks, atoms, graph
placement, and selection atomically.

## Local mutation producer inventory

| Producer                                                                                                                           | Action                                                                             | Final route                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| ProseMirror typing, deletion, replacement text, autocorrect, dictation, finalized IME, hard breaks, stored marks, and inline atoms | One complete forward-only proposal, potentially compound                           | `commitPreparedContentTransaction`                           |
| Mark toolbar                                                                                                                       | Singular explicit final mark state                                                 | `updateMark()` -> `commitPreparedContentTransaction`         |
| Direct plain-text insertion/deletion and direct atom changes                                                                       | Singular                                                                           | Typed public method -> `commitPreparedContentTransaction`    |
| Mention acceptance                                                                                                                 | Compound trigger replacement, atom insertion, optional trailing content, and caret | Ordered inline plan -> `commitPreparedContentTransaction`    |
| Slash acceptance                                                                                                                   | Compound trigger removal plus graph/content change                                 | Structural plan -> `applyPreparedGraphTransaction`           |
| Cut, rich paste, multi-block paste, and multi-block replacement                                                                    | Compound graph/content composition                                                 | Canonical edit composition -> graph coordinator              |
| Block create, delete, transform, split, merge, move, reparent, drag/drop, and subtree insertion                                    | Compound structural action                                                         | Structural plan -> `applyPreparedGraphTransaction`           |
| Product-owned table and column structure                                                                                           | Compound graph/content/metadata action                                             | Typed public Editor transaction -> graph coordinator         |
| Block metadata                                                                                                                     | Singular or multi-block batch                                                      | `updateBlockMetadata()` -> `applyPreparedGraphTransaction`   |
| Content undo and redo                                                                                                              | Stored forward or inverse content plan                                             | `commitPreparedContentTransaction` without history recording |
| Graph undo and redo                                                                                                                | Stored forward or inverse graph plan                                               | `applyPreparedGraphTransaction` without history recording    |
| Remote Yjs ingress                                                                                                                 | Authoritative remote update                                                        | Dedicated remote runtime route                               |
| Startup, hydration, recovery, and replay                                                                                           | Authoritative state materialization                                                | Internal reconciliation/replay route                         |

Product sources and renderers do not receive the concrete coordinator or
content-runtime application methods. Feature code may prepare immutable typed
plans, but it does not own commit execution, history, persistence, or
notification.

Product table mutations follow the final ownership path:

```text
product table UI
  -> product validates the interaction
  -> product-local pure table planner
  -> canonical product table plan
  -> typed public Editor methods
  -> one editor transaction
  -> complete-candidate validation
  -> history
  -> persistence
  -> collaboration
  -> transaction notification
  -> final canonical selection
```

Product validation is supplied through the feature-neutral document-validator
boundary. Product clipboard codecs and block-internal selection subsystems are
explicit semantic contributions. Generic packages neither import product table
code nor inspect product table schema or DOM markers.

## Content preparation and settlement

```text
forward content operations
  -> capture base document revision and one canonical selection snapshot
  -> prepare isolated working content
  -> validate graph/content revisions, bases, syntax, applicability, reversibility,
     and normalized results
  -> retain effective forward operations and derive reverse-order inverses
  -> validate prepared selection against post-edit content
  -> reject an effective no-change
  -> apply with compare-and-swap guards
  -> materialize required post-edit selection anchors
  -> allocate transaction identity and advance document revision once
  -> settle canonical selection
  -> record history from applied forward/inverse operations
  -> lazily derive public selection projections
  -> emit one CanonicalEditorCommit with ephemeral local provenance
  -> reconcile trigger state and finalize one web semantic transaction
  -> release the applied commit and notify content projections
```

Preparation is the substantive content-validation boundary in both the local
and Yjs runtimes. It applies operations to isolated working content and rejects
the complete input if any effective operation is invalid, inapplicable, or has
no inverse. Undo/redo rebasing records and inverts the effective operation that
will actually be applied.

Application retains optimistic-concurrency responsibility. Prepared handles
are runtime-owned and single-use; apply rechecks graph/content revisions,
introduced and removed blocks, and Yjs state vectors where applicable. A stale
handle cannot overwrite newer canonical content.

The transaction ID is allocated only after preparation, prepared-selection
validation, no-change detection, application, and required anchor
materialization succeed. Rejections and no-ops consume no identity. The one
pre-edit canonical selection snapshot supplies public, history, and
block-internal representations lazily. Selection and history settle before the
canonical receipt is emitted, and the runtime releases content only after that
publication returns.

Local typing provenance is immutable transaction context. Content proposals
carry it through proposal acceptance; committed/global selection replacement
and composition carry it through structural transaction coordination. It is
present only on the internal canonical receipt and is absent from operations,
history, checkpoints, snapshots, public semantic changes, Yjs updates, and
remote payloads. Undo, redo, remote ingress, metadata commands, and
programmatic mutations use `provenance: null`.

Definitions with no typing triggers construct no trigger-session controller.
Their active text views install no trigger-provenance listener, pending record,
timer, or proposal consumer. Trigger-enabled views use a task-bounded
beforeinput bridge. The bridge accepts trusted text, replacement, and dictation
edges, survives microtasks in the current task, expires at the next task, and
is consumed once by the next document-changing proposal. Trigger reconciliation
runs from finalized receipt provenance after selection and history
settle and before the public callback.

Graph and metadata work has a separate `applyPreparedGraphTransaction` path.
No graph state is published before content preparation succeeds, and no content
is published before graph validation succeeds. A transaction with no graph,
metadata, content, or selection change creates no history, publication, or
notification.

ProseMirror transactions are never decomposed into public API calls. The
adapter derives ordered forward operations and prepared `selectionAfter`; it
does not determine history or reversibility. Remote Yjs updates remain
runtime-specific authoritative input; hydration, replay, undo, and redo do not
simulate public semantic calls.

The adapter never installs a proposed content state before canonical
acceptance. It returns the exact proposed state when canonical content matches,
or a newly projected canonical state after normalization or rejection.
`applyBlockTransaction` is the sole installer of that final disposition state.

Editor-web owns `finalizeCanonicalEditorCommit`, the only construction boundary
for public `EditorSemanticChange`. Content receipts already contain previous and
committed read projections, effective forward operations, inverse operations,
operation updates, and requested checkpoints. Content block-slice finalization
uses those applied values and reads only graph shell information from canonical
state; it does not reread the just-committed content or checkpoint.

## Persistence and collaboration consequences

Durable adapters observe the committed semantic transaction boundary. They do
not observe React rendering, native-focus transitions, text-projection activation,
ProseMirror attachment, browser selection, or additional selection presentation:

```text
committed canonical transaction
  -> one semantic transaction notification
  -> product semantic transaction conversion
  -> one SQLite transaction updating projection and active outbox
  -> writer and realtime publication
  -> PostgreSQL acceptance
  -> accepted-outcome reconciliation
```

The active outbox retains the original editor transaction identity. Accepted
application records the canonical effects and ledger row, removes a correlated
local outbox row, satisfies remaining dependencies, and updates projection
authority in one SQLite transaction. The runtime uses the returned correlation
to acknowledge the original editor transaction; a remote acceptance is never
classified as local merely because it affects the same document.

Transaction-owned `selectionBefore` and `selectionAfter`, plus their shared
selection revision, travel with the durable outbox submission and its live
accepted sidecar. The PostgreSQL accepted commit ledger remains content-only.
Standalone local selections continue through the document interaction
boundary and standalone live transport; they are not duplicated by content
transactions.

## Yjs operation boundary

Canonical snapshots remain the source of initial block content. A block
created from a snapshot has a disposable local Yjs projection until its
causal base has been checkpointed or published. Its first local operation
contains the projection bootstrap plus the incremental edit, making the
operation independently applicable by persistence, realtime, and a freshly
hydrated client. Later operations contain only causal increments.

Likewise, the first authoritative remote operation replaces an unpublished
disposable projection instead of merging two independently generated Yjs
histories. Once that remote base is adopted, subsequent updates apply
incrementally. This replacement is internal to the canonical content runtime;
it neither creates a ProseMirror view nor emits a local operation, history
entry, persistence write, or realtime echo.

Checkpoint hydration marks its causal base as already published. Compensation
restores both canonical content and base-publication state if an atomic editor
transaction fails.
