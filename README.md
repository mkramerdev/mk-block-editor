# Block editor

This monorepo contains a canonical block editor, its React/DOM and Yjs
adapters, the First Draft product surface, a PostgreSQL-backed realtime
service, and React and Next.js playgrounds.

## Quick start: collaborative editor

Prerequisites:

- Node.js 22.13 or newer;
- pnpm 11 (Corepack is recommended); and
- Docker with Docker Compose.

After cloning the repository, run these commands from its root:

```sh
corepack enable
pnpm install
```

Create the local Compose environment file. On macOS/Linux:

```sh
cp .env.example .env
```

On PowerShell:

```powershell
Copy-Item .env.example .env
```

Start PostgreSQL, recreate its local development database, and seed the
example document:

```sh
docker compose up -d editor-db
pnpm db:reset:first-draft
```

Then start the realtime service and React playground in two terminals:

```sh
pnpm dev:realtime
```

```sh
pnpm dev:playground-react
```

Open [http://localhost:3001/first-draft](http://localhost:3001/first-draft).
Open it in a second browser tab to test realtime collaboration. The route
connects to `ws://localhost:4455/editor-realtime` and asks the service for the
seeded document `01890f07-1c00-7000-8000-000000040001`.

The local PostgreSQL URL is
`postgres://editor:editor@127.0.0.1:5435/editor_document`. To stop the local
database without deleting its volume, run `docker compose down`.

## Configuration

The checked-in defaults work with the quick start. Useful overrides are:

- `EDITOR_DOCUMENT_POSTGRES_URL` for host-side database scripts and the
  realtime service;
- `FIRST_DRAFT_SEED_DOCUMENT_ID` for seed/reset commands;
- `EDITOR_REALTIME_HOST`, `EDITOR_REALTIME_PORT`,
  `EDITOR_REALTIME_PUBLIC_DOCUMENT_IDS`, and
  `EDITOR_REALTIME_ALLOWED_ORIGINS` for the realtime service;
- `VITE_EDITOR_REALTIME_URL` and `VITE_FIRST_DRAFT_DOCUMENT_ID` for the React
  playground.

Vite reads browser overrides from `apps/playground-react/.env.local`. Docker
Compose reads the root `.env`. Development defaults allow both playground
origins on ports 3000 and 3001.

`pnpm db:seed:first-draft` installs the schema in an empty database and seeds
the document without recreating the database. `pnpm db:reset:first-draft`
recreates only the explicitly guarded local development database. See the
[realtime service guide](services/editor-realtime/README.md) for production
configuration and document recovery.

## Development commands

```sh
pnpm dev                    # realtime service and both playgrounds
pnpm dev:realtime           # realtime service only
pnpm dev:playground-react   # Vite + React playground on port 3001
pnpm dev:playground         # Next.js playground on port 3000
```

The public commands build the selected consumer's workspace dependencies and
then keep that graph current through Turbo watch. Package runtime exports and
package-owned CSS resolve from generated `dist` output; leaf consumers still
run from their own source.

The React playground routes are:

- `/first-draft` - the collaborative First Draft editor;
- `/mk-block-editor` - redirects to `/first-draft`;
- `/full-editor` - redirects to `/first-draft` for compatibility; and
- `/` - the playground home.

## Workspace packages

| Package                    | Responsibility                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `@repo/editor-core`        | Platform-neutral document model, definitions, rich text, operations, validation, codecs, and structural transaction types. |
| `@repo/editor-react`       | Platform-neutral editor controller, linear history, canonical selection, and React-facing stores.                          |
| `@repo/editor-dom`         | Block-local ProseMirror schema, plugins, keymaps, coordinate codecs, semantic HTML, and DOM adapters.                      |
| `@repo/editor-web`         | Editable React DOM document surface, shared movable `EditorView`, focus, geometry, clipboard, input, and mounting.         |
| `@repo/editor-yjs`         | Runtime-neutral Yjs primitives, canonical conversion, updates, state vectors, and checkpoints.                             |
| `@repo/editor-yjs-dom`     | Yjs-backed content runtime, maintained block checkpoints, and relative text anchors.                                       |
| `@repo/editor-first-draft` | Product definition, renderers, menus, drag-and-drop, transport protocol, bootstrap codec, and PostgreSQL persistence.      |
| `@repo/editor-realtime`    | First Draft WebSocket and PostgreSQL service.                                                                              |

Generic packages do not import First Draft or the realtime service. Public APIs
use explicit package subpaths; consult each package README and `package.json`
for its supported entrypoints.

## Editor initialization

The web editor has one editable definition and initialization path:

```ts
import { initializeEditableEditor } from "@repo/editor-web/editor";
import { compileCanonicalEditorDefinition } from "@repo/editor-web/editor-definition";

const editor = initializeEditableEditor({
  compiledDefinition: compileCanonicalEditorDefinition(editableDefinition),
  snapshot,
  onChange,
});
```

An `EditableEditorDefinition` supplies blocks (including their renderers), a
default text root, inline marks and atoms, and optional codecs, typing triggers,
content-runtime factory, document validators, internal-selection subsystems,
selection-fragment policy, commands, and keybindings.

## Validation

The default checks do not require PostgreSQL:

```sh
pnpm build
pnpm check-types
pnpm lint
pnpm test
pnpm test:development-contracts
pnpm test:development-clean-start
```

Formatting is an independent repository check: `pnpm format:check` reports
files that differ from the configured Prettier style, while `pnpm lint` runs
package ESLint checks.

PostgreSQL acceptance suites are separate and run only when explicitly
requested by their package scripts.

The realtime service is an anonymous public-demo server, not an authentication
or authorization layer. Use it only with documents intended for public
demonstration unless an authenticated boundary is added in front of it.
