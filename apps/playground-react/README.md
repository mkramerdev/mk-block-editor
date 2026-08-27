# React playground

This Vite and React playground runs on
[http://localhost:3001](http://localhost:3001).

```sh
pnpm dev:playground-react
```

Registered routes are:

- `/` - playground home;
- `/first-draft` - the collaborative First Draft editor;
- `/mk-block-editor` - compatibility redirect to `/first-draft`; and
- `/full-editor` - compatibility redirect to `/first-draft`.

`/first-draft` requires PostgreSQL and `@repo/editor-realtime`; follow the
[root development setup](../../README.md). Set `VITE_EDITOR_REALTIME_URL` to
override the WebSocket URL and `VITE_FIRST_DRAFT_DOCUMENT_ID` to override the
seeded document ID. Put local browser overrides in this app's `.env.local`
file. With no overrides, the route uses the repository's seeded document and
`ws://localhost:4455/editor-realtime`.
