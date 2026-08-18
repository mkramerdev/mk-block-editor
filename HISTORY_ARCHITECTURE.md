# Editor history architecture

Every `EditorImplementation` owns exactly one bounded linear history. History is
constructed synchronously with the editor, cannot be installed or replaced, and
is released with the editor instance.

```ts
interface EditorHistoryEntry {
  readonly forward: EditorOperation;
  readonly inverse: EditorOperation;
  readonly selectionBefore: EditorHistorySelection;
  readonly selectionAfter: EditorHistorySelection;
}
```

The private representation is one array and one cursor:

```ts
private history: EditorHistoryEntry[] = [];
private historyIndex = 0;
```

Entries before `historyIndex` are applied. Entries at and after the cursor form
the redo tail. The invariants are:

```text
0 <= historyIndex <= history.length <= maximumHistoryEntries
canUndo === historyIndex > 0
canRedo === historyIndex < history.length
```

`editor.undo()` applies the preceding entry's inverse and
`editor.redo()` applies the entry at the cursor. Both use the same ordinary
operation executor used by local edits. The cursor moves only after successful
atomic application. Empty, failed, and reentrant commands leave the document,
selection, history, and availability unchanged.

## Operation and recording boundary

`EditorOperation` is the immutable replay format for structure, rich text,
metadata, and ordered composites. History does not interpret an operation,
calculate its inverse, observe transactions, or restore a document snapshot.

A content edit producer supplies forward canonical operations. Content-runtime
preparation validates and applies them to isolated working content, retains the
effective forward operations, and derives exact inverses in reverse undo order.
The editor records that prepared/applied pair only after canonical application
and selection settlement succeed. Structural and metadata planners construct
their forward/inverse operation data at their graph-specific planning
boundary. That data is not a completed history entry and carries no selection
placeholders.
Recording truncates the redo tail, appends the entry, and removes the oldest
entries above the configured retention limit.

The editor captures one canonical pre-edit selection snapshot. Its richer
block-internal history representation is derived lazily only when recording or
preservation requires it; public transaction selection projection does not
replace that history representation. Before destructive content application,
the coordinator completes every fallible `selectionBefore` replay anchor
against the pre-command graph and content side. That selection is the forward
operation's replay input and the inverse operation's replay result. The
intended post-edit selection is known from the prepared canonical selection
effect and is completed against the post-command graph and content side while
applied content remains abortable. It is the forward operation's replay result
and the inverse operation's replay input. Only then may graph and canonical
selection commit, the already-complete history entry record, and the single
publication release. After canonical selection settlement, one post-edit
canonical snapshot supplies the public transaction projection. Document text
endpoints are re-anchored once for their own replay operation.
An endpoint at the left edge of replayed inserted or replaced content uses
backward association; an endpoint at the right edge uses forward association.
Unaffected endpoints preserve their valid association, and block-internal
history retains its richer coverage payload. Yjs relative-anchor association
is retained in the prepared replay anchors; history never substitutes plain
offsets or derives content inverses independently.

The authoritative producer boundary covers:

| Local edit origin                                        | Completed unit                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| typing, deletion, replacement, marks, entities, mentions | logical content operation pair                                        |
| paste, cut, split, join, range deletion                  | one ordered structural/content composite pair                         |
| insert, delete, move, indent, outdent, duplicate         | structural operation pair retaining affected identities and placement |
| metadata fields, batches, column resizing                | metadata operation pair retaining prior field values                  |
| canonical fragments and application-created content      | one structural or mixed operation pair                                |

Internal transaction steps and content effects never record independently.
Failed validation, failed application, and no-op edits record nothing.

Typing grouping is ephemeral editing-layer state. Compatible edits compose
forward operations chronologically and inverse operations in reverse order,
while retaining the first `selectionBefore` and final `selectionAfter`.
Structural, metadata, paste, cut, formatting, discontinuous selection, timeout,
undo, redo, and editor disposal end the group. Grouping metadata is never stored
in an entry.

## External ingress

Collaboration updates, accepted remote graph or metadata operations, remote
rich-text updates, hydration, startup materialization, recovery, reconciliation,
persistence acknowledgements, and durable-operation replay use ordinary
application boundaries without calling the local recording boundary. Undo and
redo replay also suppress recording. Before replay, stable history anchors are
resolved in the current content. When all endpoints for an affected block
describe one coherent shift, the stored content operation is shifted to that
current boundary. This rebases insertions before the recorded edit, including
Yjs relative positions, without storing Yjs data in the editor history policy.
Conflicting endpoint shifts or an operation that no longer applies fail
atomically without moving the cursor; history does not claim general conflict
resolution for arbitrary remote edits.

History entries contain no origin, routing, actor, transaction, grouping,
persistence, collaboration, browser, DOM, or local-input provenance data.

## Selection settlement

Selections stored in entries are logical restoration intent. Undo supplies
`selectionBefore`; redo supplies `selectionAfter` through the general operation
selection effect. The mounted document's normal selection owner resolves that
intent against the post-operation graph, assigns current revisions, normalizes
invalid endpoints through ordinary selection rules, and commits one final
selection settlement before document notifications are released.

`useGlobalSelection` only projects normal logical selection into browser
selection. It never reads history or distinguishes undo and redo. Browser focus
is best-effort web projection after logical settlement and cannot roll back a
successful command. Native and ProseMirror ingress always submit their logical
selection to the canonical controller. Equality with the current normalized
selection produces the explicit `unchanged` result; a different valid
selection produces `changed`. An unchanged settlement retains the
transaction-owned anchor, does not advance selection revision or create a
settlement marker, and does not publish a standalone selection change.

## Commands, availability, and web integration

The public command surface is direct:

```ts
editor.undo();
editor.redo();
```

The editor's reactive command availability exposes constant-time `canUndo` and
`canRedo` cursor derivations. Availability changes after recording, successful
undo, successful redo, redo-tail invalidation, and retention changes. It does
not publish persistence or collaboration events.

History command definitions and keyboard shortcuts are optional direct
`EditorDefinition.commands` and `EditorDefinition.keybindings` product policy.
`conventionalHistoryCommands` and `conventionalHistoryKeybindings` are
immutable configuration data; importing them installs nothing. Omitting them
does not affect core history or install history keydown behavior.

Editor-web has one interaction router per mounted browser document. Each
mounted editor registers one owner that composes configured document commands
with ordinary selection keyboard handling. Target ownership and declared
interaction scopes take precedence; otherwise a non-interactive BODY or host
event may fall back to the active owner after a focused projection disappears.
An unrelated external form control never falls back to an editor. Because the
router selects one registered owner before command resolution, per-editor
configuration and multi-editor isolation are preserved and a successful
document command executes once. A chord configured at block scope is deferred
to the mounted block plugin, which no longer contains a document-command
fallback.

Native browser `beforeinput` history intent is separate permanent editor-web
infrastructure. An owning editor always prevents controlled-DOM mutation and
calls the same direct `editor.undo()` or `editor.redo()` core operation,
including when history is empty and regardless of configured keybindings. The
same document router sends native history only to the owner whose block list
contains the event target.

The bounded array stores operations rather than complete documents. There is no
mirrored timeline, per-block undo stack, history service, public entry
inspection, or history-specific selection subscription.
