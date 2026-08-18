# @repo/editor-realtime

`@repo/editor-realtime` is the WebSocket and PostgreSQL service for the First
Draft collaborative example. In development it listens at
`http://127.0.0.1:4455`; clients connect to
`ws://127.0.0.1:4455/editor-realtime`.

## Configuration

The default development PostgreSQL connection is
`postgres://editor:editor@127.0.0.1:5435/editor_document`.

`src/config.ts` reads:

- `NODE_ENV`
- `EDITOR_DOCUMENT_POSTGRES_URL`
- `EDITOR_REALTIME_HOST`
- `EDITOR_REALTIME_PORT`
- `EDITOR_REALTIME_AUTH_MODE`
- `EDITOR_REALTIME_DEV_SHARED_TOKEN`
- `EDITOR_REALTIME_JWKS_URL`
- `EDITOR_REALTIME_JWT_ISSUER`
- `EDITOR_REALTIME_JWT_AUDIENCE`

Development defaults to `EDITOR_REALTIME_AUTH_MODE=dev-shared` and token
`dev-editor-realtime-token`. The `jwt-jwks` values are parsed, but the current
JWT/JWKS authenticator is not implemented and rejects connections.

## Run locally

From the repository root:

```sh
pnpm install
docker compose up -d editor-db
pnpm db:reset:first-draft
pnpm --filter @repo/editor-realtime dev
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
