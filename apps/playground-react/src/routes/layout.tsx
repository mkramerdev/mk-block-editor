import type { ReactNode } from "react";
import "@repo/editor-web/styles.css";
import "@repo/editor-first-draft/first-draft.css";
import "./mk-block-editor.css";

export default function MkBlockEditorLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="mk-block-editor-shell">
      <header className="bg-background">
        <div className="px-4 py-3 md:px-8 md:py-4">
          <a href="/">React playground</a>
        </div>
      </header>
      <div className="min-h-0">{children}</div>
    </div>
  );
}
