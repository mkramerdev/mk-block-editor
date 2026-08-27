# @repo/editor-web

`@repo/editor-web` is the generic React DOM surface for the canonical editable
block editor. One `EditorDocument` renders the canonical block tree, and each
block definition directly owns its renderer:

```tsx
import { EditorDocument } from "@repo/editor-web/document-runtime";
import { compileCanonicalEditorDefinition } from "@repo/editor-web/editor-definition";
import { initializeEditableEditor } from "@repo/editor-web/editor";

const editor = initializeEditableEditor({
  compiledDefinition: compileCanonicalEditorDefinition(editableDefinition),
  snapshot,
  onChange,
});
```

## Definition composition

Static composition is owned directly by `EditableEditorDefinition`:

```text
EditableEditorDefinition
|- blocks
|- inlineMarks
|- inlineAtoms
|- contentCodecs
|- typingTriggers
|- contentImport
|- content
|- renderers on each block definition
|- blockInternalSelectionSubsystems
|- selectionFragment
|- documentValidators
|- commands
`- keybindings
```

Editable commands and keybindings are owned by the editable definition and
compiled during editable initialization. Definition compilation validates
semantic fields, handler IDs, trigger strings, the content runtime, stable
selection subsystems, and structural validators.

Content codec handler IDs are unique across HTML import/export, plain-text
import/export, internal-selection materialization, and internal-selection cut
handlers.

## Headless typing triggers

Typing triggers are optional headless definition data:

```ts
typingTriggers: [
  { id: "mention", trigger: "@" },
  { id: "slash", trigger: "/" },
],
```

A trigger definition may also provide a read-only `isAllowed` predicate. It
does not contain candidate providers, filtering, rendering, product actions,
transactions, mounted views, persistence, or history.

Accepted local typing is reconciled after canonical content and selection
settle. Completing a configured trigger opens one immutable editor-owned
session. Existing text is never continuously scanned: hydration, replay,
remote ingress, undo, redo, caret movement after old text, paste, and ordinary
programmatic insertion cannot activate a session.

Product code reads or subscribes to the session through the public `EditableEditor`,
or through the headless `useEditorTypingTriggerSession(editor)` external-store
adapter. The product owns candidates, filtering, menus, keyboard policy,
loading state, portal choice, geometry-driven positioning, and presentation.
Product interaction state is keyed by immutable session identity and revision;
it is never copied into editor runtime state.

Dismissal validates the current session ID and revision and changes no
document state. Inline-content and canonical-fragment acceptance validate the
same optimistic authority and commit the complete replacement once through
the existing private transaction coordinator. A stale or invalid acceptance
changes nothing. The generic editor does not know that mention or slash menus
exist.

Product mention acceptance sends one canonical inline replacement. Product
slash acceptance sends one product-planned canonical fragment replacement.
Both converge at the same private transaction coordinator used by ordinary
editor mutations, so selection settlement, history, persistence, realtime,
and transaction notification remain one finalized action.

## Runtime and DOM ownership

`initializeEditableEditor` validates its semantic definition, snapshot, and
the renderers attached directly to its block definitions. `EditorDocument`
owns one `BlockList`;
`BlockList` is the root grid and directly contains root `BlockShell` elements.
Each shell is registered structural DOM and
directly contains the caller's product renderer.

`InactiveTextBlockPrimitive` owns the PM-free canonical `.editor-web-text`
projection. Every editable document text runtime owns exactly one
`SharedTextEditor`, which creates at most one `EditorView` lazily. Activation
rebinds that same view to the selected text block and moves its DOM into the
active block's slot. Individual block React mounts do not create or own
EditorViews. Inactive blocks retain exact canonical projections, including
while the active projection is mounted and hidden. `BlockShell` owns neither
native focus nor semantic selection and is never a focus target.

The browser is the sole native-focus authority, read through the candidate
target's `ownerDocument.activeElement`. Text and atomic targets register in a
separate exact, tokenized registry; structural shell registration is not used
to discover them. `focusText()` and `focusBlock()` validate the live graph and
selection model, focus the exact target, verify browser focus, revalidate after
synchronous focus events, and then settle canonical selection. A failed
revalidation releases the attempted target and retains the prior selection.

A request made before a valid target mounts is an unconsumed action request,
not current focus. It records a unique token, block, exact target kind, graph
revision, scroll policy, and text offset or placement. It is consumed once or
discarded on rejection, supersession, blur, graph invalidation, deletion,
kind change, or disposal. Canonical selection never creates such a request,
and remounting without one never steals focus. `blurEditor()` only blurs an
exact editor-owned active element, cancels pending requests, and tears down a
safe active projection; it retains canonical selection and publishes nothing.

`SelectionController` is the only semantic local-selection owner. Pointer and
keyboard gestures settle canonical points/ranges directly. The active
`EditorView` and browser DOM Selection retain only a collapsed input caret at
the canonical focus endpoint outside composition. Noncollapsed local selection
is rendered solely by `SelectionPaintLayer`; PM/DOM projection, focus, rebind,
and acknowledgement cannot settle or publish selection.

Applying or restoring canonical selection never calls the public focus
actions. If the browser already focuses the matching exact target, the runtime
may update its mechanical caret projection. Undo, redo, remote reconciliation,
rebase, and recovery otherwise leave the currently focused toolbar or external
control untouched. Only an explicit internal presentation request may create
or focus a projection after a structural operation.

Text pointerdown creates a pending canonical candidate, suppresses native
selection, and leaves pointer capture and cursor presentation untouched. Only
movement beyond the drag threshold starts an active draft drag: the stable
block list receives its scoped text-cursor marker synchronously, then acquires
pointer capture, then updates only the draft paint range. Pointer cleanup releases
capture before removing that marker. `SelectionPaintLayer` follows canonical
dragging paint state but owns neither pointer phase nor cursor presentation.

A pending candidate does not activate a block before pointerup. A completed click
is hit-tested again from its actual geometry, settles one collapsed canonical
caret, and then hands that offset to the one editable projection. Whole-block
pointer clicks likewise settle canonical block selection only from a completed
click; BlockShell remains structural and never receives native focus. Drag
completion remains a separate path: it settles its canonical endpoint on
pointerup, and
the compatibility click following that drag is ignored.

Document focus loss is a one-way release boundary. Window blur, hidden
visibility, and page hide release only native focus owned by this editor,
cancel any incomplete composition through its existing session contract,
deactivate the active text projection. Canonical
selection remains unchanged. Window focus and visible visibility perform no
restoration; a text projection is created again only by an explicit focus
request.

Finalized local content enters the canonical transaction coordinator once.
Rendering and projection lifecycle changes do not create
history or outbound events. Standalone pointer, keyboard, and
block-internal selection settlements publish only through the
selection-controller-owned standalone settlement stream. Transaction-owned
`selectionAfter` publishes exactly once as the accepted content transaction's
ephemeral author-selection sidecar. Reconciliation, remote,
projection-restoration, browser-focus, and unchanged settlements do not
publish. Presence wiring consumes canonical settlement;
the current First Draft adapter publishes revisioned ephemeral selection updates
over its existing collaboration socket.

Enter, boundary Backspace, and forward boundary Delete use one universal core
behavior port. The DOM layer claims Delete only at canonical text end; the web
route forwards that request once, and the canonical planner validates the
boundary again. Same-block deletion never enters the structural channel.

Product UI belongs in product document layers. Reusable fixed-popover geometry
is exported through the block-renderer surface where product-owned UI needs it.

## Styling Boundary

The public semantic classes are:

- `editor-web-document`: mounted document root.
- `editor-web-block-list`: canonical block list.
- `editor-web-block`: registered canonical block shell and direct renderer parent.
- `editor-web-text`: active or inactive editable-document text root.
- `editor-web-error`: generic editor error state.
- `editor-web-selection-paint-rect`: rectangular selection paint.
- `editor-web-selection-paint-segment`: segmented selection paint.

## History

History commands and keybindings are supplied by the compiled definition. The
editable session remains responsible for applying and disposing history
resources. Local and Yjs content
runtimes expose the same opaque operation-anchor ports to the backend-neutral
editor-react replay algorithm. Operation replay is independent from saved
selection restoration, refreshes its opposite plan after every successful
transition, resolves all operation boundaries for an affected block through
one history lease, and has no numeric-offset or selection-position fallback.
An authoritative local reconciliation without canonical operation lineage
clears history instead of attempting to migrate anchors.

## Public subpaths

- `@repo/editor-web/document-runtime`
- `@repo/editor-web/editor-definition`
- `@repo/editor-web/editor`
- `@repo/editor-web/clipboard-runtime`
- `@repo/editor-web/block-renderer`
- `@repo/editor-web/editable-block-renderer`
- `@repo/editor-web/block-operations`
- `@repo/editor-web/keybindings`
- `@repo/editor-web/typing-triggers`
- `@repo/editor-web/styles.css`

There is no root barrel. The package does not own storage, realtime transport,
product comments, product databases, or product menu rendering.
