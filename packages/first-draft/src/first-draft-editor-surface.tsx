"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  EditorDocument,
  toCollaborationSubjectKey,
  type EditorSelectionDragSnapshot,
} from "@repo/editor-web/document-runtime";
import { compileCanonicalEditorDefinition } from "@repo/editor-web/editor-definition";
import {
  initializeEditableEditor,
  type EditorChangeCallback,
} from "@repo/editor-web/editor";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import { createFirstDraftEditorDefinition } from "./first-draft-definition.tsx";
import { createFirstDraftMessageDispatcher } from "./transport/collaboration-connection.ts";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
  type FirstDraftViewStateStore,
} from "./blocks/view-state.tsx";
import {
  createFirstDraftOutboundPublisher,
  type FirstDraftOutboundPublisher,
} from "./transport/outbound-publisher.ts";
import { attachFirstDraftRemoteTransactions } from "./transport/remote-transaction-client.ts";
import {
  attachFirstDraftPresence,
  type FirstDraftPresenceAttachment,
  type FirstDraftPresencePublicationRevisions,
} from "./transport/presence-client.ts";
import type {
  FirstDraftParticipantPresence,
  FirstDraftSessionIdentity,
} from "./transport/message-protocol.ts";
import { encodeFirstDraftMessage } from "./transport/message-protocol.ts";
import { FirstDraftSelectionBadgeLayer } from "./first-draft-selection-badge-layer.tsx";
import { FirstDraftSelectionMenu } from "./selection-menu/index.ts";
import { FirstDraftSlashMenu } from "./slash-menu/index.ts";
import { FirstDraftMentionMenu } from "./mention-menu/index.ts";
import { FirstDraftLinkPopover } from "./link-popover/index.ts";
import {
  createFirstDraftTableActionMenuStore,
  FirstDraftTableActionMenuLayer,
  FirstDraftTableActionMenuProvider,
} from "./table-action-menu/index.ts";
import {
  createFirstDraftBlockActionMenuStore,
  FirstDraftBlockActionMenuLayer,
} from "./block-action-menu/index.ts";
import {
  createFirstDraftTabsActionUiStore,
  FirstDraftTabsActionMenuLayer,
  FirstDraftTabsActionUiProvider,
} from "./tabs-action-menu/index.ts";
import { FirstDraftBlockHoverProvider } from "./block-controls/index.ts";
import { firstDraftDocumentLayout } from "./first-draft-document-layout.ts";
import { FirstDraftToolbar } from "./first-draft-toolbar.tsx";
import {
  decodeFirstDraftBootstrap,
  type SerializedFirstDraftBootstrap,
  type ValidatedFirstDraftBootstrap,
} from "./bootstrap/bootstrap.ts";
import type { FirstDraftEditor } from "./first-draft-editor-contracts.ts";
import { resetFirstDraftDocument } from "./reset-first-draft-document.ts";
import {
  createFirstDraftBlockPlacementRegistry,
  FirstDraftRootDropTargetRefContext,
  captureFirstDraftDocumentBlockDragSession,
  type FirstDraftAutoScrollSynchronizationEvent,
  type FirstDraftBlockDragAndDropBridge,
} from "./block-drag-and-drop/index.ts";
import {
  createFirstDraftAutoScrollSessionOwner,
  createFirstDraftTableDragStore,
} from "./table-drag-and-drop/index.ts";
import {
  moveFirstDraftTableColumn,
  moveFirstDraftTableRow,
} from "./blocks/table/mutations.ts";
import { moveFirstDraftDocumentBlock } from "./block-operations/move-document-block.ts";
import { FirstDraftAppendParagraphSurface } from "./blocks/append-paragraph-surface.tsx";

export interface FirstDraftCollaborationOptions {
  readonly webSocketUrl: string;
  readonly documentId: string;
  readonly actorId: string;
  readonly clientId: string;
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

interface ConnectedEditorState {
  readonly documentId: string;
  readonly editor: FirstDraftEditor;
  readonly viewState: FirstDraftViewStateStore;
  readonly callbacks: FirstDraftRuntimeCallbacks;
  readonly identity: FirstDraftSessionIdentity | null;
  readonly revision: number;
  readonly restoration: FirstDraftRestoration | null;
}

interface FirstDraftRestoration {
  readonly token: symbol;
  readonly scrollTop: number;
  readonly hadFocus: boolean;
  readonly focus: {
    readonly blockId: BlockId;
    readonly textOffset: number;
  } | null;
}

interface FirstDraftRecoverySnapshot {
  readonly scrollTop: number;
  readonly hadFocus: boolean;
  readonly selection: ReturnType<FirstDraftEditor["selection"]["getSnapshot"]>;
}

class FirstDraftRuntimeCallbacks {
  private onChange: EditorChangeCallback | null = null;
  private onError: ((error: Error) => void) | null = null;
  private onAtomicOperation: (() => () => void) | null = null;
  private sessionId = "server-rendered";

  readonly change: EditorChangeCallback = (change) => this.onChange?.(change);
  readonly error = (error: Error) => this.onError?.(error);
  readonly createTransactionId = () => `${this.sessionId}:${createSessionId()}`;
  readonly beginAtomicOperation = () =>
    this.onAtomicOperation?.() ?? (() => undefined);

  activate(
    onChange: EditorChangeCallback,
    onError: (error: Error) => void,
    sessionId: string,
    onAtomicOperation: () => () => void,
  ) {
    this.onChange = onChange;
    this.onError = onError;
    this.sessionId = sessionId;
    this.onAtomicOperation = onAtomicOperation;
  }

  deactivate(): void {
    this.onChange = null;
    this.onError = null;
    this.onAtomicOperation = null;
  }
}

export type FirstDraftConnectionStatus =
  | "server-rendered"
  | "connecting"
  | "catching-up"
  | "live"
  | "resynchronizing"
  | "disconnected"
  | "error";

interface FirstDraftConnectionUiState {
  readonly generation: symbol | null;
  readonly loaded: ConnectedEditorState | null;
  readonly participants: readonly FirstDraftParticipantPresence[];
  readonly status: FirstDraftConnectionStatus;
  readonly error: string | null;
}

interface FirstDraftConnectionInputs {
  readonly webSocketUrl: string;
  readonly documentId: string;
  readonly actorId: string;
  readonly clientId: string;
  readonly displayName?: string;
  readonly color?: string;
}

interface ActiveFirstDraftConnectionGeneration {
  readonly generation: symbol;
}

export interface FirstDraftEditorSurfaceProps {
  readonly collaboration: FirstDraftCollaborationOptions | null;
  readonly initialBootstrap?: SerializedFirstDraftBootstrap;
  readonly onLifecycleObservation?: (
    observation: FirstDraftLifecycleObservation,
  ) => void;
}

/** Owns the sole socket, dispatcher, editor, and mounted document lifecycle. */
export function FirstDraftEditorSurface({
  collaboration,
  initialBootstrap,
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

  const [viewState] = useState(createFirstDraftViewStateStore);
  const [initialRuntime] = useState(() =>
    createInitialFirstDraftRuntime(initialBootstrap, viewState),
  );
  const hasCollaboration = collaboration !== null;
  const requestedWebSocketUrl = collaboration?.webSocketUrl ?? null;
  const requestedDocumentId = collaboration?.documentId ?? null;
  const requestedActorId = collaboration?.actorId ?? null;
  const requestedClientId = collaboration?.clientId ?? null;
  const requestedDisplayName = collaboration?.displayName;
  const requestedColor = collaboration?.color;
  const connectionInputs = useMemo<FirstDraftConnectionInputs | null>(
    () =>
      hasCollaboration
        ? {
            webSocketUrl: requestedWebSocketUrl!,
            documentId: requestedDocumentId!,
            actorId: requestedActorId!,
            clientId: requestedClientId!,
            ...(requestedDisplayName === undefined
              ? {}
              : { displayName: requestedDisplayName }),
            ...(requestedColor === undefined ? {} : { color: requestedColor }),
          }
        : null,
    [
      hasCollaboration,
      requestedActorId,
      requestedClientId,
      requestedColor,
      requestedDisplayName,
      requestedDocumentId,
      requestedWebSocketUrl,
    ],
  );
  const [retryAttempt, setRetryAttempt] = useState(0);
  const requestedGeneration = useMemo(
    () =>
      connectionInputs
        ? Symbol(`first-draft-connection-generation-${retryAttempt}`)
        : null,
    [connectionInputs, retryAttempt],
  );
  const activeGeneration = useRef<ActiveFirstDraftConnectionGeneration | null>(
    null,
  );
  const outboxSession = useRef<{
    readonly documentId: string;
    readonly publisher: FirstDraftOutboundPublisher;
  } | null>(null);
  const presenceRevisions = useRef<FirstDraftPresencePublicationRevisions>({
    presence: 0,
    selection: 0,
  });
  const outboxMount = useRef<symbol | null>(null);
  useEffect(() => {
    const token = Symbol("first-draft-outbox-mount");
    outboxMount.current = token;
    return () => {
      if (outboxMount.current === token) outboxMount.current = null;
      queueMicrotask(() => {
        if (outboxMount.current !== null) return;
        outboxSession.current?.publisher.dispose();
        outboxSession.current = null;
      });
    };
  }, []);
  const sectionRef = useRef<HTMLElement | null>(null);
  const documentScrollRef = useRef<HTMLDivElement | null>(null);
  const recovery = useRef<FirstDraftRecoverySnapshot | null>(null);
  const initialStatus: FirstDraftConnectionStatus = initialRuntime.error
    ? "error"
    : collaboration
      ? "connecting"
      : "server-rendered";
  const [ownedUi, setOwnedUi] = useState<FirstDraftConnectionUiState>(() => ({
    ...initialConnectionUi(
      requestedGeneration,
      initialStatus,
      initialRuntime.loaded,
    ),
    error: initialRuntime.error,
  }));
  const ui =
    connectionInputs === null
      ? {
          ...initialConnectionUi(
            null,
            initialRuntime.error ? "error" : "server-rendered",
            initialRuntime.loaded,
          ),
          error: initialRuntime.error,
        }
      : ownedUi.generation === requestedGeneration
        ? ownedUi
        : transitionConnectionUi(
            requestedGeneration!,
            ownedUi,
            connectionInputs.documentId,
            initialRuntime.loaded,
          );
  const presentationLoadedRef = useRef(ui.loaded);
  useLayoutEffect(() => {
    presentationLoadedRef.current = ui.loaded;
  }, [ui.loaded]);
  const renderedEditor = ui.loaded?.editor ?? null;
  const committedEditor = useRef<FirstDraftEditor | null>(null);
  useLayoutEffect(() => {
    committedEditor.current = renderedEditor;
  }, [renderedEditor]);
  const pendingEditorDisposals = useRef(
    new Map<FirstDraftEditor, symbol>(),
  );
  useEffect(() => {
    if (!renderedEditor) return;
    const editorDisposals = pendingEditorDisposals.current;
    editorDisposals.delete(renderedEditor);
    return () => {
      const disposal = Symbol("first-draft-editor-disposal");
      editorDisposals.set(renderedEditor, disposal);
      // Strict Mode immediately replays mounted effects. Give that replay a
      // chance to reclaim this editor before destroying its content runtime.
      queueMicrotask(() => {
        if (editorDisposals.get(renderedEditor) !== disposal) return;
        editorDisposals.delete(renderedEditor);
        renderedEditor.dispose();
        if (committedEditor.current === renderedEditor)
          committedEditor.current = null;
      });
    };
  }, [renderedEditor]);

  useEffect(() => {
    if (!connectionInputs || initialRuntime.error) {
      activeGeneration.current = null;
      return;
    }
    const generation = requestedGeneration!;
    const startingLoaded = presentationLoadedRef.current;
    activeGeneration.current = { generation };
    const { documentId, actorId, displayName, color } = connectionInputs;
    const resumeBootstrap =
      retryAttempt === 0 && initialRuntime.bootstrap?.documentId === documentId
        ? initialRuntime.bootstrap
        : null;
    if (
      initialRuntime.bootstrap &&
      retryAttempt === 0 &&
      initialRuntime.bootstrap.documentId !== documentId
    ) {
      queueMicrotask(() => {
        if (activeGeneration.current?.generation !== generation) return;
        setOwnedUi((current) => ({
          ...current,
          generation,
          loaded: null,
          status: "error",
          error:
            "First Draft bootstrap and collaboration document identities differ",
        }));
      });
      return;
    }
    let retainedOutbox = outboxSession.current;
    if (retainedOutbox && retainedOutbox.documentId !== documentId) {
      if (retainedOutbox.publisher.hasUnresolved()) {
        queueMicrotask(() => {
          if (activeGeneration.current?.generation !== generation) return;
          setOwnedUi((current) => ({
            ...current,
            generation,
            status: "error",
            error:
              "Cannot replace the First Draft document while outbound acceptance is unresolved",
          }));
        });
        return;
      }
      retainedOutbox.publisher.dispose();
      retainedOutbox = null;
      outboxSession.current = null;
      presenceRevisions.current = { presence: 0, selection: 0 };
    }
    if (!retainedOutbox) {
      retainedOutbox = {
        documentId,
        publisher: createFirstDraftOutboundPublisher(),
      };
      outboxSession.current = retainedOutbox;
    }
    const publisher = retainedOutbox.publisher;
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
    let runtime: ConnectedEditorState | null =
      startingLoaded?.documentId === documentId ? startingLoaded : null;
    let presence: FirstDraftPresenceAttachment | null = null;
    let detachRemote: (() => void) | null = null;
    let currentRevision = runtime?.revision ?? resumeBootstrap?.revision ?? 0;
    let expectedRequestedRevision = currentRevision;
    let live = false;
    let failed = false;
    let protocolState: "connecting" | "catching-up" | "live" | "error" =
      "connecting";
    let disposed = false;
    const updateUi = (
      update: (
        current: FirstDraftConnectionUiState,
      ) => FirstDraftConnectionUiState,
    ) => {
      if (disposed || activeGeneration.current?.generation !== generation)
        return;
      setOwnedUi((current) => {
        if (activeGeneration.current?.generation !== generation) return current;
        const owned =
          current.generation === generation
            ? current
            : transitionConnectionUi(
                generation,
                current,
                documentId,
                initialRuntime.loaded,
              );
        return update(owned);
      });
    };
    const observe = (observation: FirstDraftLifecycleObservation) => {
      if (!disposed) observeLifecycle(observation);
    };
    const captureRecovery = (candidate: ConnectedEditorState | null) => {
      if (!candidate) return;
      const activeElement = document.activeElement;
      recovery.current = {
        scrollTop: documentScrollRef.current?.scrollTop ?? 0,
        hadFocus: Boolean(
          activeElement && sectionRef.current?.contains(activeElement),
        ),
        selection: candidate.editor.selection.getSnapshot(),
      };
    };
    const deactivateRuntime = (options: {
      readonly detachOutbox: boolean;
      readonly attemptSend: boolean;
    }) => {
      live = false;
      runtime?.callbacks.deactivate();
      if (options.detachOutbox) {
        publisher.detachGeneration({ attemptSend: options.attemptSend });
      }
      presence?.dispose();
      presence = null;
      detachRemote?.();
      detachRemote = null;
    };
    const freeze = (
      status: Extract<FirstDraftConnectionStatus, "disconnected" | "error">,
      error: string | null,
    ) => {
      const candidate = runtime ?? startingLoaded;
      captureRecovery(candidate);
      publisher.markGenerationUnusable();
      deactivateRuntime({ detachOutbox: true, attemptSend: false });
      candidate?.editor.blurEditor();
      updateUi((current) => ({
        ...current,
        participants: Object.freeze([]),
        status,
        error,
      }));
    };
    const fail = (next: Error) => {
      if (disposed || failed) return;
      failed = true;
      protocolState = "error";
      freeze("error", next.message);
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close(1002, "First Draft protocol failed");
      }
    };
    publisher.attachGeneration({
      generationId: identity.sessionId,
      socket,
      createTransactionId: () => `${identity.sessionId}:${createSessionId()}`,
      publishSelection: (selection, transactionId) =>
        presence?.publishSelection(selection, transactionId),
      onRetainedPublished: (finalCommittedSelection) =>
        presence?.publishCurrentSelection(finalCommittedSelection ?? undefined),
      onPublished: (transactionId) =>
        observe({ kind: "transaction-published", transactionId }),
      onError: fail,
    });
    const configureRuntime = (nextRuntime: ConnectedEditorState): void => {
      runtime?.callbacks.deactivate();
      detachRemote?.();
      detachRemote = null;
      runtime = nextRuntime;
      currentRevision = nextRuntime.revision;
      const onChange: EditorChangeCallback = (change) => {
        if (!live) {
          fail(
            new Error("First Draft mutation occurred before revision catch-up"),
          );
          return;
        }
        observe({
          kind: "canonical-accepted",
          transactionId: change.transactionId,
        });
        publisher.submitFinalized(change);
      };
      nextRuntime.callbacks.activate(
        onChange,
        fail,
        identity.sessionId,
        publisher.beginAtomicOperation,
      );
      detachRemote = attachFirstDraftRemoteTransactions(
        dispatcher,
        nextRuntime.editor,
        {
          documentId,
          initialRevision: nextRuntime.revision,
          outbox: publisher,
          onProtocolError: fail,
          onRevisionAdvanced: (revision) => {
            currentRevision = revision;
            if (runtime) runtime = { ...runtime, revision };
            updateUi((current) => ({
              ...current,
              loaded: runtime,
            }));
          },
        },
      );
    };
    const initializeRuntime = (
      bootstrap: ValidatedFirstDraftBootstrap,
      restore: boolean,
    ): ConnectedEditorState => {
      deactivateRuntime({ detachOutbox: false, attemptSend: false });
      const created = createFirstDraftRuntime(bootstrap, viewState, identity);
      reconcileFirstDraftViewState(viewState, created.editor);
      const restoration = restore
        ? restoreFirstDraftRecovery(created.editor, recovery.current)
        : null;
      const nextRuntime = { ...created, restoration };
      configureRuntime(nextRuntime);
      return nextRuntime;
    };
    if (runtime) {
      runtime = { ...runtime, identity, revision: currentRevision };
      configureRuntime(runtime);
      updateUi((current) => ({ ...current, loaded: runtime }));
      if (resumeBootstrap) {
        observe({
          kind: "initial-document-received",
          revision: resumeBootstrap.revision,
        });
      }
    }
    const activateLiveEditor = () => {
      if (!runtime) {
        fail(new Error("First Draft editor runtime is unavailable"));
        return;
      }
      live = true;
      presence = attachFirstDraftPresence(
        dispatcher,
        runtime.editor,
        {
          documentId,
          subject,
          metadata: localParticipantMetadata(actorId, displayName, color),
        },
        {
          revisions: presenceRevisions.current,
          beforeStandaloneSelectionPublication:
            publisher.beforeStandaloneSelectionPublication,
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
      publisher.generationCaughtUp();
      runtime = { ...runtime, identity, revision: currentRevision };
      updateUi((current) => ({
        ...current,
        loaded: runtime,
        status: "live",
        error: null,
      }));
      protocolState = "live";
    };
    const onOpen = () => {
      if (disposed) return;
      updateUi((current) => ({ ...current, status: "connecting" }));
      socket.send(
        encodeFirstDraftMessage({
          type: "connect-first-draft-session",
          ...identity,
        }),
      );
    };
    const onClose = () => {
      if (!disposed && !failed) freeze("disconnected", null);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    const unsubscribeMessages = dispatcher.subscribe((message) => {
      if (failed) return;
      if (message.type === "first-draft-protocol-error") {
        fail(new Error(`${message.code}: ${message.message}`));
        return;
      }
      if (message.type === "first-draft-session-connected") {
        if (protocolState !== "connecting") {
          fail(new Error("First Draft session confirmation is out of order"));
          return;
        }
        if (!sameIdentity(message, identity)) {
          fail(
            new Error("First Draft session confirmation identity is invalid"),
          );
          return;
        }
        updateUi((current) => ({ ...current, status: "catching-up" }));
        protocolState = "catching-up";
        socket.send(
          encodeFirstDraftMessage({
            type: "subscribe-first-draft-document",
            documentId,
            ...(runtime
              ? { knownRevision: currentRevision }
              : {}),
          }),
        );
        return;
      }
      if (message.type === "first-draft-document-resynchronized") {
        if (!runtime || protocolState !== "catching-up") {
          fail(new Error("First Draft resynchronization is out of order"));
          return;
        }
        if (message.documentId !== documentId) {
          fail(
            new Error(
              "First Draft resynchronization document identity is invalid",
            ),
          );
          return;
        }
        try {
          publisher.assertResynchronizationSafe();
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        captureRecovery(runtime);
        updateUi((current) => ({ ...current, status: "resynchronizing" }));
        expectedRequestedRevision = message.revision;
        const nextRuntime = initializeRuntime(message.bootstrap, true);
        updateUi((current) => ({
          ...current,
          loaded: nextRuntime,
          status: "catching-up",
        }));
        return;
      }
      if (message.type === "first-draft-document-caught-up") {
        if (message.documentId !== documentId) return;
        if (protocolState !== "catching-up") {
          fail(new Error("First Draft caught-up confirmation is out of order"));
          return;
        }
        if (
          message.requestedRevision !== expectedRequestedRevision ||
          message.revision !== currentRevision
        ) {
          fail(
            new Error(
              "First Draft caught-up revision does not match the applied replay",
            ),
          );
          return;
        }
        activateLiveEditor();
        observe({
          kind: "revision-catch-up-complete",
          revision: message.revision,
        });
        return;
      }
      if (message.type !== "first-draft-document-loaded") return;
      if (disposed) return;
      if (message.documentId !== documentId) {
        fail(new Error("First Draft initial document identity is invalid"));
        return;
      }
      if (runtime) {
        try {
          publisher.assertResynchronizationSafe();
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        captureRecovery(runtime);
        expectedRequestedRevision = message.revision;
        protocolState = "catching-up";
        const nextRuntime = initializeRuntime(message.bootstrap, true);
        updateUi((current) => ({
          ...current,
          loaded: nextRuntime,
          status: "catching-up",
        }));
        return;
      }
      observe({
        kind: "initial-document-received",
        revision: message.revision,
      });
      expectedRequestedRevision = message.revision;
      protocolState = "catching-up";
      const nextRuntime = initializeRuntime(
        message.bootstrap,
        retryAttempt > 0,
      );
      updateUi((current) => ({
        ...current,
        loaded: nextRuntime,
        status: "catching-up",
      }));
    });
    const unsubscribeDecodeErrors = dispatcher.subscribeDecodeErrors(fail);
    const unsubscribeSocketErrors = dispatcher.subscribeSocketErrors(() =>
      {
        publisher.markGenerationUnusable();
        fail(
          new Error("The First Draft collaboration socket reported an error."),
        );
      },
    );
    const flushOnHidden = () => {
      if (document.visibilityState === "hidden") {
        publisher.flush("visibility-hidden");
      }
    };
    const flushOnPageHide = () => publisher.flush("pagehide");
    document.addEventListener("visibilitychange", flushOnHidden);
    window.addEventListener("pagehide", flushOnPageHide);
    return () => {
      disposed = true;
      if (activeGeneration.current?.generation === generation)
        activeGeneration.current = null;
      runtime?.callbacks.deactivate();
      live = false;
      publisher.detachGeneration({
        attemptSend: !failed && socket.readyState === WebSocket.OPEN,
      });
      presence?.dispose();
      presence = null;
      detachRemote?.();
      detachRemote = null;
      unsubscribeMessages();
      unsubscribeDecodeErrors();
      unsubscribeSocketErrors();
      dispatcher.dispose();
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      document.removeEventListener("visibilitychange", flushOnHidden);
      window.removeEventListener("pagehide", flushOnPageHide);
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close(1000, "First Draft connection generation disposed");
      }
      if (
        runtime &&
        runtime.editor !== committedEditor.current &&
        runtime.editor !== startingLoaded?.editor
      ) {
        runtime.editor.dispose();
      }
    };
  }, [
    connectionInputs,
    initialRuntime.bootstrap,
    initialRuntime.error,
    initialRuntime.loaded,
    observeLifecycle,
    requestedGeneration,
    retryAttempt,
    viewState,
  ]);

  const retry = useCallback(() => {
    const loaded = ui.loaded;
    if (loaded && !recovery.current) {
      const activeElement = document.activeElement;
      recovery.current = {
        scrollTop: documentScrollRef.current?.scrollTop ?? 0,
        hadFocus: Boolean(
          activeElement && sectionRef.current?.contains(activeElement),
        ),
        selection: loaded.editor.selection.getSnapshot(),
      };
    }
    setRetryAttempt((attempt) => attempt + 1);
  }, [ui.loaded]);
  const interactionEnabled = ui.status === "live";

  return (
    <>
      <div data-first-draft-document-host="true">
        {ui.loaded ? (
          <FirstDraftEditorDocument
            loaded={ui.loaded}
            collaboration={connectionInputs}
            interactionEnabled={interactionEnabled}
            collaborationStatus={ui.status}
            collaborationError={ui.error}
            participants={ui.participants}
            sectionRef={sectionRef}
            documentScrollRef={documentScrollRef}
            onLifecycleObservation={observeLifecycle}
          />
        ) : null}
      </div>
      {connectionInputs &&
      (ui.status === "error" || ui.status === "disconnected") ? (
        <div className="first-draft-example__connection-error" role="alert">
          <span>
            {ui.error ?? "The First Draft collaboration session disconnected."}
          </span>
          <button type="button" onClick={retry}>
            Retry collaboration
          </button>
        </div>
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
  interactionEnabled,
  collaborationStatus,
  collaborationError,
  participants,
  sectionRef,
  documentScrollRef,
  onLifecycleObservation,
}: {
  readonly loaded: ConnectedEditorState;
  readonly collaboration: FirstDraftCollaborationOptions | null;
  readonly interactionEnabled: boolean;
  readonly collaborationStatus: FirstDraftConnectionStatus;
  readonly collaborationError: string | null;
  readonly participants: readonly FirstDraftParticipantPresence[];
  readonly sectionRef: MutableRefObject<HTMLElement | null>;
  readonly documentScrollRef: MutableRefObject<HTMLDivElement | null>;
  readonly onLifecycleObservation: (
    observation: FirstDraftLifecycleObservation,
  ) => void;
}) {
  const { editor, viewState, identity, restoration, revision } = loaded;
  const beginAtomicOperationBoundary = useCallback(() => {
    if (!interactionEnabled) return;
    const clear = loaded.callbacks.beginAtomicOperation();
    queueMicrotask(clear);
  }, [interactionEnabled, loaded.callbacks]);
  const markCompositionStandalone = useCallback(() => {
    beginAtomicOperationBoundary();
  }, [beginAtomicOperationBoundary]);
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const markAtomicBeforeInput = (event: Event) => {
      const inputType = (event as InputEvent).inputType;
      if (
        inputType === "insertFromDictation" ||
        inputType === "insertReplacementText"
      ) {
        beginAtomicOperationBoundary();
      }
    };
    section.addEventListener("beforeinput", markAtomicBeforeInput, true);
    return () =>
      section.removeEventListener("beforeinput", markAtomicBeforeInput, true);
  }, [beginAtomicOperationBoundary, sectionRef]);
  const [resetError, setResetError] = useState<string | null>(null);
  const handleResetDocument = useCallback(() => {
    if (
      !window.confirm(
        "Reset document? This will replace the shared document for all connected collaborators.",
      )
    ) {
      return;
    }
    const result = resetFirstDraftDocument(editor);
    if (!result.ok) {
      setResetError(`Could not reset the document: ${result.message}`);
      return;
    }
    for (const blockId of result.previousBlockIds) {
      viewState.deleteBlockState(blockId);
    }
    setResetError(null);
  }, [editor, viewState]);
  const [tableDragStore] = useState(createFirstDraftTableDragStore);
  const getDocumentScrollElement = useCallback(
    () => documentScrollRef.current,
    [documentScrollRef],
  );
  const synchronizeBlockDragAfterScrollRef = useRef<
    ((event: FirstDraftAutoScrollSynchronizationEvent) => void) | null
  >(null);
  // Both controllers are stable for this editor surface. Their lazy container
  // readers resolve the current connected document/table scrollers per frame.
  // eslint-disable-next-line react-hooks/refs
  const [autoScrollSessions] = useState(() =>
    createFirstDraftAutoScrollSessionOwner({
      getDocumentScrollElement,
      getTableScrollElement: (tableId) =>
        tableDragStore.getTableScrollElement(tableId),
      onDragScroll: (group) =>
        synchronizeBlockDragAfterScrollRef.current?.({ kind: "scroll", group }),
      onDragSessionStopped: (group) =>
        synchronizeBlockDragAfterScrollRef.current?.({
          kind: "stopped",
          group,
        }),
      onTableSessionInvalidated: (tableId) =>
        tableDragStore.invalidateActiveDrag(tableId),
    }),
  );
  const registerAutoScrollSynchronization = useCallback(
    (
      synchronize:
        | ((event: FirstDraftAutoScrollSynchronizationEvent) => void)
        | null,
    ) => {
      synchronizeBlockDragAfterScrollRef.current = synchronize;
    },
    [],
  );
  const setDocumentScrollElement = useCallback(
    (element: HTMLDivElement | null) => {
      const previous = documentScrollRef.current;
      if (previous !== element) autoScrollSessions.stopAll();
      documentScrollRef.current = element;
    },
    [autoScrollSessions, documentScrollRef],
  );
  const handleSelectionDragStart = useCallback(
    (drag: EditorSelectionDragSnapshot) => {
      autoScrollSessions.startDocumentSelection({
        x: drag.pointer.clientX,
        y: drag.pointer.clientY,
      });
    },
    [autoScrollSessions],
  );
  const handleSelectionDragUpdate = useCallback(
    (drag: EditorSelectionDragSnapshot) => {
      autoScrollSessions.updateDocumentSelection({
        x: drag.pointer.clientX,
        y: drag.pointer.clientY,
      });
    },
    [autoScrollSessions],
  );
  const handleSelectionDragEnd = useCallback(
    () => autoScrollSessions.stopDocumentSelection(),
    [autoScrollSessions],
  );
  useEffect(() => () => autoScrollSessions.stopAll(), [autoScrollSessions]);
  const placementRegistry = useMemo(
    () => createFirstDraftBlockPlacementRegistry(editor),
    [editor],
  );
  const [tableActionMenuStore] = useState(() =>
    createFirstDraftTableActionMenuStore(),
  );
  const [blockActionMenuStore] = useState(() =>
    createFirstDraftBlockActionMenuStore(),
  );
  const [tabsActionUiStore] = useState(() =>
    createFirstDraftTabsActionUiStore(),
  );
  useEffect(() => {
    if (interactionEnabled) return;
    editor.blurEditor();
    autoScrollSessions.stopAll();
    const session = tableDragStore.getSnapshot().session;
    if (session) tableDragStore.invalidateActiveDrag(session.tableId);
    tableActionMenuStore.close();
    blockActionMenuStore.close();
    tabsActionUiStore.cancelRename();
    tabsActionUiStore.closeMenu();
  }, [
    autoScrollSessions,
    blockActionMenuStore,
    editor,
    interactionEnabled,
    tableActionMenuStore,
    tableDragStore,
    tabsActionUiStore,
  ]);
  const blockDragAndDrop = useMemo<FirstDraftBlockDragAndDropBridge>(
    () => ({
      placementRegistry,
      captureDocumentBlockDragSession: (blockId) =>
        captureFirstDraftDocumentBlockDragSession(
          editor,
          viewState,
          blockId,
        ),
      moveDocumentBlock: (expectedSource, position) =>
        moveFirstDraftDocumentBlock(editor, expectedSource, position),
      moveTableRow: (tableId, rowId, finalRowIds) =>
        moveFirstDraftTableRow(editor, tableId, rowId, finalRowIds),
      moveTableColumn: (tableId, source, finalTargets) =>
        moveFirstDraftTableColumn(editor, tableId, source, finalTargets),
      closeTableActionMenu: () => tableActionMenuStore.close(),
      closeBlockActionMenuForDocumentDrag: (blockId) =>
        blockActionMenuStore.closeForDocumentDrag(blockId),
      startDocumentBlockAutoScroll: (group, point) =>
        autoScrollSessions.startDocumentBlock(group, point),
      updateDocumentBlockAutoScrollPoint: (group, point) =>
        autoScrollSessions.updateDocumentBlock(group, point),
      stopDocumentBlockAutoScroll: (group) =>
        autoScrollSessions.stopDocumentBlock(group),
      startTableDragAutoScroll: (group, tableId, scrollElement, point) =>
        autoScrollSessions.startTableDrag(group, tableId, scrollElement, point),
      updateTableDragAutoScrollPoint: (group, tableId, point) =>
        autoScrollSessions.updateTableDrag(group, tableId, point),
      stopTableDragAutoScroll: (group, tableId) =>
        autoScrollSessions.stopTableDrag(group, tableId),
      registerAutoScrollSynchronization,
    }),
    [
      editor,
      placementRegistry,
      registerAutoScrollSynchronization,
      autoScrollSessions,
      blockActionMenuStore,
      tableActionMenuStore,
      viewState,
    ],
  );
  useLayoutEffect(() => {
    onLifecycleObservation({ kind: "editor-dom-mounted", revision });
  }, [editor, onLifecycleObservation, revision]);
  useLayoutEffect(() => {
    if (!restoration || !documentScrollRef.current) return;
    documentScrollRef.current.scrollTop = restoration.scrollTop;
  }, [documentScrollRef, restoration]);
  useLayoutEffect(() => {
    if (!interactionEnabled || !restoration?.hadFocus || !restoration.focus)
      return;
    editor.focusText(restoration.focus.blockId, {
      offset: restoration.focus.textOffset,
      preventScroll: true,
    });
  }, [editor, interactionEnabled, restoration]);
  useEffect(
    () => () => {
      blockActionMenuStore.close();
    },
    [blockActionMenuStore],
  );
  return (
    <FirstDraftViewStateProvider store={viewState}>
      <FirstDraftTableActionMenuProvider store={tableActionMenuStore}>
        <FirstDraftTabsActionUiProvider store={tabsActionUiStore}>
          <section
            ref={sectionRef}
            className="first-draft-example"
            data-editor-interaction-scope="true"
            data-first-draft-interaction-enabled={String(interactionEnabled)}
            inert={interactionEnabled ? undefined : true}
            aria-disabled={!interactionEnabled}
            aria-label="First Draft editor"
            onPasteCapture={beginAtomicOperationBoundary}
            onCutCapture={beginAtomicOperationBoundary}
            onCompositionEndCapture={markCompositionStandalone}
          >
            <FirstDraftToolbar
              onUndo={interactionEnabled ? () => editor.undo() : undefined}
              onRedo={interactionEnabled ? () => editor.redo() : undefined}
              onResetDocument={
                interactionEnabled ? handleResetDocument : undefined
              }
              resetError={resetError}
              collaborationStatus={collaborationStatus}
              collaborationError={collaborationError}
            />
            <div
              ref={setDocumentScrollElement}
              className="first-draft-example__document-scroll"
            >
              <FirstDraftBlockHoverProvider
                enabled={interactionEnabled}
                blockDragAndDrop={blockDragAndDrop}
                tableDragStore={tableDragStore}
                blockActionMenuStore={blockActionMenuStore}
              >
                <EditorDocument
                  editor={editor}
                  interactionEnabled={interactionEnabled}
                  layout={firstDraftDocumentLayout}
                  trailingContent={
                    <FirstDraftAppendParagraphSurface
                      editor={editor}
                      parentId={null}
                      scope="root"
                      ariaLabel="Add paragraph at end of document"
                    />
                  }
                  childOrderProjection={tableDragStore.childOrderProjection}
                  onSelectionDragStart={
                    interactionEnabled ? handleSelectionDragStart : undefined
                  }
                  onSelectionDragUpdate={
                    interactionEnabled ? handleSelectionDragUpdate : undefined
                  }
                  onSelectionDragEnd={
                    interactionEnabled ? handleSelectionDragEnd : undefined
                  }
                  renderDocumentLayers={
                    interactionEnabled
                      ? (context) => (
                    <>
                      {collaboration && identity ? (
                        <FirstDraftSelectionBadgeLayer
                          editor={context.editor}
                          participants={participants}
                          localSubject={{
                            actorId: collaboration.actorId,
                            clientId: collaboration.clientId,
                            sessionId: identity.sessionId,
                          }}
                        />
                      ) : null}
                      <FirstDraftSelectionMenu editor={context.editor} />
                      <FirstDraftLinkPopover
                        editor={context.editor}
                        geometry={context.editor.geometry}
                        interactions={context.interactions}
                      />
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
                      <FirstDraftTableActionMenuLayer
                        editor={context.editor}
                        geometry={context.editor.geometry}
                        interactions={context.interactions}
                        store={tableActionMenuStore}
                      />
                      <FirstDraftBlockActionMenuLayer
                        editor={context.editor}
                        geometry={context.editor.geometry}
                        interactions={context.interactions}
                        store={blockActionMenuStore}
                        viewState={viewState}
                      />
                      <FirstDraftTabsActionMenuLayer
                        editor={context.editor}
                        geometry={context.editor.geometry}
                        interactions={context.interactions}
                        store={tabsActionUiStore}
                        selectTab={(tabsId, paneId) =>
                          viewState.selectTab(tabsId, paneId)
                        }
                      />
                    </>
                        )
                      : undefined
                  }
                >
                  <FirstDraftRootDropTargetRefContext.Consumer>
                    {(rootStartTargetRef) => (
                      <div
                        ref={rootStartTargetRef}
                        className="first-draft-block-drop-target"
                        data-first-draft-block-drop-target-active="false"
                        data-editor-ui="true"
                        aria-hidden="true"
                      />
                    )}
                  </FirstDraftRootDropTargetRefContext.Consumer>
                </EditorDocument>
              </FirstDraftBlockHoverProvider>
            </div>
          </section>
        </FirstDraftTabsActionUiProvider>
      </FirstDraftTableActionMenuProvider>
    </FirstDraftViewStateProvider>
  );
}

function initialConnectionUi(
  generation: symbol | null,
  status: FirstDraftConnectionStatus,
  loaded: ConnectedEditorState | null,
): FirstDraftConnectionUiState {
  return {
    generation,
    loaded,
    participants: Object.freeze([]),
    status,
    error: null,
  };
}

function transitionConnectionUi(
  generation: symbol,
  current: FirstDraftConnectionUiState,
  documentId: string,
  initial: ConnectedEditorState | null,
): FirstDraftConnectionUiState {
  const loaded =
    current.loaded?.documentId === documentId
      ? current.loaded
      : initial?.documentId === documentId
        ? initial
        : null;
  return initialConnectionUi(generation, "connecting", loaded);
}

function createInitialFirstDraftRuntime(
  bootstrap: SerializedFirstDraftBootstrap | undefined,
  viewState: FirstDraftViewStateStore,
): {
  readonly bootstrap: ValidatedFirstDraftBootstrap | null;
  readonly loaded: ConnectedEditorState | null;
  readonly error: string | null;
} {
  if (!bootstrap) return { bootstrap: null, loaded: null, error: null };
  try {
    const validated = decodeFirstDraftBootstrap(bootstrap);
    return {
      bootstrap: validated,
      loaded: createFirstDraftRuntime(validated, viewState, null),
      error: null,
    };
  } catch (error) {
    return {
      bootstrap: null,
      loaded: null,
      error:
        error instanceof Error
          ? error.message
          : "First Draft initial bootstrap is invalid",
    };
  }
}

function createFirstDraftRuntime(
  bootstrap: ValidatedFirstDraftBootstrap,
  viewState: FirstDraftViewStateStore,
  identity: FirstDraftSessionIdentity | null,
): ConnectedEditorState {
  const callbacks = new FirstDraftRuntimeCallbacks();
  const definition =
    typeof window === "undefined"
      ? createFirstDraftEditorDefinition(viewState, { contentRuntime: null })
      : createFirstDraftEditorDefinition(viewState);
  const editor = addEditorBlockOperations(
    initializeEditableEditor({
      compiledDefinition: compileCanonicalEditorDefinition(definition),
      snapshot: bootstrap.snapshot,
      validatedSnapshot: bootstrap,
      onChange: callbacks.change,
      onChangeError: callbacks.error,
      createTransactionId: callbacks.createTransactionId,
    }),
  );
  return {
    documentId: bootstrap.documentId,
    editor,
    viewState,
    callbacks,
    identity,
    revision: bootstrap.revision,
    restoration: null,
  };
}

function reconcileFirstDraftViewState(
  viewState: FirstDraftViewStateStore,
  editor: FirstDraftEditor,
): void {
  const snapshot = viewState.getSnapshot();
  for (const [tabsIdValue, paneIdValue] of Object.entries(
    snapshot.selectedTabs,
  )) {
    const tabsId = tabsIdValue as BlockId;
    const paneId = paneIdValue as BlockId;
    const tabs = editor.getBlock(tabsId);
    const pane = editor.getBlock(paneId);
    if (
      tabs?.type !== "tabs" ||
      pane?.type !== "tabPane" ||
      pane.parentId !== tabsId ||
      !editor.getChildBlockIds(tabsId).includes(paneId)
    ) {
      viewState.deleteBlockState(tabsId);
    }
  }
  for (const blockId of snapshot.collapsed) {
    if (!editor.getBlock(blockId)) viewState.deleteBlockState(blockId);
  }
}

function restoreFirstDraftRecovery(
  editor: FirstDraftEditor,
  recovery: FirstDraftRecoverySnapshot | null,
): FirstDraftRestoration | null {
  if (!recovery) return null;
  let focus: FirstDraftRestoration["focus"] = null;
  const canonical = recovery.selection;
  if (canonical.kind === "document") {
    const selection = canonical.snapshot;
    const anchor = selection.endpoints.anchor;
    const head = selection.endpoints.head;
    if (
      selection.direction &&
      anchor &&
      head &&
      recoveryPointResolves(editor, anchor) &&
      recoveryPointResolves(editor, head)
    ) {
      const restored = editor.transaction(() => {
        editor.setTransactionSelection({
          kind: "selection",
          selection: {
            direction: selection.direction!,
            anchor,
            focus: head,
          },
        });
      });
      if (
        restored.ok &&
        anchor.blockId === head.blockId &&
        anchor.textOffset === head.textOffset &&
        head.textAnchor
      ) {
        focus = { blockId: head.blockId, textOffset: head.textOffset };
      }
    }
  } else if (canonical.kind === "block-internal") {
    const owner = canonical.snapshot.blocks.find(
      (block) => block.blockId === canonical.snapshot.internal?.blockId,
    );
    if (owner && editor.getBlock(owner.blockId)) {
      editor.transaction(() => {
        editor.setTransactionSelection({
          kind: "block-internal",
          blockId: owner.blockId,
          subsystem: canonical.subsystem,
          coverageResult: owner.coverageResult,
        });
      });
    }
  }
  return {
    token: Symbol("first-draft-restoration"),
    scrollTop: recovery.scrollTop,
    hadFocus: recovery.hadFocus,
    focus,
  };
}

function recoveryPointResolves(
  editor: FirstDraftEditor,
  point: NonNullable<
    Extract<
      ReturnType<FirstDraftEditor["selection"]["getSnapshot"]>,
      { readonly kind: "document" }
    >["snapshot"]["endpoints"]["anchor"]
  >,
): boolean {
  const block = editor.getBlock(point.blockId);
  if (!block || block.tombstone || block.type !== point.blockType) return false;
  return point.textAnchor ? editor.resolveSelectionTextAnchor(point).ok : true;
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

function localParticipantMetadata(
  actorId: string,
  _requestedDisplayName: string | undefined,
  requestedColor: string | undefined,
): { readonly displayName: string; readonly color: string } {
  const compact = actorId.toLowerCase().replace(/[^a-z0-9]/gu, "");
  const suffix = (compact.slice(-6) || "guest").padStart(6, "0");
  return {
    displayName: `Visitor ${suffix}`,
    color:
      requestedColor && /^#[0-9a-f]{6}$/iu.test(requestedColor)
        ? requestedColor.toLowerCase()
        : "#4f46e5",
  };
}
