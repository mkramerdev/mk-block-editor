# @repo/editor-yjs

Runtime-neutral Yjs helpers for block-local editor content.

Editable blocks have block-local content documents, and each block-local content
document is backed by its own `Y.Doc`. This package owns the Yjs parts of that
boundary only: block content document creation, block-local metadata, encoded
updates, state vectors, update observation, semantic origins, and neutral
observability hooks.

## Boundary

Keep here:

- block-content `Y.Doc` context creation;
- block-local content identity using `blockId`;
- block-content registry lifecycle for one editing instance;
- metadata conventions for `blockId` and `documentKind`;
- encoded update and state-vector helpers;
- block-content update observation;
- semantic editor Yjs origins;
- runtime-neutral observability helpers.

Keep out:

- document loading, persistence, realtime routing, cache keys, and app routes;
- DOM binding, ProseMirror state/view code, and `y-prosemirror` mapping;
- cursor, decoration, selection, awareness UI, or additional-selection rendering;
- browser IndexedDB/SQLite storage and server/Postgres storage;
- realtime transports or provider setup;
- editor hydration, rendering, block activation, or selection policy;
- page-wide/shared editor `Y.Doc` architecture.

Outer storage, realtime, and product composition layers may wrap emitted block
content updates with their own route identity when they load, save, subscribe, or
cache an editor instance. Generic Yjs block content state does not store or emit
that route identity.

Concrete DOM binding lives in `@repo/editor-yjs-dom`. Browser runtime assembly
lives in `@repo/editor-web`. Product storage and persistence live in product
packages such as `@repo/editor-storage-sqlite`.

## Source Layout

- `src/api/index.ts` owns the complete public root surface. The package exposes
  only `@repo/editor-yjs`; no public subpaths are exported.
- `src/block-content/doc/` owns block-content `Y.Doc` context creation and
  registry lifecycle.
- `src/block-content/metadata/` owns canonical metadata constants, contracts,
  reads, writes, and validation.
- `src/block-content/observation/` owns raw update observation for validated
  block-content contexts.
- `src/fragments/` owns neutral Yjs fragment context helpers for fragments
  inside an already validated block content document.
- `src/updates/` owns encoded Yjs update helpers, state-vector helpers, and the
  isolated temporary `Y.Doc` metadata probe used before applying updates.
- `src/origins/` owns semantic editor Yjs transaction origin constants and
  origin contracts.
- `src/observability/` owns neutral Yjs observability hooks that do not render
  UI.
- `src/architecture/package-boundaries.test.ts` enforces the root-only export,
  `src/api` ownership, runtime-neutral imports, and
  package boundary rules.

Implementation files import concrete domain files. They do not import
`src/api/index.ts` or `@repo/editor-yjs`; those are reserved for external
consumers and API tests.

## Public API

```ts
import {
  EDITOR_YJS_ORIGINS,
  applyBlockContentUpdate,
  createBlockContentDocContext,
  createBlockContentFragmentContext,
  encodeBlockContentStateVector,
  encodeBlockContentUpdate,
  observeBlockContentUpdates,
  observeEditorYjsAwarenessDisconnects,
} from "@repo/editor-yjs";

import type {
  BlockContentDocContext,
  EditorYjsFragmentContext,
  EditorYjsObservabilityHooks,
} from "@repo/editor-yjs";
```

`createBlockContentDocContext({ blockId })` creates or wraps one block-local
`Y.Doc`, writes canonical metadata into the `meta` map, and returns the primary
rich-text fragment named `content`. Each block-content context is one block-local
`Y.Doc` keyed by `BlockId`.

`createBlockContentFragmentContext(...)` is for secondary fragments inside an
already validated block-content document. It does not create another document
or assign product semantics to those fragments.

## Runtime Neutrality

This package must remain free of DOM, ProseMirror, `@repo/editor-web`,
`@repo/editor-yjs-dom`, storage, realtime transport, product, app route,
React DOM, and React Native imports. DOM binding belongs in
`@repo/editor-yjs-dom`; browser runtime assembly belongs in `@repo/editor-web`;
storage and persistence belong in storage or product packages.

This package does not own editor history or a Yjs undo manager. The editor core
records logical content operations and their inverses in its single linear
history.

## Validation

Run these after changes:

```sh
pnpm --filter @repo/editor-yjs typecheck
pnpm --filter @repo/editor-yjs test
pnpm --filter @repo/editor-yjs-dom typecheck
pnpm --filter @repo/editor-yjs-dom test
pnpm --filter @repo/editor-web typecheck
```
