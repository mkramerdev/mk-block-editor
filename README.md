# Block editor

This repository contains a canonical block editor split into platform-neutral,
React/session, DOM, web, Yjs, product-composition, and realtime packages. The
current product example is First Draft; the Vite playground mounts that
collaborative surface and also registers a placeholder full-editor route.

## Package ownership

| Package                    | Responsibility                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@repo/editor-core`        | Platform-neutral document model, block definitions, canonical rich text, operations, validation, codecs, and structural editing plans. |
| `@repo/editor-react`       | Platform-neutral editor controller, one linear history, canonical selection, and React-facing external stores.                         |
| `@repo/editor-dom`         | Block-local ProseMirror schema, plugins, keymaps, coordinate codecs, semantic HTML codecs, and DOM adapters.                           |
| `@repo/editor-web`         | React DOM document surface, one shared movable `EditorView`, focus, geometry, clipboard, browser input, and mounting.                  |
| `@repo/editor-yjs`         | Runtime-neutral Yjs primitives, canonical Yjs conversion, update/state-vector helpers, and checkpoint helpers.                         |
| `@repo/editor-yjs-dom`     | Yjs-backed editor content runtime, maintained block checkpoints, and relative text anchors.                                            |
| `@repo/editor-first-draft` | Current product/example definition, renderers, UI, transport protocol, and PostgreSQL persistence model.                               |
| `@repo/editor-realtime`    | Current First Draft WebSocket and PostgreSQL service.                                                                                  |

Public APIs use explicit package subpaths. Generic packages do not import First
Draft or the realtime service.

## Editor definitions

The web `EditorDefinition` contract is the complete static composition input.
Every read or editable definition requires:

```text
EditorDefinition
|- blocks
|- defaultRoot
|- inlineMarks
`- inlineAtoms
```

`blocks` maps persisted block types to web block definitions; each definition
contains its renderer directly. `defaultRoot` must name a text block.

The current optional composition fields are:

- `contentCodecs` for HTML, plain-text, and internal-selection handlers;
- `typingTriggers` for headless trigger recognition;
- `contentImport` for the default plain-text block type;
- `content` for an alternate content-runtime factory, such as Yjs;
- `documentValidators` for complete structural validation;
- `blockInternalSelectionSubsystems` for product-defined internal selections;
- `selectionFragment` for product view-state shaping during clipboard
  materialization; and
- editable-only `commands` and `keybindings`.

Use the read and editable entrypoints explicitly:

```ts
import { initializeEditableEditor } from "@repo/editor-web/editor";
import { compileCanonicalEditorDefinition } from "@repo/editor-web/editor-definition";
import {
  compileReadEditorDefinition,
  initializeReadEditor,
} from "@repo/editor-web/read-runtime";

const editor = initializeEditableEditor({
  compiledDefinition: compileCanonicalEditorDefinition(editableDefinition),
  snapshot,
  onChange,
});

const readEditor = initializeReadEditor({
  compiledDefinition: compileReadEditorDefinition(readDefinition),
  snapshot,
});
```

Editable initialization creates the canonical editor runtime and editable
resources. Its shared ProseMirror view is still created lazily only when a text
block is activated. Read initialization has no ProseMirror view or editable
resource path.

## Development

The repository requires Node.js 22.13 or newer, pnpm 11, Docker, and Docker
Compose.

```sh
pnpm install
docker compose up -d editor-db
pnpm db:reset:first-draft
pnpm dev:realtime
pnpm dev:playground-react
```

`db:reset:first-draft` recreates the local First Draft database and seeds the
example document. To seed an existing empty database without recreating it,
run `pnpm db:seed:first-draft` instead.

The supported development entrypoints are:

```sh
pnpm dev                    # all consumers
pnpm dev:realtime           # realtime service only
pnpm dev:playground-react   # Vite playground only
pnpm dev:playground         # Next.js playground only
```

Each command first asks Turbo to build only the selected consumer's workspace
dependencies. It then keeps the same dependency graph under `turbo watch`.
Package `build` tasks exclusively own their `dist` directories; package source
changes rerun those tasks in dependency order, and the selected consumer is
restarted only after the required builds succeed. The leaf process still runs
its own source (`vite`, `next dev`, or `tsx src/index.ts`), so development never
requires `apps/playground-react/dist`, a production `.next` build, or
`services/editor-realtime/dist`.

All runtime package exports resolve to generated files in package `dist`
directories. The `types` export condition may continue to expose TypeScript
source for compile-time type resolution; Node, Vite, Next.js, and other runtime
conditions do not use those paths. `@repo/editor-web/styles.css` and
`@repo/editor-first-draft/first-draft.css` likewise resolve to package-owned
compiled/copied CSS output.

The leaf `dev:consumer` scripts and package `dev:compiler` scripts are internal
building blocks, not standalone repository development entrypoints.

Open [http://localhost:3001/first-draft](http://localhost:3001/first-draft) for
the collaborative example. `/full-editor` is also registered in the React
playground, but its current route component is a placeholder that renders no
editor surface.

The development PostgreSQL URL is
`postgres://editor:editor@127.0.0.1:5435/editor_document`. The realtime service
listens on port `4455`; its WebSocket route is
`ws://localhost:4455/editor-realtime`.

The realtime service is an anonymous public-demo collaboration server. Each
client declares its actor, client, session, and document identity in the first
protocol frame. The server validates that later messages remain consistent
with that established session and isolates collaboration by document room. It
does not authenticate users or provide access control, so connect it only to
data intended for public demonstration.

Relevant service variables are `EDITOR_DOCUMENT_POSTGRES_URL`,
`EDITOR_REALTIME_HOST`, and `EDITOR_REALTIME_PORT`. The React playground accepts
`VITE_EDITOR_REALTIME_URL` and `VITE_FIRST_DRAFT_DOCUMENT_ID`; the seed script
accepts `FIRST_DRAFT_SEED_DOCUMENT_ID`.

Repository-wide checks are:

```sh
pnpm lint
pnpm check-types
pnpm build
```
