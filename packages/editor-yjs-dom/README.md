# @repo/editor-yjs-dom

`@repo/editor-yjs-dom` supplies the Yjs-backed canonical content runtime and
relative text-anchor codec used by the web editor. Runtime-neutral Yjs
documents, updates, checkpoints, and origins come from `@repo/editor-yjs`.
First Draft owns the current transport protocol; this package does not own a
WebSocket protocol or provider.

It does not bind a mounted ProseMirror view to Yjs. ProseMirror proposals enter
the canonical editor transaction boundary, and mounted views receive only the
finalized canonical projection from `@repo/editor-web`.

## Current responsibilities

- `ensureYjsBlockContent(...)` seeds block-local canonical content.
- `readYjsBlockContentDocument(...)`,
  `readYjsBlockContentDocumentFromUpdates(...)`, and
  `readYjsBlockContentPlainText(...)` provide narrow canonical reads.
- `createYjsRelativeTextPointCodec(...)` encodes and resolves block-local Yjs
  relative positions with the requested association.
- `createYjsBlockContentRuntime(...)` implements validation, preparation,
  commit, projection publication, block leases, checkpoint maintenance, remote
  update application, and consistency guards.
- `yjsBlockContentStore` adapts that runtime to the editor content-slot
  contract.

## Commit and checkpoint behavior

Every existing text block starts with both an exact canonical read projection
and an opaque Yjs checkpoint. A block-local `Y.Doc` is hydrated lazily from that
checkpoint and can be released when its leases reach zero.

For an ordinary accepted local edit, the runtime:

1. prepares and validates canonical logical operations;
2. plans their incremental mutations against the existing block-local Yjs
   context;
3. mutates the existing `Y.Doc` in one Yjs transaction;
4. captures all update events caused by that transaction and merges them into
   one effective operation update;
5. immediately merges that operation update into the previously accepted
   opaque checkpoint; and
6. stores the exact finalized canonical projection before publication.

The runtime does not encode the complete live document after every ordinary
commit. A newly introduced text block is the exception: it must establish an
initial complete Yjs state, after which later operations are incremental.

Remote validation checks graph/base authority, update envelopes, duplicate or
already-applied updates, introduced/removed blocks, and the supplied canonical
read projection. It does not use a disposable staging-clone architecture.
Accepted remote updates are applied to a live context when one exists and are
always merged immediately into the maintained opaque checkpoint. Later context
hydration therefore sees the complete accepted state without waiting for an
explicit checkpoint read.

`readBlockContentCheckpoint(...)` returns the maintained checkpoint; it does
not trigger a new full-document encode. Context release and subsequent
hydration use that same checkpoint.

## Failure behavior

All blocks are validated before live application begins, and publication waits
until application completes. There is no reverse-compensation path for an
unexpected failure partway through a multi-block live mutation. Such a failure
marks the runtime inconsistent and throws `Fatal Yjs live mutation failure`;
subsequent editable access is rejected. Callers must treat that as fatal and
recover from an authoritative snapshot/checkpoint rather than assuming a
rollback occurred.

## History and projection boundary

Operation anchors and selection anchors are separate contracts even though both
serialize Yjs relative positions. Operation associations come from operation
semantics. The shared editor-react history algorithm resolves one current
replay plan, applies ordinary canonical operations, and captures a new opposite
plan around the Yjs items created by that replay. Temporary block documents are
rehydrated and released sequentially for multi-block history; serialized
history retains no YDoc, Yjs type, lease, context, or `Y.UndoManager`.

Redo intentionally creates new CRDT items. Fully received causal edits are
positioned by refreshed relative anchors. Delayed delivery of an edit that was
causally dependent on an identity already removed and recreated by local
undo/redo remains unsupported because editor history does not preserve original
CRDT item identities.

Yjs observers capture expected commit output and guard against unexpected live
mutation. They do not discover editor operations, publish transport messages,
or dispatch ProseMirror transactions. Awareness, presence UI, remote-caret
rendering, persistence, and collaboration transport are outside this package.

## Public surface

Only the root package export is public:

```ts
import {
  createYjsBlockContentCheckpoint,
  createYjsBlockContentRuntime,
  createYjsRelativeTextPointCodec,
  ensureYjsBlockContent,
  readYjsBlockContentDocument,
  readYjsBlockContentDocumentFromUpdates,
  readYjsBlockContentPlainText,
  yjsBlockContentStore,
} from "@repo/editor-yjs-dom";
```

The package has no mounted-view binding or collaboration plugin factory.

## Validation

Vitest enforces 80 percent thresholds for statements, branches, functions, and
lines.

```sh
pnpm --filter @repo/editor-yjs-dom check-types
pnpm --filter @repo/editor-yjs-dom lint
pnpm --filter @repo/editor-yjs-dom test
pnpm --filter @repo/editor-yjs-dom build
```
