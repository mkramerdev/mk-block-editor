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
| Block create, delete, transform, split, merge, move, reparent, and subtree insertion APIs                                          | Compound structural action                                                         | Structural plan -> `applyPreparedGraphTransaction`           |
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

The block-operation API can move and duplicate blocks, but First Draft has no
mounted block drag-and-drop producer. Its visible grip is inert.

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

For supported ordinary Backspace and forward Delete, the block-local DOM plugin
claims `beforeinput`, maps the browser-provided target range to ProseMirror
positions, and dispatches one deletion transaction before contenteditable DOM
mutation. That proposal then follows the same canonical content route shown
above. Composition, structural boundaries, inline-atom keymap handling, and
unusable target ranges remain with their existing owners; the last case falls
back to native DOM mutation and ProseMirror recovery.

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
finalized semantic editor transaction
  -> First Draft transport conversion
  -> direct WebSocket publication
  -> realtime service protocol and transaction validation
  -> PostgreSQL revision check and acceptance
  -> acceptance reply to the sender
  -> accepted transaction broadcast/replay to other clients
  -> remote canonical transaction application
```

`@repo/editor-first-draft/transport` converts graph, metadata, and Yjs content
effects into the current wire transaction. `handleTransaction` sends that
frame only while the captured socket is open; it has no retry queue or durable
browser outbox. The realtime service serializes persistence for a document,
accepts against the current PostgreSQL revision, acknowledges the sender, and
broadcasts an accepted replay to other subscribed clients. Clients apply an
unseen replay through `applyRemoteTransaction`.

Canonical transaction selection is not embedded in the persisted transport
transaction. The First Draft finalized-commit observer publishes the committed
author selection separately through the presence channel. Standalone local
selection settlements use that same presence boundary without creating a
content transaction.

Durable browser outbox storage, offline replay, and SQLite rebasing are not
implemented. A socket that is connecting, closing, closed, or marked failed
causes direct publication to throw.

## Yjs operation boundary

Every existing text block is initialized with an exact canonical projection and
an opaque Yjs checkpoint. The runtime hydrates a block-local `Y.Doc` lazily
from that checkpoint and may release the live context when no lease retains it.

An ordinary local commit prepares canonical operations, plans Yjs mutations,
and mutates the existing block-local `Y.Doc` once. All Yjs update events
captured for that block are merged into the exact effective operation update.
That incremental update is immediately merged with the previously accepted
checkpoint, and the exact prepared canonical result becomes the maintained
read projection. The runtime does not encode the complete live document after
each ordinary edit.

Introduced text blocks must establish an initial complete Yjs state. Subsequent
local operations are incremental. Accepted remote updates are checked against
the current state vector, applied to a live context when present, and merged
immediately into the maintained opaque checkpoint. Context release and later
hydration therefore use a checkpoint that already includes every accepted
update; checkpoint correctness is not delayed until a read request.

All blocks are validated before live application. If an unexpected failure
occurs after live Yjs mutation begins, the runtime does not run reverse
compensation. It marks itself inconsistent and throws a fatal mutation error;
callers must recover from authoritative state rather than assuming rollback.
