# @repo/editor-core

`@repo/editor-core` is the platform-neutral document, definition, selection,
operation, metadata, codec, and editing model used by editor implementations.

## Block definitions

A product owns one `BlockDefinition` object for each block type it makes
available. All definition fields live directly on that interface. The `kind`
field selects runtime behavior:

- `"text"` definitions may declare a `split` map.
- `"atomic"` definitions may declare a text `replaceWith` target.
- `"wrapper"` definitions declare `content`, `contentBoundary`, optional
  `defaultContent`, and optional `underflow` behavior.

The interface keeps `renderer: unknown` so this package has no React, DOM,
ProseMirror, Yjs, or other platform dependency. A web runtime verifies that the
renderer is callable before invoking it through its web renderer contract.

Definitions are runtime configuration. Persisted blocks contain their `type`
string; definition objects are neither persisted nor reconstructed from
documents.

## Product composition

Share plain semantic fragments, then create complete platform definitions by
attaching each runtime's renderer directly to its block definition:

```ts
const paragraphSemantics: Omit<BlockDefinition, "renderer"> = {
  kind: "text",
  type: "noteText",
  rootLayout: "normal",
  split: { default: "noteText" },
};

const noticeSemantics: Omit<BlockDefinition, "renderer"> = {
  kind: "wrapper",
  type: "notice",
  rootLayout: "normal",
  content: { required: ["noteText"] },
  contentBoundary: false,
};

export const productEditableBlockDefinitions = {
  noteText: { ...paragraphSemantics, renderer: EditableNoteText },
  notice: { ...noticeSemantics, renderer: EditableNotice },
};

export const productReadBlockDefinitions = {
  noteText: { ...paragraphSemantics, renderer: ReadNoteText },
  notice: { ...noticeSemantics, renderer: ReadNotice },
};
```

Keeping a definition collection unannotated is one available composition
pattern: TypeScript retains its exact keys until the collection crosses a
generic `Readonly<Record<BlockType, ...>>` boundary. Products may instead
intentionally widen a collection when exact-key inference is not useful. First
Draft currently returns the widened `EditableEditorDefinition` contract.

When renderers are attached, use the web definition types rather than the
platform-neutral `BlockDefinition` type:

```ts
import type {
  EditableEditorDefinition,
  ReadEditorDefinition,
} from "@repo/editor-web/document-runtime";

export const productEditableEditorDefinition = {
  blocks: productEditableBlockDefinitions,
  defaultRoot: "noteText",
  inlineMarks: productInlineMarks,
  inlineAtoms: productInlineAtoms,
  commands: productCommands,
  keybindings: productKeybindings,
} satisfies EditableEditorDefinition;

export const productReadEditorDefinition = {
  blocks: productReadBlockDefinitions,
  defaultRoot: "noteText",
  inlineMarks: productInlineMarks,
  inlineAtoms: productInlineAtoms,
} satisfies ReadEditorDefinition;
```

Generic boundaries accept
`Readonly<Record<BlockType, BlockDefinition>>`. Runtime code then looks up a
persisted type directly with `blockDefinitions[block.type]` or
`definition.blocks[block.type]` and handles an absent definition in the
surrounding operation.

## Runtime validation

`assertValidBlockDefinition` checks one original object.
`assertValidBlockDefinitions` checks the complete keyed object without copying,
normalizing, or returning replacements. Validation includes:

- collection key/type agreement, valid kinds and layouts, supported fields,
  data, selection, metadata, and callbacks;
- text split targets and behavior;
- atomic replacement targets and text behavior;
- wrapper child policy, boundary, default-child, and underflow rules;
- referenced child types and terminating minimum construction.

These cross-definition relationships intentionally remain runtime semantic
validation.

## Structural editing

`planBlockTreeCreation` recursively creates a minimum-valid subtree from the
provided definition objects. Structural queries, Enter, Backspace, insertion,
movement, deletion, metadata application, and document validation receive the
same objects through structural parameters. They check `definition.kind`
directly and explicitly verify optional fields required by the active kind.

## Canonical detached content

`CanonicalBlockFragment` is the only model for newly created detached block
content. It contains ordered `CanonicalBlockRecord` values, ordered root IDs,
and start/end boundaries. Records contain only creation data: a newly allocated
ID, block type, detached parent, normalized metadata, and canonical rich-text
content plus matching plain text for text definitions.

The fragment invariants are:

- roots have `parentId: null`; every descendant parent is another record in the
  same fragment;
- records are unique and ordered parent before child in canonical reading
  order, while `rootBlockIds` carries root order explicitly;
- `"text"` boundaries represent open edges that may join ordinary text;
  `"block"` boundaries represent complete structural edges;
- boundaries address records in the fragment and text boundaries address text
  definitions;
- text records have valid canonical rich-text content whose extracted text
  equals `plainText`; wrapper and atomic records have neither field;
- the graph is non-empty, acyclic, reachable, and definition-valid.

`createCanonicalBlockRecord` uses ordinary block creation to allocate identity.
`createCanonicalBlockFragment` validates without repairing or reordering.
Selection materialization and duplication may use source identities only in a
call-local map while rebuilding parentage; those identities never enter the
result.

Canonical fragments contain no transport schema, format provenance, document
revision, source identity, insertion target, focus state, or browser data.
Clipboard wire versions belong to the web boundary, not this model.

## Public domains

- `definitions`: `BlockDefinition`, structural queries, and semantic validation.
- `document`: canonical block records and ordering queries.
- `selection`: app-controlled block and text selection semantics.
- `operations`: persisted logical operation validation.
- `editing`: direct structural planners and transaction application.
- `content`: rich-text, mark, inline-atom, and URL contracts.
- `metadata`: generic block-record metadata behavior.
- `codecs`: snapshots and external payload validation.
- `kernel`: identities, JSON values, and versions.
- `testing`: test-only block definitions.
