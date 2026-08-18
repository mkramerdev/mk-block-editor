"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  EditorDocument,
  toCollaborationSubjectKey,
} from "@repo/editor-web/document-runtime";
import { compileCanonicalEditorDefinition } from "@repo/editor-web/editor-definition";
import {
  initializeEditableEditor,
  type EditableEditor,
} from "@repo/editor-web/editor";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import { createFirstDraftEditorDefinition } from "./first-draft-definition.tsx";
import { createFirstDraftMessageDispatcher } from "./transport/collaboration-connection.ts";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
  type FirstDraftViewStateStore,
} from "./blocks/view-state.tsx";
import { handleTransaction } from "./transport/handle-transaction.ts";
import { createFirstDraftFinalizedCommitObserver } from "./transport/finalized-commit-observer.ts";
import { attachFirstDraftRemoteTransactions } from "./transport/remote-transaction-client.ts";
import {
  attachFirstDraftPresence,
  type FirstDraftPresenceAttachment,
} from "./transport/presence-client.ts";
import type {
  EditorTransactionAcceptedMessage,
  EditorTransactionPersistenceFailedMessage,
  FirstDraftParticipantPresence,
  FirstDraftSessionIdentity,
} from "./transport/message-protocol.ts";
import { encodeFirstDraftMessage } from "./transport/message-protocol.ts";
import { FirstDraftSelectionBadgeLayer } from "./first-draft-selection-badge-layer.tsx";
import { FirstDraftSelectionMenu } from "./selection-menu/index.ts";
import { FirstDraftSlashMenu } from "./slash-menu/index.ts";
import { FirstDraftMentionMenu } from "./mention-menu/index.ts";
import {
  FirstDraftBlockHoverProvider,
  FirstDraftBlockHoverTracker,
} from "./block-controls/index.ts";

export interface FirstDraftCollaborationOptions {
  readonly webSocketUrl: string;
  readonly documentId: string;
  readonly actorId: string;
  readonly clientId: string;
  readonly authenticationToken: string;
  readonly displayName?: string;
  readonly color?: string;
}

export type FirstDraftLifecycleObservation =
  | { readonly kind: "initial-document-received"; readonly revision: number }
  | { readonly kind: "editor-dom-mounted"; readonly revision: number }
  | { readonly kind: "revision-catch-up-complete"; readonly revision: number }
  | { readonly kind: "canonical-accepted"; readonly transactionId: string }
  | { readonly kind: "transaction-published"; readonly transactionId: string }
  | {
      readonly kind: "presence-published";
      readonly transactionId: string | null;
      readonly selectionRevision: number;
    };

const layout = {
  sideLeftWidth: "max(8rem, calc(50% - 38rem))",
  sideRightWidth: "max(8rem, calc(50% - 38rem))",
};

interface ConnectedEditorState {
  readonly editor: EditableEditor;
  readonly viewState: FirstDraftViewStateStore;
  readonly identity: FirstDraftSessionIdentity;
  readonly revision: number;
}

type FirstDraftConnectionStatus = "connecting" | "open" | "closed" | "error";

interface FirstDraftConnectionUiState {
  readonly generation: symbol | null;
  readonly loaded: ConnectedEditorState | null;
  readonly participants: readonly FirstDraftParticipantPresence[];
  readonly diagnostic: string | null;
  readonly status: FirstDraftConnectionStatus;
  readonly error: string | null;
}

interface FirstDraftConnectionInputs {
  readonly webSocketUrl: string;
  readonly documentId: string;
  readonly actorId: string;
  readonly clientId: string;
  readonly authenticationToken: string;
  readonly displayName?: string;
  readonly color?: string;
}

interface ActiveFirstDraftConnectionGeneration {
  readonly generation: symbol;
}

interface FirstDraftEditorSurfaceProps {
  readonly collaboration: FirstDraftCollaborationOptions | null;
  readonly onLifecycleObservation?: (
    observation: FirstDraftLifecycleObservation,
  ) => void;
}

/** Owns the sole socket, dispatcher, editor, and mounted document lifecycle. */
export function FirstDraftEditorSurface({
  collaboration,
  onLifecycleObservation,
}: FirstDraftEditorSurfaceProps) {
  const lifecycleObserver = useRef(onLifecycleObservation);
  useLayoutEffect(() => {
    lifecycleObserver.current = onLifecycleObservation;
  }, [onLifecycleObservation]);
  const observeLifecycle = useCallback(
    (observation: FirstDraftLifecycleObservation) =>
      lifecycleObserver.current?.(observation),
    [],
  );
  const hasCollaboration = collaboration !== null;
  const requestedWebSocketUrl = collaboration?.webSocketUrl ?? null;
  const requestedDocumentId = collaboration?.documentId ?? null;
  const requestedActorId = collaboration?.actorId ?? null;
  const requestedClientId = collaboration?.clientId ?? null;
  const requestedAuthenticationToken =
    collaboration?.authenticationToken ?? null;
  const requestedDisplayName = collaboration?.displayName;
  const requestedColor = collaboration?.color;
  const connectionInputs = useMemo<FirstDraftConnectionInputs | null>(
    () =>
      hasCollaboration
        ? Object.freeze({
            webSocketUrl: requestedWebSocketUrl!,
            documentId: requestedDocumentId!,
            actorId: requestedActorId!,
            clientId: requestedClientId!,
            authenticationToken: requestedAuthenticationToken!,
            ...(requestedDisplayName === undefined
              ? {}
              : { displayName: requestedDisplayName }),
            ...(requestedColor === undefined
              ? {}
              : { color: requestedColor }),
          })
        : null,
    [
      hasCollaboration,
      requestedActorId,
      requestedAuthenticationToken,
      requestedClientId,
      requestedColor,
      requestedDisplayName,
      requestedDocumentId,
      requestedWebSocketUrl,
    ],
  );
  const requestedGeneration = useMemo(
    () =>
      connectionInputs
        ? Symbol("first-draft-connection-generation")
        : null,
    [connectionInputs],
  );
  const activeGeneration = useRef<ActiveFirstDraftConnectionGeneration | null>(
    null,
  );
  const [ownedUi, setOwnedUi] = useState<FirstDraftConnectionUiState>(() =>
    initialConnectionUi(
      requestedGeneration,
      collaboration ? "connecting" : "closed",
    ),
  );
  const ui =
    connectionInputs === null
      ? initialConnectionUi(null, "closed")
      : ownedUi.generation === requestedGeneration
        ? ownedUi
        : initialConnectionUi(requestedGeneration, "connecting");

  useEffect(() => {
    if (!connectionInputs) {
      activeGeneration.current = null;
      return;
    }
    const generation = requestedGeneration!;
    activeGeneration.current = { generation };
    const { documentId, actorId, displayName, color } = connectionInputs;
    const socket = new WebSocket(connectionInputs.webSocketUrl);
    const dispatcher = createFirstDraftMessageDispatcher(socket);
    const identity: FirstDraftSessionIdentity = Object.freeze({
      actorId: connectionInputs.actorId,
      clientId: connectionInputs.clientId,
      sessionId: createSessionId(),
      documentId,
    });
    const subject = Object.freeze({
      actorId: identity.actorId,
      clientId: identity.clientId,
      sessionId: identity.sessionId,
    });
    let editor: EditableEditor | null = null;
    let presence: FirstDraftPresenceAttachment | null = null;
    let detachRemote: (() => void) | null = null;
    let disposed = false;
    const updateUi = (
      update: (
        current: FirstDraftConnectionUiState,
      ) => FirstDraftConnectionUiState,
    ) => {
      if (
        disposed ||
        activeGeneration.current?.generation !== generation
      )
        return;
      setOwnedUi((current) => {
        if (activeGeneration.current?.generation !== generation)
          return current;
        const owned =
          current.generation === generation
            ? current
            : initialConnectionUi(generation, "connecting");
        return update(owned);
      });
    };
    const observe = (observation: FirstDraftLifecycleObservation) => {
      if (!disposed) observeLifecycle(observation);
    };
    const fail = (next: Error) => {
      if (disposed) return;
      updateUi((current) => ({
        ...current,
        error: next.message,
        status: "error",
      }));
    };
    const onOpen = () => {
      if (disposed) return;
      socket.send(
        encodeFirstDraftMessage({
          type: "connect-first-draft-session",
          authenticationToken: connectionInputs.authenticationToken,
          ...identity,
        }),
      );
    };
    const onClose = () => {
      updateUi((current) => ({ ...current, status: "closed" }));
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    const unsubscribeMessages = dispatcher.subscribe((message) => {
      if (message.type === "first-draft-protocol-error") {
        fail(new Error(`${message.code}: ${message.message}`));
        return;
      }
      if (message.type === "first-draft-session-connected") {
        if (!sameIdentity(message, identity)) {
          fail(
            new Error("First Draft session confirmation identity is invalid"),
          );
          return;
        }
        socket.send(
          encodeFirstDraftMessage({
            type: "subscribe-first-draft-document",
            documentId,
          }),
        );
        return;
      }
      if (message.type === "first-draft-document-caught-up") {
        if (message.documentId !== documentId) return;
        updateUi((current) => ({ ...current, status: "open" }));
        observe({
          kind: "revision-catch-up-complete",
          revision: message.revision,
        });
        return;
      }
      if (message.type !== "first-draft-document-loaded") return;
      if (disposed) return;
      if (editor) {
        fail(
          new Error(
            "First Draft initial document was delivered more than once",
          ),
        );
        return;
      }
      if (message.documentId !== documentId) {
        fail(new Error("First Draft initial document identity is invalid"));
        return;
      }
      observe({
        kind: "initial-document-received",
        revision: message.revision,
      });
      const viewState = createFirstDraftViewStateStore({
        selectedTabs: {
          ["fd-tabs" as BlockId]: "fd-tab-overview" as BlockId,
        },
      });
      const compiledDefinition = compileCanonicalEditorDefinition(
        createFirstDraftEditorDefinition(viewState),
      );
      const publishTransaction = handleTransaction(socket, (transactionId) =>
        observe({ kind: "transaction-published", transactionId }),
      );
      const onChange = createFirstDraftFinalizedCommitObserver({
        publishTransaction: (change) => {
          observe({
            kind: "canonical-accepted",
            transactionId: change.transactionId,
          });
          publishTransaction(change);
        },
        publishSelection: (selection, transactionId) =>
          presence?.publishCommittedTransactionSelection(
            selection,
            transactionId,
          ),
        onObserverError: fail,
      });
      const createdEditor = initializeEditableEditor({
        compiledDefinition,
        snapshot: message.bootstrap.snapshot,
        validatedSnapshot: message.bootstrap,
        onChange,
        onChangeError: fail,
        createTransactionId: () => `${identity.sessionId}:${createSessionId()}`,
      });
      editor = createdEditor;
      addEditorBlockOperations(createdEditor);
      detachRemote = attachFirstDraftRemoteTransactions(dispatcher, createdEditor, {
        documentId,
        initialRevision: message.revision,
        onProtocolError: fail,
        onAccepted: (accepted: EditorTransactionAcceptedMessage) =>
          updateUi((current) => ({
            ...current,
            diagnostic: `${accepted.transactionId}: ${accepted.baseRevision} → ${accepted.revision}`,
          })),
        onPersistenceFailed: (
          failed: EditorTransactionPersistenceFailedMessage,
        ) =>
          updateUi((current) => ({
            ...current,
            diagnostic: `Persistence ${failed.reason}: ${failed.message}`,
          })),
      });
      presence = attachFirstDraftPresence(
        dispatcher,
        createdEditor,
        {
          documentId,
          subject,
          metadata: {
            displayName: displayName ?? actorId,
            color: color ?? "#4f46e5",
          },
        },
        {
          onParticipants: (participants) =>
            updateUi((current) => ({ ...current, participants })),
          onProtocolError: fail,
          onSelectionPublished: ({ selectionRevision, transactionId }) =>
            observe({
              kind: "presence-published",
              selectionRevision,
              transactionId,
            }),
        },
      );
      updateUi((current) => ({
        ...current,
        loaded: {
          editor: createdEditor,
          viewState,
          identity,
          revision: message.revision,
        },
      }));
    });
    const unsubscribeDecodeErrors = dispatcher.subscribeDecodeErrors(fail);
    const unsubscribeSocketErrors = dispatcher.subscribeSocketErrors(() =>
      fail(
        new Error("The First Draft collaboration socket reported an error."),
      ),
    );
    return () => {
      disposed = true;
      if (activeGeneration.current?.generation === generation)
        activeGeneration.current = null;
      presence?.dispose();
      detachRemote?.();
      unsubscribeMessages();
      unsubscribeDecodeErrors();
      unsubscribeSocketErrors();
      editor?.dispose();
      dispatcher.dispose();
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close(1000, "First Draft page disposed");
      }
    };
  }, [connectionInputs, observeLifecycle, requestedGeneration]);

  return (
    <>
      <output data-first-draft-collaboration-status={ui.status} aria-live="polite">
        Collaboration: {ui.status}
        {ui.error ? ` — ${ui.error}` : ""}
      </output>
      {ui.loaded && connectionInputs ? (
        <FirstDraftEditorDocument
          loaded={ui.loaded}
          collaboration={connectionInputs}
          participants={ui.participants}
          onLifecycleObservation={observeLifecycle}
        />
      ) : null}
      {ui.diagnostic ? (
        <output data-first-draft-last-diagnostic={ui.diagnostic}>
          Last collaboration diagnostic: {ui.diagnostic}
        </output>
      ) : null}
      <output data-first-draft-participant-count={ui.participants.length}>
        Remote peers: {ui.participants.length}
      </output>
      <ul aria-label="Remote First Draft participants">
        {ui.participants.map((participant) => (
          <li
            key={participantKey(participant)}
            data-first-draft-participant={participant.metadata.displayName}
            data-first-draft-participant-actor={participant.subject.actorId}
            data-first-draft-participant-client={participant.subject.clientId}
            data-first-draft-participant-session={participant.subject.sessionId}
          >
            <span
              aria-hidden="true"
              data-first-draft-participant-color={participant.metadata.color}
              style={{ color: participant.metadata.color }}
            >
              ●
            </span>{" "}
            {participant.metadata.displayName}
          </li>
        ))}
      </ul>
    </>
  );
}

function FirstDraftEditorDocument({
  loaded,
  collaboration,
  participants,
  onLifecycleObservation,
}: {
  readonly loaded: ConnectedEditorState;
  readonly collaboration: FirstDraftCollaborationOptions;
  readonly participants: readonly FirstDraftParticipantPresence[];
  readonly onLifecycleObservation: (
    observation: FirstDraftLifecycleObservation,
  ) => void;
}) {
  const { editor, viewState, identity, revision } = loaded;
  useLayoutEffect(() => {
    onLifecycleObservation({ kind: "editor-dom-mounted", revision });
  }, [editor, onLifecycleObservation, revision]);
  return (
    <FirstDraftViewStateProvider store={viewState}>
      <section
        className="first-draft-example"
        data-editor-interaction-scope="true"
        aria-label="First Draft editor"
      >
        <div
          className="first-draft-example__toolbar"
          role="toolbar"
          aria-label="Editor history"
        >
          <button type="button" onClick={() => editor.undo()}>
            Undo
          </button>
          <button type="button" onClick={() => editor.redo()}>
            Redo
          </button>
          <span>Use Tab / Shift+Tab to nest or reparent blocks.</span>
        </div>
        <FirstDraftBlockHoverProvider enabled={editor.editable}>
          <FirstDraftBlockHoverTracker className="first-draft-block-hover-tracker">
            <EditorDocument
              editor={editor}
              layout={layout}
              renderDocumentLayers={(context) => (
                <>
                  <FirstDraftSelectionBadgeLayer
                    editor={context.editor}
                    participants={participants}
                    localSubject={{
                      actorId: collaboration.actorId,
                      clientId: collaboration.clientId,
                      sessionId: identity.sessionId,
                    }}
                  />
                  <FirstDraftSelectionMenu editor={context.editor} />
                  <FirstDraftSlashMenu
                    editor={context.editor}
                    geometry={context.editor.geometry}
                    interactions={context.interactions}
                  />
                  <FirstDraftMentionMenu
                    editor={context.editor}
                    geometry={context.editor.geometry}
                    interactions={context.interactions}
                  />
                </>
              )}
            />
          </FirstDraftBlockHoverTracker>
        </FirstDraftBlockHoverProvider>
      </section>
    </FirstDraftViewStateProvider>
  );
}

function initialConnectionUi(
  generation: symbol | null,
  status: Extract<FirstDraftConnectionStatus, "connecting" | "closed">,
): FirstDraftConnectionUiState {
  return {
    generation,
    loaded: null,
    participants: Object.freeze([]),
    diagnostic: null,
    status,
    error: null,
  };
}

function createSessionId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `session-${Date.now()}-${Math.random()}`
  );
}

function sameIdentity(
  left: FirstDraftSessionIdentity,
  right: FirstDraftSessionIdentity,
): boolean {
  return (
    left.actorId === right.actorId &&
    left.clientId === right.clientId &&
    left.sessionId === right.sessionId &&
    left.documentId === right.documentId
  );
}

function participantKey(participant: FirstDraftParticipantPresence): string {
  return (
    toCollaborationSubjectKey(participant.subject) ??
    `${participant.subject.actorId}:${participant.subject.clientId}:${participant.subject.sessionId}`
  );
}
