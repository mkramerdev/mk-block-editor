/** Semantic Yjs transaction origins shared by editor content documents. */
export const EDITOR_YJS_ORIGINS = Object.freeze({
  LOCAL_EDIT: "@repo/editor-yjs/local-edit",
  REMOTE_UPDATE: "@repo/editor-yjs/remote-update",
  CONTENT_BOOTSTRAP: "@repo/editor-yjs/content-bootstrap",
} as const);
