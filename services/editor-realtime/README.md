# @repo/editor-realtime

`@repo/editor-realtime` is the WebSocket and PostgreSQL service for the First
Draft collaborative example. In development it listens at
`http://127.0.0.1:4455`; clients connect to
`ws://127.0.0.1:4455/editor-realtime`.

This is an anonymous public-demo collaboration service. A client declares its
actor, client, session, and document identity in the initial protocol frame.
The service binds the socket to that session, permits only explicitly
allowlisted demo documents, normalizes public visitor metadata, validates the
browser Origin header, and isolates document rooms. These controls reduce
abuse but are not user authentication.

## Configuration

The default development PostgreSQL connection is
`postgres://editor:editor@127.0.0.1:5435/editor_document`.
Set `EDITOR_DB_PORT` when invoking Docker Compose and
`EDITOR_DOCUMENT_POSTGRES_URL` for the package commands if port 5435 is already
in use.

`src/config.ts` reads:

- `NODE_ENV`
- `EDITOR_DOCUMENT_POSTGRES_URL`
- `EDITOR_REALTIME_HOST`
- `EDITOR_REALTIME_PORT`
- `EDITOR_REALTIME_PUBLIC_DOCUMENT_IDS` (comma-separated, required in production)
- `EDITOR_REALTIME_ALLOWED_ORIGINS` (comma-separated HTTP(S) origins, required in production)
- `EDITOR_REALTIME_MAX_CONNECTIONS`
- `EDITOR_REALTIME_MAX_CONNECTIONS_PER_ADDRESS`
- `EDITOR_REALTIME_MAX_SESSIONS_PER_DOCUMENT`
- `EDITOR_REALTIME_MAX_MESSAGES_PER_WINDOW` and `EDITOR_REALTIME_MESSAGE_WINDOW_MS`
- `EDITOR_REALTIME_MAX_TRANSACTIONS_PER_WINDOW` and `EDITOR_REALTIME_TRANSACTION_WINDOW_MS`
- `EDITOR_REALTIME_MAX_BYTES_PER_WINDOW` and `EDITOR_REALTIME_BYTE_WINDOW_MS`
- `EDITOR_REALTIME_MAX_CLIENT_FRAME_BYTES` (defaults to 2 MiB and is enforced on raw inbound client frames before decoding or copying)
- `EDITOR_REALTIME_MAX_PENDING_TRANSACTIONS_PER_DOCUMENT`

In development, the default origin allowlist includes loopback hosts for both
the Next.js playground on port 3000 and the Vite playground on port 3001.

The canonical one-minute defaults permit 2,400 total messages and 600
transactions per connection. Each connection is additionally limited to 64
MiB of inbound traffic per minute. Proposed transaction frames are capped at 2
MiB, comfortably above First Draft's 512 KiB aggregate-update cap while well
below the protocol-wide 32 MiB frame ceiling. At most 64 persistence
transactions may be active or queued for one document; admission for other
documents remains independent.

Connection and rate limits are in-process and apply independently to each
realtime-service instance. They are deliberately not distributed limits.
Remote-address limits use the socket peer address. The service does not trust
`X-Forwarded-For`; a proxy must enforce its own client-IP limits. TLS may
terminate at the reverse proxy, which must preserve the browser `Origin`
header and proxy WebSocket upgrade headers unchanged.

## Initial load and revision resume

A client with no local bootstrap omits `knownRevision`; the service loads the
authoritative PostgreSQL snapshot and sends `first-draft-document-loaded`.
This is how the Vite playground loads the seeded document. A client that
already has a bootstrap sends its revision, receives only the contiguous
accepted transaction suffix, and waits for caught-up confirmation before
enabling editing or presence. If that revision cannot be resumed, the service
sends `first-draft-document-resynchronized` and catches up from the returned
authoritative revision.

An unexpected disconnect freezes editing but retains the document-session
outbox. An explicit retry attaches a new socket generation, completes revision
catch-up, resolves accepted local replays without applying them twice, and only
then resends unresolved entries with their original transaction IDs and Yjs
bytes. An authoritative resynchronization is rejected while unresolved local
work makes acceptance unknowable.

## Run locally

From the repository root:

```sh
pnpm install
cp .env.example .env
docker compose up -d editor-db
pnpm db:reset:first-draft
pnpm dev:realtime
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp`. Compose
publishes the development database on loopback port 5435 so the guarded
host-side seed/reset scripts and optional PostgreSQL tests can reach it. Set a
different `EDITOR_DB_PORT` and matching `EDITOR_DOCUMENT_POSTGRES_URL` if that
port is already in use. Production deployments must replace the development
password and should avoid publishing PostgreSQL outside a trusted interface.

The reset command recreates the local development database, installs the
schema, and seeds the First Draft document. Use `pnpm db:seed:first-draft` to
seed an existing empty database instead.

To recover only the configured public demo document, provide the exact runtime
database URL, route document ID, and matching realtime allowlist, then run:

```sh
pnpm db:restore:first-draft
```

That command requires explicit `EDITOR_DOCUMENT_POSTGRES_URL`,
`FIRST_DRAFT_DOCUMENT_ID`, and `EDITOR_REALTIME_PUBLIC_DOCUMENT_IDS` values. It
atomically deletes and reseeds only the selected document; it does not recreate
the database or affect other documents. Restart the realtime service
immediately afterward so active sessions cannot continue from the old revision
history. No reset or restore operation is exposed over HTTP or WebSocket.

## Checks

```sh
pnpm --filter @repo/editor-realtime check-types
pnpm --filter @repo/editor-realtime lint
pnpm --filter @repo/editor-realtime test
pnpm --filter @repo/editor-realtime build
```
