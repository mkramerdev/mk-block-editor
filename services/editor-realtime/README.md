# @repo/editor-realtime

`@repo/editor-realtime` is the WebSocket and PostgreSQL service for the First
Draft collaborative example. In development it listens at
`http://127.0.0.1:4455`; clients connect to
`ws://127.0.0.1:4455/editor-realtime`.

This is an anonymous public-demo collaboration service. A client declares its
actor, client, session, and document identity in the initial protocol frame.
The service binds the socket to that session, enforces message consistency,
and isolates document rooms. It does not authenticate users or provide access
control, so it must only expose data intended for public demonstration.

## Configuration

The default development PostgreSQL connection is
`postgres://editor:editor@127.0.0.1:5435/editor_document`.

`src/config.ts` reads:

- `NODE_ENV`
- `EDITOR_DOCUMENT_POSTGRES_URL`
- `EDITOR_REALTIME_HOST`
- `EDITOR_REALTIME_PORT`

## Run locally

From the repository root:

```sh
pnpm install
docker compose up -d editor-db
pnpm db:reset:first-draft
pnpm dev:realtime
```

The reset command recreates the local database, installs the schema, and seeds
the First Draft document. Use `pnpm db:seed:first-draft` to seed an existing
empty database instead.

## Checks

```sh
pnpm --filter @repo/editor-realtime check-types
pnpm --filter @repo/editor-realtime lint
pnpm --filter @repo/editor-realtime test
pnpm --filter @repo/editor-realtime build
```
