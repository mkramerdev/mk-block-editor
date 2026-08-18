# Editor architecture

The editor is split into generic model, React/runtime, DOM, web, Yjs, and
product packages. Canonical document structure and content are independent of
browser rendering and product integrations.

## Direct definition composition

`EditorDefinition` is the complete static composition input:

```text
EditorDefinition
├─ blocks
├─ inlineMarks
├─ inlineAtoms
├─ commands
├─ keybindings
├─ contentCodecs
├─ typingTriggers
├─ contentImport
├─ content
└─ documentValidators
```

The generic compiler reads each field directly. Commands and keybindings have
validated identities and scopes. Codec handlers have globally unique handler
IDs. Structural validators are passed directly to the core editor.

Product-specific definition checks run while constructing the product
definition. Universal shape and identity checks run in the generic compiler.

## Runtime boundaries

`initializeEditor` validates a definition and snapshot, constructs the core
editor and content runtime, and owns their core cleanup. Browser mounting owns
standard block-local editing plugins, direct keybinding routing, selection,
focus, geometry, clipboard translation, and canonical proposal acceptance.

Product code owns product document layers and receives product sources
directly. Storage, realtime, diagnostics, comments, additional-selection presentation,
database sources, and product view state do not use runtime discovery.

## Headless typing triggers

Definitions may declare:

```ts
typingTriggers: [
  { id: "mention", trigger: "@" },
  { id: "slash", trigger: "/" },
],
```

Typing-trigger activation is headless and edge-driven from finalized accepted
local typing. The runtime owns one immutable active session. Product code
subscribes, filters its own mention/slash catalogs, renders its own menus, and
owns highlighted-candidate, keyboard, pointer, loading, and unmatched-query
policy. Dismissal does not mutate content. Inline and canonical-fragment
acceptance validate the session ID and revision, then commit the compound
replacement once through the ordinary transaction coordinator. Hydration,
replay, remote changes, undo, redo, and existing trigger text do not activate
local sessions.

Definitions and session snapshots are immutable. The generic runtime detects
and mutates no candidate or menu state. Product mention acceptance emits only
canonical atom identity metadata. Product slash planning remains pure
preparation, uses the product table planner where required, and produces
canonical fragments that the session-scoped acceptance API commits once.

## Package ownership

| Package                                     | Owner                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `@repo/editor-model`                        | Canonical document, definitions, validation, editing plans, and codecs               |
| `@repo/editor-react`                        | Core editor controller, history, focus, selection, and external stores               |
| `@repo/editor-dom`                          | ProseMirror schema and browser-independent DOM editing adapters                      |
| `@repo/editor-web`                          | React DOM document surface, mounting, geometry, clipboard, commands, and keybindings |
| `@repo/editor-yjs` / `@repo/editor-yjs-dom` | Yjs content translation and DOM runtime                                              |
| `@repo/editor-product-model`                | Product semantic model and table planning                                            |
| `@repo/editor-product-web`                  | Product definitions, codecs, renderers, UI layers, and runtime assembly              |

Public APIs use explicit package subpaths. Product packages depend on generic
packages; generic packages do not import product packages.
