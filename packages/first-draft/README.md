# @repo/editor-first-draft

First Draft is the repository's current product/example editor composition. It
combines the generic editor packages with concrete block definitions,
renderers, marks and inline atoms, product UI, a Yjs content runtime, transport
messages, and PostgreSQL persistence contracts.

Its public entrypoints cover the editor surface, definition and view-state
factory, bootstrap codec, fixture, transport/protocol, server-side
persistence helpers, and `first-draft.css`. See `package.json` for the exact
subpaths.

```sh
pnpm --filter @repo/editor-first-draft check-types
pnpm --filter @repo/editor-first-draft lint
pnpm --filter @repo/editor-first-draft test
pnpm --filter @repo/editor-first-draft build
```

The package is ready to be mounted by a React application. Collaboration
requires PostgreSQL and the `@repo/editor-realtime` service; see the
[service README](../../services/editor-realtime/README.md) for the local
development setup.

```tsx
import { FirstDraftEditorSurface } from "@repo/editor-first-draft/editor";
import "@repo/editor-web/styles.css";
import "@repo/editor-first-draft/first-draft.css";

<FirstDraftEditorSurface
  collaboration={{
    webSocketUrl: "ws://localhost:4455/editor-realtime",
    documentId: "01890f07-1c00-7000-8000-000000040001",
    actorId,
    clientId,
  }}
/>;
```

When `initialBootstrap` is omitted, the surface requests the full authoritative
document from the realtime service. When a matching bootstrap is supplied, it
resumes from that revision and applies the accepted transaction suffix before
enabling edits. The surface also owns the in-memory unresolved-transaction
outbox, presence attachment, product menus, and document/table drag-and-drop
lifecycle for its mounted session.
