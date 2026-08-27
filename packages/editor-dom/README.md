# @repo/editor-dom

`@repo/editor-dom` adapts block-local ProseMirror editing to the generic editor
contracts. It owns DOM schemas, plugins, composition guards, content key
bindings, collapsed caret coordinate mapping, and view lifecycle. It does not own product definitions,
product commands, structural mutation, persistence, or renderer selection.

ProseMirror is never a semantic selection owner. An active view stores only one
mechanically required collapsed input caret, derived from the canonical focus
endpoint. Its DOM Selection is likewise collapsed outside active composition.
The dispatch boundary mechanically collapses any proposed PM selection before
installation, and a PM transaction with no content change has no accepted
semantic path. Pointer, selection navigation, ranges, clipboard targeting, and
range-consuming commands belong to the canonical controller and web document
boundary.

Enter, boundary Backspace, and forward boundary Delete bindings contribute
exactly one generic structural command each for a collapsed projected caret.
The keymap uses ProseMirror-local parent offsets for the ordinary zero/end
distinction and computes a canonical offset only when it actually emits a
structural behavior. Inline atoms retain their explicit keymap deletion.

Ordinary same-block backward and forward deletion is claimed by the input
plugin from `beforeinput` when the browser supplies one usable target range.
Both DOM endpoints are mapped before native mutation, and the plugin dispatches
one normal ProseMirror deletion transaction. The browser therefore continues
to choose surrogate, combining, variation-selector, joined-emoji, and other
native deletion boundaries. Composition, structural boundaries, invalid or
empty ranges, and environments without a usable target range are not claimed;
the last case deliberately retains ProseMirror's native DOM-recovery fallback.

The keymap and input plugin respect active composition. Browser default is
prevented only after a path has claimed the event. Canonical ranges are
consumed before the structural key bindings. Core owns structural transaction
contracts and generic validation; product policy such as First Draft's Enter,
Backspace, Delete, and wrapper behavior is planned by the product. Transaction
execution and history remain in the runtime.

Optional slash and mention trigger strings are declared as headless
`EditableEditorDefinition.typingTriggers` data. Trigger recognition and product menus
are not owned by `@repo/editor-dom`. DOM rectangles may anchor product-owned UI
or identify a candidate drop target, but they never determine document
structure.

The public subpaths are `block-editor`, `schema`, `keymap`, `caret`,
`clipboard`, and `prosemirror`. There is no package-root export. These subpaths
expose the block-local schema/view helpers, typed plugin contracts, coordinate
codecs, semantic clipboard codecs, and the deliberately shared ProseMirror
types used at the web boundary.

## Semantic content codecs

This package owns inert semantic HTML parsing, sanitization, and serialization.
HTML import produces `CanonicalBlockFragment` directly and allocates new record
IDs through the canonical model. HTML export consumes that same fragment and
emits readable semantic markup; it never embeds editor state, record IDs, wire
JSON, focus information, or hidden transport elements.

Sanitization removes executable and hidden elements, comments, event
attributes, unsupported style and editor attributes, and unsafe URL schemes.
Parsing and serialization share conservative limits for bytes, nesting,
children, rich-text content, metadata, and block counts.
Unknown safe containers flatten to supported semantic descendants.
Definition-composed handlers own custom block semantics and never receive
`DataTransfer`, an edit target, or an editor transaction.

Plain-text parsing here is also transport-neutral: a caller supplies the
definition-owned default text type and receives a validated canonical fragment.
Line endings normalize to `\n`; structured input is rejected rather than
truncated when it exceeds a resource limit.
