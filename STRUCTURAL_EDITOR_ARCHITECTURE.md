# Structural editor architecture

The editor has one canonical path for newly created or imported block content:

```text
selection, import, duplication, or product creation
  -> CanonicalBlockFragment
  -> structural edit composition
  -> editor.transaction
  -> deleteRange / insertBlocks / deleteBlocks / joinTextBlocks
  -> transaction-aware metadata and one final selection intent
  -> one validated canonical commit
```

Clipboard is a boundary around that path:

```text
selection -> CanonicalBlockFragment
          -> application/vnd.repo.editor.blocks+json
             / semantic HTML / plain text

DataTransfer -> custom format / HTML / plain-text negotiation
             -> CanonicalBlockFragment
             -> ordinary structural editing
```

## Detached canonical content

`CanonicalBlockRecord` contains a newly allocated block ID, type, detached
parent, normalized metadata, and—only for text definitions—validated canonical
rich-text content with matching plain text. `CanonicalBlockFragment` contains
the deterministic parent-before-child record order, ordered root IDs, and start
and end boundaries. Roots have no parent, and every descendant parent resolves
inside the fragment.

Validation rejects empty, duplicate, cyclic, unreachable,
definition-incompatible, and wrapper-incompatible graphs. Definition-owned
document validators may reject the complete candidate before publication.

A text boundary is an open content edge eligible for ordinary joining. A block
boundary is a complete structural edge. Fragments contain no transport route,
source identity, selection revision, focus state, or insertion placement.
Selection materialization, import, duplication, and product creation allocate
final identities before insertion. A true move retains existing identities.

## Structural transaction lifecycle

`editor.transaction(callback)` permits one active synchronous draft per editor.
Structural mutations outside it, nested transaction callbacks, and returned
promises fail. The draft combines staged graph, metadata, and rich-text content,
so later calls observe earlier staged work. The callback does not receive the
private draft.

After the callback, final validation checks containment, block definitions,
metadata, wrappers, registered document validators, content, selection targets,
and text bounds. A changed draft commits structure and content once, records at
most one history entry, emits one semantic transaction, and settles one final
canonical selection. A no-op publishes nothing.

Callback, planning, and validation failures discard the draft before live
application. Content runtimes retain their own apply guards. In particular, an
unexpected failure after live Yjs mutation begins is fatal: the Yjs runtime
marks itself inconsistent and does not claim reverse compensation.

The transaction methods have focused ownership:

- `deleteRange` owns range deletion and required structural cleanup.
- `insertBlocks` inserts an already validated fragment at an explicit
  placement and allocates no identities.
- `deleteBlocks` removes non-overlapping complete subtrees with optional parent
  authority checks.
- `joinTextBlocks` joins compatible adjacent text, retains the left block, and
  records the deterministic join offset.
- `updateBlockMetadata` stages validated semantic metadata when a transaction
  is active and otherwise uses its one-shot route.
- `setTransactionSelection` supplies at most one final preserve, clear, block,
  or text-position result, applied only after commit succeeds.

The public methods do not expose raw structural operations or the private
coordinator.

## Clipboard and browser ownership

The web clipboard boundary negotiates the current ID-free custom wire format,
semantic HTML, then plain text. Wire nodes are nested and carry no block IDs;
boundary paths use child indexes. Decoding allocates new records and validates
the complete fragment. HTML is inert and sanitized. Plain text uses the
definition's configured import block type and canonical `\n` line endings.
Central byte, depth, child, block, metadata, and rich-text limits apply.

The mounted selection/clipboard controller captures one authoritative
canonical selection from an editor-owned event target and revalidates it before
mutation. Copy does not mutate. Cut writes clipboard data before opening its
single deletion transaction. Paste completes format negotiation before opening
one delete/insert/join transaction. Once claimed, paste cannot fall through to
a second native or block-local edit.

History and collaboration retain the resulting identities. Undo restores them,
and redo reapplies them without decoding the clipboard payload or allocating
replacement IDs.

## Definitions and block operations

Definitions are product-owned values. Their `kind` selects text, atomic, or
wrapper behavior, and every web definition contains its renderer directly.
There is no renderer registry. Wrapper `content`, `defaultContent`,
`contentBoundary`, underflow, range-deletion, list, compound-wrapper, split,
conversion, and parent constraints are declarative inputs to core planning.

The optional `@repo/editor-web/block-operations` extension exposes typed
single-action methods such as insert, replace, delete, duplicate, move, indent,
and outdent. It is installed once on the First Draft editor instance. Compound
product actions use the base `editor.transaction()` API so their complete
graph/content/metadata plan commits once.

Product-specific structures must be complete before commit. First Draft table
creation, for example, materializes table, row, cell, and column identities as
one valid fragment; a bare generic table block is not a valid substitute.

## Current First Draft producers

The current product surface exposes these source-backed mutation producers:

| Mounted producer                                   | Canonical route                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| Hovered block plus button                          | `editor.insertBlock()` for a paragraph below the block                 |
| Placeholder renderer action                        | `editor.replaceBlock()`                                                |
| Mention menu                                       | Session-scoped inline replacement and atom insertion                   |
| Slash menu                                         | Session-scoped trigger removal plus canonical fragment insertion       |
| Table renderer and table clipboard handlers        | Product planning followed by one editor transaction or metadata update |
| Toggle/list/table block controls                   | Direct metadata updates or installed block commands                    |
| Enter, boundary Backspace, and boundary Delete     | Universal structural behavior                                          |
| Optional Tab and Shift+Tab bindings in First Draft | Block-operation indent/outdent commands                                |

The API also supports delete, duplicate, and move operations, but First Draft
does not currently mount a delete/duplicate/move menu. API capability is not a
claim that a corresponding product control exists.

## Structural keyboard behavior

Enter, boundary Backspace, and forward boundary Delete are universal editable
behavior. Enter uses the core split resolver. Backspace uses the canonical
boundary planner for joins, wrapper cleanup, restorative defaults, and
definition-declared compound-wrapper behavior. Forward Delete uses canonical
navigation, retains the current text block as the survivor, and removes the
next mergeable target with the required cleanup.

Same-block range, character, browser deletion-unit, inline-atom, and hard-break
deletion stay on the block-local content route. Structural commands revalidate
their canonical boundaries before committing.

## Presentation-only product state

First Draft collapse and selected-tab state is presentation-only. One
`FirstDraftViewStateStore` is created for the editor surface and supplied by
`FirstDraftViewStateProvider`. Renderers subscribe through
`useSyncExternalStore`. The generic editor snapshot and canonical selection do
not contain collapse or active-tab fields, and view-state writes create no
editor transaction, history entry, persistence event, or collaboration event.

The current store is in-memory only. There is no SQLite-backed view-state
persistence integration.

## ProseMirror resource ownership

One editable editor owns one `DocumentTextEditingRuntime`, which owns one
`SharedTextEditor`. `SharedTextEditor` owns at most one `EditorView` and exactly
one active block binding:

```text
editable editor
  -> DocumentTextEditingRuntime
     -> SharedTextEditor
        -> zero or one movable EditorView
        -> zero or one active text-block binding
```

The view is created lazily on first text activation. Activating another text
block detaches the prior binding, installs block-local state and props for the
new block, and moves the same view DOM into the new host slot. Individual block
React mounts own host/projection DOM, not separate EditorViews. Inactive blocks
continue to expose exact canonical read projections. Deactivation detaches the
active binding; disposal destroys the shared view. Read editors allocate no
`SharedTextEditor` or ProseMirror view.

## Block drag-and-drop

**Status: absent.** First Draft renders an inert grip glyph with
`draggable={false}`. No pointer, native drag, keyboard drag, preview, or drop
producer is installed. The generic editor contains movement APIs, but no drag
gesture is inferred from them.

If block drag-and-drop is added later, transient gesture, preview, target, and
geometry state should remain product-owned. Only an accepted drop should cross
the typed block-operation boundary and create one canonical transaction. This
is a constraint on future work, not a description of current behavior.

## Resource ownership

| Resource                                                                    | Current owner                            | Lifecycle                                                                                            |
| --------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Manifest, graph, linear history, canonical selection, and transaction draft | One editor controller                    | Created synchronously and released by `editor.dispose()`                                             |
| Content projections, block contexts, checkpoints, and leases                | Selected content runtime                 | Created from startup data; published after accepted commits; released/destroyed by runtime lifecycle |
| Movable ProseMirror view                                                    | Editable document's `SharedTextEditor`   | Created lazily, rebound between active text blocks, destroyed on release/disposal                    |
| Block and text DOM registrations                                            | Mounted `EditorDocument` tree            | Registered by mounts and synchronously unregistered on cleanup                                       |
| Geometry owner and observers                                                | One editor runtime                       | Host attaches on mount; observers and pending invalidation are disposed with the editor              |
| Additional selection manager                                                | Editable editor runtime                  | Updated by remote ingress; absent from read editors                                                  |
| First Draft view state                                                      | One `FirstDraftViewStateStore`           | Retained by the product surface; provider does not initialize the editor                             |
| First Draft WebSocket, remote receiver, and presence attachment             | Mounted `FirstDraftEditorSurface` effect | Created after mount and explicitly disposed on cleanup                                               |

Editor construction does not start persistence or transport. The current First
Draft WebSocket and PostgreSQL work is attached by product/service boundaries,
not by generic editor initialization.
