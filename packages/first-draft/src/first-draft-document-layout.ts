import type { EditorLayoutConfig } from "@repo/editor-web/document-runtime";

export const firstDraftDocumentLayout = {
  sideLeftWidth: "max(8rem, calc(50% - 28rem))",
  sideRightWidth: "max(8rem, calc(50% - 28rem))",
} satisfies EditorLayoutConfig;
