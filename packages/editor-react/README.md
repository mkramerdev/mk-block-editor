# @repo/editor-react

Platform-neutral React/session package for one active editor. It owns editor
state and canonical-selection orchestration without knowing how the editor was
routed, stored, synchronized, or rendered.

## Public API

Public package entrypoints are owned by `src/api/*` and build to `dist/api/*`.

- `@repo/editor-react` -> `src/api/index.ts`
- `@repo/editor-react/store` -> `src/api/store.ts`
- `@repo/editor-react/selection` -> `src/api/selection.ts`
- `@repo/editor-react/selection-model` -> `src/selection/model/types.ts`
- `@repo/editor-react/editor` -> `src/api/editor.ts`

Implementation code must import concrete source modules directly. It must not import `src/api/*` or the public `@repo/editor-react` subpaths.

## Source Map

- `src/store` - store contracts, session-state helpers, external-store mutation helpers, selectors, and React external-store hooks.
- `src/selection/model` - logical selection types, snapshots, and failure contracts.
- `src/selection/anchors` - text-anchor creation and resolution.
- `src/selection/graph` - selection-target reads and operation-scoped canonical ID traversal.
- `src/selection/normalization` - semantic point/range normalization and range emptiness.
- `src/selection/controller` - selection controller state, invalidation, and drag diagnostics.
- `src/selection/keyboard` - keyboard direction mapping, endpoint movement, and visual-line navigation contracts.
- `src/selection/materialization` - platform-neutral selection-to-`CanonicalBlockFragment` materialization.
- `src/selection/editing` - authoritative resolved edit ranges for structural mutations.
- `src/selection/formatting` - inline mark state and formatting plans.
- `src/runtime/document/api` - public controller contracts and command identities.
- `src/runtime/document/controller` - the concrete Editor implementation, its
  sole linear history array and cursor, the active structural transaction
  draft, graph state, commit coordination, and reconciliation.
- `src/runtime/document/operations` - structural and canonical edit
  composition, operation preparation, and selection effects.
- `src/runtime/inline-content` - inline command planning and execution.

## Boundaries

This package stays platform-neutral. It must not import DOM, React DOM, React
Native, ProseMirror, Yjs DOM, storage, realtime transport, PostgreSQL, app
routes, or product-composition code.

The Editor consumes prepared snapshots from outer layers and emits local operations through caller-provided callbacks. Product, storage, realtime, and routing wrappers attach document identity outside this package.

Selection order is derived when an operation runs from canonical roots and
direct-child sequences. Per-block visuals subscribe to canonical selection coverage;
selection does not retain a flattened or copied document graph. Canonical
structural sequences use copy-on-write updates, so unchanged roots, child
sequences, and block records retain their references across edits,
reconciliation and selection changes.

`getLastChildBlockId(parentId)` reads the final maintained root or direct-child
sequence entry without flattening the document. `insertBlock` accepts an exact
canonical `sequence-end` placement, builds the definition-declared default
subtree, and commits it through one validated structural transaction.

Detached new content has one representation: `CanonicalBlockFragment` from
`@repo/editor-core/editing`. Selection materialization, import, duplication,
and application-created content allocate their final IDs before structural
insertion. `insertBlocks` accepts only that model and never allocates replacement
identities.

`editor.transaction(callback)` installs one synchronous draft. `deleteRange`,
`insertBlocks`, typed `deleteBlocks`, and `joinTextBlocks` require that draft;
`updateBlockMetadata` stages into it when active, and
`setTransactionSelection` supplies at most one final preserve/clear/block/text
selection intent. Later calls observe earlier staged structure, metadata, and
rich-text content. Nested or asynchronous transactions fail. After the
callback, the complete draft is validated once and committed once, producing
at most one history entry, collaboration change, document publication, and
final canonical selection settlement. A callback or mutation failure discards the complete
draft.

Clipboard formats and browser events are deliberately outside this package.
`@repo/editor-dom` owns semantic HTML conversion, and `@repo/editor-web` owns
`DataTransfer` negotiation and browser coordination.

The generic session store contains document-session state only. It does not
contain overlays, block drag, gesture, target, placement, or preview state.
Future block drag-and-drop interaction state belongs to the product UI; only
the accepted semantic structural mutation crosses into the editor API.

History is directly owned mandatory core state. Local edit producers submit
immutable forward/inverse operation data after successful preparation. The
coordinator completes pre-command replay anchors against the pre-command graph
and content before destructive content application, completes post-command
anchors against the prepared result, then commits canonical state and records
one complete entry. Yjs association remains part of those prepared replay
anchors. `editor.undo()` and `editor.redo()` replay through that same executor,
while reactive availability is derived directly from the private cursor. See
[../../HISTORY_ARCHITECTURE.md](../../HISTORY_ARCHITECTURE.md).

The selection controller is the only semantic local-selection authority and
the only owner of selection revision. Final settlement returns `changed`,
`unchanged`, or `rejected`. Native focus belongs to the host browser;
presentation and input-host projections are outputs and never enter this
package as semantic selection proposals. An equal
logical caret is unchanged regardless of opaque anchor encoding. Content
transactions may atomically settle their prepared `selectionAfter`; standalone
publication is not emitted for that transaction-owned settlement. Changed
`standalone-local` settlements publish once through the controller-owned
settlement stream; silent reconciliation, remote application, transaction
settlement, and unchanged state publish nothing.

## Validation

Run these after API or domain changes:

```bash
pnpm --filter @repo/editor-react check-types
pnpm --filter @repo/editor-react test
pnpm --filter @repo/editor-web check-types
pnpm --filter @repo/editor-first-draft check-types
```

## Dependencies

- `@repo/editor-core` - block model contracts and pure commands.
- `react` (peer) - `useSyncExternalStore`.
