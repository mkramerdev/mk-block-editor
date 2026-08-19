import type { EDITOR_YJS_ORIGINS } from "./origins.ts";

export type EditorYjsOrigin =
  (typeof EDITOR_YJS_ORIGINS)[keyof typeof EDITOR_YJS_ORIGINS];
