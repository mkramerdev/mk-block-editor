# Selection presentation architecture

The editor is the sole client-side owner of canonical local selection and, for
editable editors, stable and logically resolved additional selections.
Transport callbacks are event boundaries; no product store mirrors editor
selection state.

## Publication ownership

- A content transaction publishes its settled `selectionAfter` through the
  transaction callback only.
- Changed pointer, keyboard, imperative focus-action, and block-internal
  standalone-local settlements publish through the editor-owned canonical
  settlement stream only.
- Remote application, canonical rebase, recovery, and projection settlement
  are silent.

Both outbound routes carry the explicit selection-or-none representation. They
share one session selection-revision sequence in the realtime envelope.

## Document layer stack

The shared, PM-free `EditorDocument` mounts exactly one built-in layer before
custom product layers:

```text
EditorDocumentLayerStack
|- SelectionPaintLayer(editor)
`- CustomDocumentLayerHost(renderDocumentLayers(context))
```

The built-in layer reads canonical local selection and `editor.geometry` in
both modes. For editable editors it also reads the editor's logical additional
document selections. It paints every noncollapsed local text range, collapsed
additional carets, and generic block surfaces. Cleared or unresolved selections
paint nothing. `SelectionController` is the only semantic local-selection
owner. An active ProseMirror view stores only the mechanically required
collapsed input caret at the canonical focus endpoint, and the browser DOM
Selection is the corresponding collapsed projection. Neither projection is
selection ingress. The input caret is visually transparent while canonical
range paint is active. The paint DOM is `aria-hidden` and pointer-transparent.

Pointer and keyboard gestures hit-test and settle through
`SelectionController`, then project one collapsed input caret. Projection,
focus, native acknowledgement, repaint, rebind, and reconciliation never settle
selection or publish a selection change. A content transaction may include one
atomic collapsed `selectionAfter`; it is published only with that transaction.
Composition temporarily owns an ephemeral ProseMirror draft at the frozen
canonical focus endpoint and replaces the frozen canonical range once when it
completes.

Pointer selection has a local pending/dragging resource boundary. Pointerdown
retains the canonical anchor and suppresses native selection without capture;
ordinary clicks therefore keep the text hit target's natural I-beam. Crossing
the drag threshold synchronously marks the stable block-list capture owner with
its scoped text cursor, requests capture, and only then updates the canonical
drag range. Pointerup and cancellation release capture before removing the
marker. Selection paint is downstream presentation and never controls pointer
capture, phase, or cursor state.

Document focus loss is a projection teardown, never a selection settlement.
Window blur, hidden visibility, and page hide release editor-owned DOM focus,
cancel an incomplete composition through that composition session, deactivate
the text projection, and retain canonical selection. Window focus and visible
visibility are inert. Only a later explicit
focus request may project a collapsed caret at the canonical focus endpoint.

Read editors never allocate, read, resolve, subscribe to, or paint additional
selections. They retain canonical local selection, local paint, geometry,
canonical copy, remote content application, and silent local rebasing. Their
static bundle contains no ProseMirror code.

## Wrapper presentation

Wrapper renderers subscribe through the block-scoped selection reader. A
wrapper is notified only when local selection or an additional selection enters,
leaves, changes, resolves, clears, or changes validated internal payload within
its subtree. Read wrappers receive local selection only.

Ordinary text selection in a table cell remains a document selection. The
table derives the containing cell from canonical ancestry and paints a
contextual cell perimeter; it does not create or transmit a table selection.
A range crossing table descendants likewise remains a document selection.

True multi-cell and whole-table selections use the registered table
block-internal subsystem and stable cell IDs. The additional-selection manager
validates the opaque JSON payload. The table wrapper resolves the IDs and paints
cell perimeters; valid unresolved payloads stay hidden until canonical structure
makes them resolvable. Generic selection paint never parses table payloads.

## Selection focus endpoints and product badges

Every resolved additional selection may expose a geometry-free selection focus
target. This is the canonical selection's focus endpoint, never browser focus:

```ts
type ResolvedSelectionFocusTarget =
  | { kind: "text"; blockId: BlockId; point: ResolvedTextPoint }
  | { kind: "block"; blockId: BlockId; target: string | null };
```

Document selections derive it from the focus endpoint. A registered
block-internal subsystem may derive a block target from its validated payload;
the table subsystem returns the logical focus cell.

The product badge document layer joins the editor-owned subject and logical
focus with a separate participant metadata store, then measures the target from
`editor.geometry`. It retains no rectangle or event coordinates and remeasures
on geometry invalidation. Missing metadata may hide or generically label a
badge, but never suppresses generic selection or wrapper paint.

Participant metadata owns display name, avatar, color token, and connection
status only. It owns no stable selection, resolved selection, watermark,
coverage, paint primitive, or geometry.

## Render isolation

- Generic paint subscribes to local selection, editable additional document
  selection, and geometry.
- A wrapper subscribes only to its own block scope.
- Badges subscribe to additional selections, participant metadata, and geometry.
- Annotation layers retain their own focused subscriptions.
- Block controls do not subscribe to selection presentation or geometry.

No provider distributes editor selections through product composition, and no
product projection converts anchors to offsets, coverage, paint DTOs, or saved
coordinates.
