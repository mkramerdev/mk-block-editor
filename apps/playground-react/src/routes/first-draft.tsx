import { FirstDraftEditorSurface } from "@repo/editor-first-draft/editor";
import "@repo/editor-web/styles.css";
import "@repo/editor-first-draft/first-draft.css";

const SEEDED_DOCUMENT_ID =
  import.meta.env.VITE_FIRST_DRAFT_DOCUMENT_ID ??
  "01890f07-1c00-7000-8000-000000040001";

const browserIdentity = createBrowserIdentity();

export default function FirstDraft() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const webSocketUrl =
    import.meta.env.VITE_EDITOR_REALTIME_URL ??
    `${protocol}//${window.location.hostname}:4455/editor-realtime`;

  return (
    <main className="first-draft-route">
      <header className="first-draft-route__header">
        <p className="eyebrow">First Draft</p>
        <h1>Collaborative editor</h1>
        <p>
          Document <code>{SEEDED_DOCUMENT_ID}</code>
        </p>
      </header>
      <div className="first-draft-route__editor">
        <FirstDraftEditorSurface
          collaboration={{
            webSocketUrl,
            documentId: SEEDED_DOCUMENT_ID,
            actorId: browserIdentity.actorId,
            clientId: browserIdentity.clientId,
            authenticationToken: "dev-editor-realtime-token",
            displayName: "Playground editor",
            color: "#4f46e5",
          }}
        />
      </div>
    </main>
  );
}

function createBrowserIdentity(): {
  readonly actorId: string;
  readonly clientId: string;
} {
  const randomId = () =>
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    actorId: `playground-actor-${randomId()}`,
    clientId: `playground-client-${randomId()}`,
  };
}
