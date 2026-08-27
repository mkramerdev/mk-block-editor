import { useState } from "react";
import { FirstDraftEditorSurface } from "@repo/editor-first-draft/editor";

interface BrowserSession {
  readonly actorId: string;
  readonly clientId: string;
  readonly webSocketUrl: string;
}

export interface MkBlockEditorPageProps {
  readonly documentId?: string;
}

export function MkBlockEditorPage({
  documentId = configuredDocumentId(),
}: MkBlockEditorPageProps) {
  const [session] = useState(createBrowserSession);

  return (
    <main className="mk-block-editor-route max-w-5xl mx-auto">
      <header className="mk-block-editor-route__header">
        <div>
          <p className="mk-block-editor-route__eyebrow">Work in progress</p>
          <h1>MK&apos;s Block Editor</h1>
        </div>
        <p className="mk-block-editor-route__document">
          Document <code>{documentId}</code>
        </p>
      </header>
      <div className="mk-block-editor-route__editor">
        <FirstDraftEditorSurface
          collaboration={{
            webSocketUrl: session.webSocketUrl,
            documentId,
            actorId: session.actorId,
            clientId: session.clientId,
            displayName: `Visitor ${shortDisplayId(session.actorId)}`,
            color: "#4f46e5",
          }}
        />
      </div>
    </main>
  );
}

function createBrowserSession(): BrowserSession {
  const actorToken = randomId();
  const clientToken = randomId();
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

  return {
    actorId: `visitor-${actorToken}`,
    clientId: `client-${clientToken}`,
    webSocketUrl:
      import.meta.env.VITE_EDITOR_REALTIME_URL?.trim() ||
      `${protocol}//${window.location.hostname}:4455/editor-realtime`,
  };
}

function configuredDocumentId(): string {
  return (
    import.meta.env.VITE_FIRST_DRAFT_DOCUMENT_ID?.trim() ||
    "01890f07-1c00-7000-8000-000000040001"
  );
}

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function shortDisplayId(identity: string): string {
  const normalized = identity.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return normalized.slice(-6) || "anon";
}
