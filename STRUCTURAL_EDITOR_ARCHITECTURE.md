# Structural editor architecture

The editor has one new-content path:

```text
selection or imported content
  -> CanonicalBlockFragment
  -> ordinary structural composition
  -> editor.transaction
  -> deleteRange / insertBlocks / deleteBlocks / joinTextBlocks
  -> transaction-aware metadata and one final selection intent
  -> one validated commit
```

Clipboard is a boundary around that path:

```text
selection -> CanonicalBlockFragment
          -> application/vnd.repo.editor.blocks+json
             / semantic HTML / plain text

DataTransfer -> current custom format / HTML / plain-text negotiation
             -> CanonicalBlockFragment
             -> ordinary structural editing
```

## Detached canonical content

`CanonicalBlockRecord` contains a newly allocated block ID, type, detached
parent, normalized metadata, and—only for text definitions—validated canonical
rich-text content with matching plain text. `CanonicalBlockFragment` contains
the deterministic parent-before-child record order, ordered root IDs, and two
boundaries. Roots have no parent and descendant parents resolve only inside the
fragment. Validation rejects empty, duplicate, cyclic, unreachable,
definition-invalid, and wrapper-invalid graphs. Definition-owned,
feature-neutral document validators may additionally reject a complete
candidate before it is published.

A text boundary is an open content edge eligible for ordinary text joining. A
block boundary is a complete structural edge. Complete text content therefore
remains distinguishable from a complete text block without coverage or
transport metadata. Canonical fragments never contain source identities,
selection revisions, clipboard provenance, focus, or insertion placement.

Every producer returns this exact model. Selection materialization, import,
duplication, and application creation allocate their final IDs before
insertion. Insertion preserves those IDs. A true move is not content creation
and moves live records without changing their identities.

## Transaction lifecycle

`editor.transaction(callback)` permits one active synchronous draft per editor.
Structural mutations outside it, nested callbacks, and returned promises fail.
The draft combines staged graph, metadata, and rich-text content so each later
mutation observes all earlier work. The public callback never receives the
draft.

After the callback, final validation reads staged content and validates
containment, definitions, metadata, wrappers, registered document validators,
selection targets, and caret bounds.
A changed draft commits structure and content once, creates one undo entry,
publishes one collaboration change and one document update, and settles one
final canonical selection. A no-op publishes nothing. Callback, mutation,
validation, content application, or commit failure discards the whole draft;
existing content rollback protects against partial external application.

`deleteRange` owns range deletion and required structural cleanup.
`insertBlocks` owns atomic insertion of an already validated canonical
fragment at an explicit placement and allocates no IDs. `joinTextBlocks` owns
compatible adjacent text concatenation, keeps the left identity, removes the
right record, and records the deterministic join offset. Shared composition
decides placement, surviving boundaries, joins, normalization, and final
caret, but is not another mutation or commit path.

`deleteBlocks({ blockIds, includeDescendants: true, expectedParents? })`
deletes one or more non-overlapping complete subtrees with typed identity and
optional parent-authority checks. `updateBlockMetadata` uses its ordinary
one-shot route outside a transaction and stages validated semantic metadata
inside one. `setTransactionSelection` records at most one final preserve,
clear, block, or text-position outcome; it is applied only after commit succeeds.
None of these methods exposes raw structural operations or the private
transaction coordinator.

## Clipboard and browser ownership

The web clipboard boundary negotiates the current ID-free custom wire format,
semantic HTML, then plain text. Wire nodes are nested and carry no IDs;
boundary paths address child indexes. Decoding allocates records as it descends
and validates the completed canonical fragment. HTML is inert, sanitized,
semantic content with no hidden editor state. Plain text uses the composition's
configured text definition and canonical `\n` line endings. All inputs obey
central byte, depth, child, block, metadata, and rich-text limits. Product
clipboard codecs may impose additional feature-specific limits before
returning a canonical fragment.

`useGlobalSelection` establishes one editor owner, captures the authoritative
canonical selection from an exact editor-owned event target, calls the
clipboard boundary, revalidates the capture, and coordinates post-commit paint
and any separately requested native presentation. It does not parse data or
construct records. Copy performs no mutation. Cut writes before opening its
single deletion transaction. Paste completes format negotiation before opening
its single delete/insert/join transaction. A claimed paste cannot fall through
to a second native or block-local edit path.

History and collaboration store the resulting operation, including its new
record IDs; undo restores original identities and redo reapplies the same new
identities without decoding or allocating again.

Definitions are plain product-owned `BlockDefinition` values. Text behavior,
atomic behavior, and wrapper behavior are selected by the definition's `kind`.
Wrapper definitions declare structural children. Every definition directly
references its renderer;
there is no renderer registry.

Wrapper `content` is structural. Exact expressions require exactly those
direct children in order. Repeated expressions require one or more accepted
children. `defaultContent` lets the canonical recursive creator construct a
complete subtree and gives later cleanup enough information to restore a
qualifying atomic replacement default. Definition `data` is opaque to the
generic editor.

Product creation, slash insertion, replacement, paste/import, duplication, and
indentation all compose the same creation/navigation/transaction APIs. A
transaction is fully planned and validated before mutation, commits as one
observable update and undo item, and applies canonical selection only after the
graph and content exist.

The ordinary editor API exposes an O(1) terminal direct-child read and exact
sequence-end block insertion. Exact insertion validates the supplied parent and
resulting direct-child sequence, creates the definition-declared default
subtree, and commits selection and structure in one canonical transaction. It never
searches outward for another boundary.

Product-owned controls may use those operations to implement focus-or-insert
policy. Such controls remain outside canonical traversal and have no block
identity, ordering, persistence, realtime, selection, or undo representation.

## Future product-owned block drag-and-drop

Block drag-and-drop is currently absent. It is not installed through
`EditorDefinition`, generic command IDs, editor-web document layers, or the
editor-react session store. Editor-web owns neutral mounted block rendering and
the block DOM registration needed by existing generic infrastructure.
Product-web owns the visible grip handle; until a real interaction is
implemented, that handle remains product-owned and inert.

The future implementation belongs in a product-owned interaction module,
conceptually
`packages/editor/product/product-web/src/product-ui/interactions/block-drag-and-drop/`.
No empty scaffold or parallel implementation is required before that work
begins. The expected flow is:

```text
product drag handle
  -> product establishes a valid gesture
  -> product-local transient drag session
  -> product measures mounted block geometry
  -> product resolves source, target, and placement
  -> product shows a local preview
  -> user accepts the drop
  -> product calls one typed public structural editor method
  -> normal editor transaction pipeline
  -> history, persistence, realtime, and notification
```

### Product interaction responsibility

The product decides which blocks display handles; whether one block, multiple
blocks, or a complete subtree is dragged; pointer activation thresholds; native
HTML drag-and-drop versus a custom pointer gesture; pointer capture where
applicable; drag image or preview; target geometry; before, after, or inside
placement; container-specific and product-specific invalid targets;
auto-scroll; RTL policy; copy modifiers; cross-editor and cross-document
behavior; cancellation; product-local preview state; ARIA state and
announcements; keyboard-accessible movement; focus preservation;
stale-gesture validation; and block projection mount/unmount handling.

These policies and their transient source, target, geometry, and preview state
must not enter editor-react or editor-web core state. Pointer or keyboard
navigation updates product-local preview only and performs no editor mutation.

### Editor structural responsibility

An enriched product editor owns singular drag results through the final typed
block-operation surface:

```ts
editor.moveBlock({
  blockId,
  destination,
});

editor.duplicateBlock({
  blockId,
  destination,
});
```

An action involving several independent roots is a product-owned compound
planner. It validates the complete target graph and commits one complete plan
through `editor.transaction()`; it does not loop over singular editor methods.

The enriched method validates current identities, rejects tombstoned blocks,
cyclic placement, incompatible parents/children, and stale structural
authority, then invokes its canonical planner and the existing transaction
coordinator. Movement retains the same block and descendant identities;
duplication allocates new identities before commit. One accepted action owns
one history entry, undo/redo, persistence and collaboration publication,
transaction notification, and final selection/focus settlement.

Product interaction code must not call private coordinator or implementation
methods, runtime service discovery, generic command dispatch, Yjs mutation
APIs, persistence writers, or history recorders.

### Browser event ownership

Event ownership follows this order:

```text
identify product drag handle
  -> verify interaction is enabled
  -> verify the source block is valid
  -> establish a real drag gesture
  -> only then claim the browser event
```

A pointer press alone does not necessarily become a drag. Before ownership, the
product verifies a primary pointer/button, a valid source block, a supported
block type, a valid mounted handle, enabled product interaction, no conflicting
specialized interaction, and available required measurement. Only after those
checks and gesture activation may it call `preventDefault`, stop propagation if
actually required, capture the pointer, suppress editor focus changes, or start
preview state.

Escape belongs to the product only while an active product drag session exists,
before configurable keybindings or editor fallbacks run. Event ownership must
not use `event.defaultPrevented`, a `WeakSet`, or custom browser-event
properties as an internal protocol.

### Accepted-drop transaction

An accepted drop produces exactly one semantic structural transaction:

```text
pointer or keyboard navigation
  -> product-local preview only

accepted drop
  -> one typed structural editor call
  -> one graph transition
  -> one history entry
  -> one persistence publication
  -> one realtime publication
  -> one transaction notification
```

Cancellation produces no editor transaction. Stale source or destination
authority rejects the complete operation. Copying a subtree allocates final
block IDs before commit and replay never allocates duplicate IDs. Moving a
subtree preserves content and metadata without rewriting unrelated blocks.

Structural editing traverses the complete live canonical graph in canonical
child order. Every text and atomic descendant participates, including content
that is currently collapsed, hidden, unmounted, or in an inactive tab pane.
Toggle collapse and tab selection are presentation-only state; renderers do not
publish command edges or alter canonical selection meaning.

That presentation state is owned by one product-local external store per editor
view. Collapsed IDs and selected direct tab-pane child IDs are sparse: absence
means expanded or the first current pane. Product renderers subscribe through a
`ProductEditorViewStateProvider`; the generic editor, its snapshot, and its
session store have no collapse or active-child fields. A presentation write
therefore cannot advance document or selection revisions, publish a semantic
transaction, or create an undo entry.

The provider receives an explicit store and neither initializes nor disposes
the editor. Initial rendering uses synchronous sparse defaults. A separate
commit-scoped product integration then loads SQLite, merges the authenticated
user/document PostgreSQL snapshot while preserving dirty local keys, and
applies the result. The in-memory store still has no database or history
behavior; SQLite dirty/deletion state and PostgreSQL current values are owned
by explicit repositories behind the integration.

Adjacent outward insertion reads `contentBoundary` directly from authoritative
wrapper definitions. Navigation descends into canonical following wrappers,
but stops before considering a placement above a content boundary.
The focused text definition still owns the split result type; a boundary only
constrains placement.

Enter, Backspace, and forward Delete are core editing behavior installed for every definition;
they do not depend on the optional block-operation editor extension. Enter uses one
split resolver for start, middle, and end. Parent split-map
overrides apply only when default placement leaves the text block's direct
parent. Backspace uses one boundary planner for canonical joins, structural
cleanup, restorative defaults, and definition-declared compound-wrapper
unwrapping. Forward Delete uses direction-neutral canonical navigation, keeps
the current text block as survivor, removes the next mergeable text target
with definition-declared cleanup, and retains the original end caret.
Same-block range, character, grapheme, inline-atom, and hard-break deletion
remain block-local content-runtime behavior. A compound wrapper declares its primary text child, promoted content
wrapper, and empty-primary removal policy as validated data; generic planners
contain no product block type names.

### Optional block-operation routing

Product editor construction applies `addEditorBlockOperations()` once and
retains that exact editor object throughout rendering. Singular product
actions call the resulting typed methods directly:

```text
product action
  -> insertBlock / replaceBlock / deleteBlock / duplicateBlock
  -> moveBlock / indentBlock / outdentBlock
  -> canonical planner
  -> one editor transaction
  -> private transaction coordinator
```

Compound actions remain with the feature that owns their invariants:

```text
product planner
  -> complete graph/content/metadata/focus plan
  -> one editor transaction
  -> private transaction coordinator
```

The current production routes are:

| Producer                                                         | Route                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Block plus control                                               | `editor.insertBlock()`                                                                                                    |
| Placeholder replacement                                          | `editor.replaceBlock()`                                                                                                   |
| Add tab pane                                                     | one `editor.insertBlock()` that materializes the complete definition-declared pane subtree and supplied tab metadata      |
| Container-end insertion                                          | product-owned canonical paragraph fragment at the explicit empty/end boundary                                             |
| Slash singular creation or replacement                           | product canonical fragment planner, then session-scoped trigger removal, fragment insertion, and focus in one transaction |
| Slash table creation                                             | product table fragment planner, then session-scoped trigger removal, fragment insertion, and focus in one transaction     |
| Table row, column, cell-clear, paste, and multi-cell cut actions | product table planners and one compound transaction                                                                       |
| Column resizing and other complete metadata actions              | one deliberate metadata batch                                                                                             |
| Enter, Backspace, and forward Delete                             | universal core structural routes                                                                                          |
| Tab and Shift+Tab                                                | explicitly installed optional block-operation commands calling `indentBlock()` or `outdentBlock()`                        |

The visible product drag glyph is inert and no delete, duplicate, move, or
indent menu is currently mounted, so those are not mutation producers.
Introducing such controls requires direct typed editor-method calls; the glyph
must not imply a hidden alternate drag route.

`blockOperationCommands` and `blockOperationKeybindings` belong only to
`@repo/editor-web/block-operations`. Product definitions opt into the two
commands and the `Tab`/`Shift-Tab` bindings explicitly. Generic mounted editing
does not import that entrypoint and continues to own only universal Enter,
Backspace, and forward Delete behavior.

Product-specific structures must be complete before commit. In particular, a
table is created by the product table planner with table, row, cell, and column
identities; a bare generic `table` block creation request is invalid. Trigger
removal and structural insertion are one transaction, and compound actions are
never decomposed into several enriched editor calls.

Slash overlays retain the source range and read their viewport anchor through
the mounted document geometry owner. The shared invalidation lifecycle
repositions the overlay as layout or scroll changes; the overlay owns only its
floating-panel collision layout. Menu state does not recreate the document
runtime. Command execution captures the source once, dispatches once, commits
one transaction, then closes according to the typed command result.

To add a block, add a product renderer and one definition to the product's
ordinary definitions object, then add
whatever product action exposes it. Do not add a generic block-type switch or a
separate constructor.

## Resource ownership

Editor construction is synchronous and may be evaluated for render work that
React later discards. Construction may therefore create only editor-local,
garbage-collectable resources. External integrations start after commit and
stop synchronously; no timer or microtask distinguishes Strict Mode verification
from a real unmount.

| Resource                                                                                                            | Creation location                                                             | Externally observable                                                                  | Runtime owner                             | Setup and cleanup                                                                                                                                                                                                                                                                                         | Reversible setup-cleanup-setup | Discarded construction                                                          |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| Manifest, session store, linear history array/cursor, compiled definition, content runtime, and local Yjs documents | `EditorImplementation`, `initialize-editor.ts`, and content runtime factories | No                                                                                     | One editor                                | Constructed synchronously; history cannot be installed or replaced; core cleanup registrations drain in reverse order only by explicit `editor.dispose()`                                                                                                                                                 | Not mounted integrations       | Isolated object graph is garbage-collected                                      |
| Selection controller and its projected and canonical reader facades                                                 | `initialize-editor.ts`                                                        | No                                                                                     | One editor                                | Editable and read-only editors own canonical local selection directly; mounted projections subscribe only for state rendering and interaction                                                                                                                                                             | No effect-owned lifecycle      | A discarded controller is isolated and garbage-collected                        |
| Primary semantic transaction callback                                                                               | `useEditor({ onChange })` and `initialize-editor.ts`                          | Yes, on a finalized local transaction                                                  | One editor                                | Installed synchronously for the first transaction; a render-time internal ref observes callback updates without a public subscriber or effect-registration window                                                                                                                                         | Not effect-owned               | A discarded editor has no transaction to publish                                |
| Product collapse and selected-tab view state                                                                        | Product editor composition                                                    | No; the store is a local map/set and listener collection                               | One product editor view boundary          | Retained external store supplied by `ProductEditorViewStateProvider`; provider mount/unmount does not reset it                                                                                                                                                                                            | Yes                            | An uncommitted local store is garbage-collected                                 |
| Product view-state persistence                                                                                      | Product provider's internal persistence effect                                | Yes: SQLite reads/writes, authenticated HTTP, window online/focus/visibility listeners | One storage/user/document effect instance | The provider receives explicit dependencies; its effect constructs/starts a controller, while cleanup aborts requests and detaches listeners synchronously. A Strict Mode second setup creates a fresh controller over the same retained store                                                            | Yes                            | No repository I/O or browser listener starts during render                      |
| ProseMirror views and block-local DOM listeners                                                                     | Mounted block React/DOM modules                                               | Yes, while mounted                                                                     | The exact mounted view or effect          | Created after commit; destroyed or unsubscribed synchronously by their mount/effect cleanup                                                                                                                                                                                                               | Yes                            | Never started                                                                   |
| Document geometry observers, registrations, listeners, and pending invalidation frame                               | Editor-owned document geometry owner                                           | Yes, while mounted                                                                     | One editor runtime                        | Created during read/edit initialization; the mounted document attaches its host and all geometry consumers share the reader. Block-internal table selection follows table layout without geometry. Disposal cancels the frame, disconnects observers, removes listeners, and clears registrations and subscribers | Yes                            | Never started                                                                   |
| Direct document layers                                                                                              | Product `renderDocumentLayers` composition under the editor document host     | Yes, while mounted                                                                     | One mounted editor document               | Normal in-tree React ownership and cleanup; layers receive the public editor and read-only geometry reader and create no geometry observer lifecycle                                                                                                                                                      | Yes                            | Never started                                                                   |
| Additional selection manager                                                                                        | Editable editor runtime                                                        | No; logical stable/resolved records only                                                | One editable editor                       | Remote ingress and authoritative replacement update one session-keyed manager; focused subscribers are notified synchronously and editor disposal clears it                                                                                                                                                 | Yes                            | Not allocated                                                                   |
| Realtime connection store                                                                                           | Product `realtime/connection.ts`                                              | Yes                                                                                    | `useSyncExternalStore` subscription       | First subscriber connects; last unsubscribe synchronously clears timers/subscriptions and disconnects                                                                                                                                                                                                     | Yes                            | No subscription means no connection                                             |
| Outbox service                                                                                                      | Product `mounted-integrations.tsx`                                            | Yes: browser listeners, retry timers, and remote submissions                           | Committed mounted integration             | `start()` in effect setup; `stop()` in cleanup removes listeners and timers                                                                                                                                                                                                                               | Yes                            | Constructed service has not started                                             |
| Accepted outcome pipeline                                                                                           | Product `mounted-integrations.tsx`                                            | Yes during remote/SQLite startup and accepted-state work                               | Committed mounted integration             | `start()` begins startup; `stop()` aborts that start synchronously. A later `start()` reuses loaded local state or creates a fresh cancellable attempt                                                                                                                                                    | Yes                            | Constructed stores/coordinators have performed no I/O                           |
| Local database provider and injected transport clients                                                              | Application composition                                                       | Yes                                                                                    | Application/provider boundary             | Created and disposed outside editor construction                                                                                                                                                                                                                                                          | Owner-defined                  | The editor only retains injected references in product integrations after mount |

Editor construction owns only core editor-local state and subscriptions. It
must not import or start persistence, realtime, WebSocket, fetch, workers, or
browser-global ownership. Persistence remains product observation policy
outside editor construction.
