# @repo/editor-yjs

`@repo/editor-yjs` provides runtime-neutral Yjs primitives for block-local
editor content. Each editable text block can be represented by its own `Y.Doc`;
this package supplies document contexts, canonical rich-text conversion,
metadata conventions, updates, state vectors, checkpoint creation, semantic
origins, and observability hooks without depending on DOM or React code.

## Boundary

This package owns:

- creation and validation of one block-content `Y.Doc` context;
- canonical metadata for `blockId`, document kind, and the `content` fragment;
- canonical rich-text reads, writes, mutation planning, and offset conversion;
- update application, encoding, merging primitives, and state vectors;
- opaque checkpoint creation and format/version constants;
- block-content update observation and semantic origins; and
- runtime-neutral awareness-disconnect observability.

It does not own an editor-wide content registry, editor history, a Yjs undo
manager, ProseMirror binding, selection presentation, transport, persistence,
PostgreSQL, browser storage, routing, or rendering. The concrete editor content
runtime and relative text anchors live in `@repo/editor-yjs-dom`; browser
runtime assembly lives in `@repo/editor-web`.

## Public surface

The package exports both a root entrypoint and a checkpoint-format subpath:

- `@repo/editor-yjs`
- `@repo/editor-yjs/checkpoint-format`

The root includes focused helpers as well as the Yjs primitives needed by the
runtime boundary. For example:

```ts
import {
  EDITOR_YJS_ORIGINS,
  applyBlockContentUpdate,
  applyPlannedCanonicalYjsContentMutation,
  createBlockContentDocContext,
  createBlockContentFragmentContext,
  createYjsBlockContentCheckpoint,
  encodeBlockContentStateVector,
  encodeBlockContentUpdate,
  ensureCanonicalYjsBlockContent,
  observeBlockContentUpdates,
  planCanonicalYjsContentMutation,
  readCanonicalYjsBlockContent,
} from "@repo/editor-yjs";

import {
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
} from "@repo/editor-yjs/checkpoint-format";
```

The root also re-exports selected Yjs types and functions such as `YDoc`,
`applyUpdate`, `encodeStateAsUpdate`, `encodeStateVector`, `diffUpdate`, and
`mergeUpdates`. See `src/api/index.ts` for the complete public root surface.

`createBlockContentDocContext({ blockId })` creates or wraps one block-local
document, writes the canonical metadata, and returns its primary `content`
fragment. `createBlockContentFragmentContext(...)` addresses another fragment
inside an already validated block-content document; it does not create another
document or assign product semantics.

`createYjsBlockContentCheckpoint(blockId, content)` creates a complete initial
checkpoint from canonical rich text. The format constants are available from
both the root and the public `checkpoint-format` subpath.

## Source layout and tests

- `src/block-content/doc` owns block-local context creation.
- `src/block-content/canonical-rich-text.ts` owns canonical/Yjs conversion and
  incremental mutation planning.
- `src/block-content/checkpoint.ts` and
  `src/block-content/checkpoint-format.ts` own checkpoint construction and its
  public format identity.
- `src/updates`, `src/origins`, `src/fragments`, and `src/observability` own the
  corresponding neutral helpers.
- Public-surface coverage is in `src/api/index.test.ts`; domain tests live next
  to the implementation they cover.

## Validation

```sh
pnpm --filter @repo/editor-yjs check-types
pnpm --filter @repo/editor-yjs lint
pnpm --filter @repo/editor-yjs test
pnpm --filter @repo/editor-yjs build
```
