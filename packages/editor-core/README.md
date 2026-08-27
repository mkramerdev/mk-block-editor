# @repo/editor-core

`@repo/editor-core` is the platform-neutral document, definition, selection,
operation, metadata, codec, and editing model used by editor implementations.

## Block definitions

A product owns one `BlockDefinition` object for each opaque block type it makes
available. The `kind` field selects the only canonical categories understood by
the kernel:

- `"text"` stores one neutral block-local rich-text document.
- `"atomic"` is selected and moved only as a whole block.
- `"wrapper"` may declare generic child and parent constraints, content
  boundaries, and default-child creation.

Rendering and root layout are web-presentation concerns and are not part of the
core definition.

Definitions are runtime configuration. Persisted blocks contain their `type`
string; definition objects are neither persisted nor reconstructed from
documents.

## Product composition

Share plain semantic fragments, then create complete platform definitions by
attaching each runtime's renderer directly to its block definition:

```ts
const textSemantics: BlockDefinition = {
  kind: "text",
  type: "noteText",
};

const noticeSemantics: BlockDefinition = {
  kind: "wrapper",
  type: "notice",
  content: { required: ["noteText"] },
  contentBoundary: false,
};

export const productEditableBlockDefinitions = {
  noteText: { ...textSemantics, rootLayout: "normal", renderer: EditableNoteText },
  notice: { ...noticeSemantics, rootLayout: "normal", renderer: EditableNotice },
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
import type { EditableEditorDefinition } from "@repo/editor-web/document-runtime";

export const productEditableEditorDefinition = {
  blocks: productEditableBlockDefinitions,
  defaultRoot: "noteText",
  inlineMarks: productInlineMarks,
  inlineAtoms: productInlineAtoms,
  commands: productCommands,
  keybindings: productKeybindings,
} satisfies EditableEditorDefinition;
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

- collection key/type agreement and the three generic block kinds;
- data, selection, metadata defaults, and metadata validation callbacks;
- wrapper child and parent constraints, content boundaries, and default-child
  construction;
- referenced child types and terminating minimum construction.

Concrete editing, conversion, replacement, list, compound-wrapper, and
underflow policies are product concerns and are not part of a core definition.

## Structural editing

`planBlockTreeCreation` recursively creates a minimum-valid subtree from the
provided definition objects. The core editing API exposes generic transaction
primitives for inserting, moving, removing, splitting, joining, replacing
content or metadata, and setting selection. Products plan structural keyboard
behavior through the registered command boundary and execute one validated
generic transaction; the kernel does not choose product behavior from an
opaque block type.

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
- `editing`: generic graph queries, creation planning, transaction primitives,
  application, and validation.
- `content`: rich-text, mark, inline-atom, and URL contracts.
- `metadata`: generic block-record metadata behavior.
- `codecs`: snapshots and external payload validation.
- `kernel`: identities, JSON values, and versions.
- `testing`: test-only block definitions.
