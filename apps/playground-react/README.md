# React playground

This Vite and React playground runs on
[http://localhost:3001](http://localhost:3001).

```sh
pnpm dev:playground-react
```

Registered routes are:

- `/` - playground home;
- `/full-editor` - currently a registered placeholder with no rendered editor;
- `/first-draft` - the collaborative First Draft editor.

`/first-draft` requires PostgreSQL and `@repo/editor-realtime`; follow the
[root development setup](../../README.md). Set `VITE_EDITOR_REALTIME_URL` to
override the WebSocket URL and `VITE_FIRST_DRAFT_DOCUMENT_ID` to override the
seeded document ID.
