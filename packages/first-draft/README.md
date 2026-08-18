# @repo/editor-first-draft

First Draft is the repository's current product/example editor composition. It
combines the generic editor packages with concrete block definitions,
renderers, marks and inline atoms, product UI, a Yjs content runtime, transport
messages, and PostgreSQL persistence contracts.

Its public entrypoints cover the editor surface, definition and view-state
factory, read-model bootstrap codec, fixture, transport/protocol, server-side
persistence helpers, and `first-draft.css`. See `package.json` for the exact
subpaths.

```sh
pnpm --filter @repo/editor-first-draft check-types
pnpm --filter @repo/editor-first-draft lint
pnpm --filter @repo/editor-first-draft test
pnpm --filter @repo/editor-first-draft build
```

The React playground mounts the example at `/first-draft`. Collaboration
requires PostgreSQL and the `@repo/editor-realtime` service. See the
[root README](../../README.md) for complete development setup.
