# @repo/editor-yjs-dom

DOM-specific Yjs content projection and relative-position codecs.

`@repo/editor-yjs` owns runtime-neutral block-content Yjs document contexts,
metadata, origins, updates, and observability contracts.
`@repo/editor-realtime-protocol` owns generic realtime change protocol
contracts. This package owns Yjs-backed block content mapping needed by web
content runtimes. It does not bind a mounted ProseMirror view to Yjs.

## Current Responsibilities

- `ensureYjsBlockContent(...)` seeds one block-local fragment through the canonical conversion path.
- `readYjsBlockContentDocument(...)` and `readYjsBlockContentPlainText(...)` expose narrow block-local reads without leaking y-prosemirror mappings.
- `createYjsRelativeTextPointCodec(...)` owns block-local relative text point encode/decode behavior.
- `createYjsBlockContentRuntime(...)` implements the editor-owned
  prepare/apply/release content commit contract.
- Local logical batches are staged, then applied to the existing live
  block-local `Y.Doc` under an identity-safe commit origin.
- Remote updates are validated against a staging clone and the accepted binary
  is applied to the existing live document.
- Incremental operation updates are collected during silent application;
  accumulated checkpoints are encoded only when explicitly requested.
- Relative text anchors preserve the requested backward or forward association
  at insertion boundaries. The editor coordinator uses that shared contract to
  create replay-aware history endpoints on the graph/content side where each
  selection exists. Pre-command anchors are completed before destructive
  application; Yjs does not own history policy.
- Stored editor history resolves those relative endpoints before replay. A
  remote insertion before a recorded local deletion shifts the replay boundary,
  so undo restores the local deletion after the remote text and redo removes it
  again without offset drift. Inconsistent endpoint shifts or operations that
  are no longer applicable fail atomically; this is not a Yjs-owned undo stack
  or a promise to merge arbitrary conflicting edits.

## Current Status

- ProseMirror does not write to Yjs and Yjs observation does not dispatch a
  ProseMirror transaction.
- Mounted views receive finalized content only through the editor-web
  projection adapter.
- Awareness, caret publishing, and remote caret rendering are not installed by this package.
- Editor history is owned solely by the editor core.
- Yjs observers collect commit output and guard against unexpected mutation;
  they do not discover editor operations, publish persistence, or dispatch
  ProseMirror transactions.
- Multi-block commits provide observational atomicity. Every block is prepared
  first, live documents are applied in deterministic order, and partial
  failures use reverse-order compensation before any publication.
- Awareness disconnect reporting itself lives in `@repo/editor-yjs`.
- Package config is DOM-specific but non-React: TypeScript extends the base config, ESLint declares explicit browser globals, and lint rules block React/runtime/storage/native imports, concrete Yjs transport providers, direct ProseMirror packages, and broad model imports.
- `editor-core` imports stay narrow: shared identifiers come from `@repo/editor-core/kernel`, block contracts from `@repo/editor-core/definitions` and `@repo/editor-core/document`, and inline text contracts from `@repo/editor-core/content/rich-text`.
- The previous two-way y-prosemirror binding, publication policy, plugin
  composer, and collaborative `EditorState` factory have been deleted.

## Target Boundary

- Keep this as a Yjs content projection and relative-position package.
- Let `editor-web` own mounted ProseMirror views and one-way finalized
  projection.
- Keep block reads narrow and block-local; page projection and lightweight read rendering should not require full live y-prosemirror stacks.
- Keep model usage limited to focused editor-core subpaths; neutral model commands, schemas, and reducers belong in `editor-core`.
- Persistence and collaboration consume finalized tagged operation updates
  from editor semantic publications, never raw `Y.Doc` observer events.

## Source Boundary Audit

- `src/api/index.ts` owns the complete public root surface. The package exposes only `@repo/editor-yjs-dom`; no public subpaths are exported.
- `src/text-points` owns relative text anchors.
- `src/content/seed`, `src/content/projection`, and `src/content/runtime` own
  hydration, narrow reads, staging, commit application, recovery, and release.
- `src/content/slots` adapts the Yjs content runtime to the editor content slot contracts.
- Domain tests live beside the domains they cover.

## Package Surface

```ts
import {
  createYjsBlockContentRuntime,
  createYjsRelativeTextPointCodec,
  ensureYjsBlockContent,
  readYjsBlockContentDocument,
  readYjsBlockContentPlainText,
} from "@repo/editor-yjs-dom";

import type {
  EditorYjsCommitOrigin,
  YjsRelativeTextPointCodec,
} from "@repo/editor-yjs-dom";
```

Only the root package export is public and it is emitted from
`dist/api/index.js` / `dist/api/index.d.ts`. There is no mounted-view binding
or collaboration plugin factory in the package surface.

## Boundaries

This package must not own React rendering, page/runtime structure, manifest queries, durable metadata, document-level ordering, model command reducers, model content schemas, transport setup, concrete Yjs providers, persistence, app-provider wiring, mobile-specific code, or platform-neutral Yjs lifecycle logic.

It depends on `@repo/editor-yjs` for collaboration contracts and on focused
`@repo/editor-core/*` subpaths for neutral identifiers, block IDs/types, and
inline text points.

## Tests

The package uses Vitest with an 80 percent threshold for statements, branches, functions, and lines.
