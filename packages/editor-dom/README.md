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
Forward Delete compares the canonical caret with canonical rich-text size,
including Unicode code points, inline atoms, and hard breaks. Same-block and
range deletion remain block-local. The bindings respect IME
composition and prevent browser defaults only after the editor command reports
success. Canonical ranges are consumed before these block-local bindings.
Structural planning remains in
`@repo/editor-core`; transaction execution and history remain in the runtime.

Optional slash and mention trigger strings are declared as headless
`EditorDefinition.typingTriggers` data. Trigger recognition and product menus
are not part of Phase 1. DOM rectangles may anchor product-owned UI or identify
a candidate drop target, but they never determine document structure.

Public exports include the block-local schema/view construction helpers and
the typed plugin option contracts. There are no host intents, block-specific
keyboard pipelines, alternate barrels, or aliases.

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
