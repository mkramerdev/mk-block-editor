import {
  editorStableSelectionsEqual,
  projectCanonicalSelectionToStable,
  type CanonicalLocalSelection,
  type EditorStableSelection,
} from "@repo/editor-react/selection";
import {
  encodeFirstDraftMessage,
  type FirstDraftCollaborationSubject,
  type FirstDraftParticipantMetadata,
  type FirstDraftParticipantPresence,
  type FirstDraftSelectionPresence,
  type FirstDraftServerMessage,
} from "./message-protocol.ts";
import type { FirstDraftMessageDispatcher } from "./collaboration-connection.ts";
import { toCollaborationSubjectKey } from "@repo/editor-web/document-runtime";
import { type CollaborationSubjectKey } from "@repo/editor-web/editor";

export interface FirstDraftPresenceEditor {
  readonly selection: {
    getSnapshot(): CanonicalLocalSelection;
  };
  subscribeStandaloneSelectionSettlements(
    listener: (selection: EditorStableSelection) => void,
  ): () => void;
  setSelections(snapshot: {
    readonly entries: readonly {
      readonly subject: FirstDraftCollaborationSubject;
      readonly selectionRevision: number;
      readonly selection: EditorStableSelection;
      readonly color?: string;
    }[];
  }): void;
}

export interface FirstDraftPresenceAttachment {
  publishSelection(
    selection: EditorStableSelection,
    transactionId?: string,
  ): void;
  publishCurrentSelection(unlessEqual?: EditorStableSelection): boolean;
  dispose(): void;
}

export interface FirstDraftPresencePublicationRevisions {
  presence: number;
  selection: number;
}

export interface FirstDraftPresenceSession {
  readonly documentId: string;
  readonly subject: FirstDraftCollaborationSubject;
  readonly metadata: FirstDraftParticipantMetadata;
}

export interface FirstDraftPresenceClientOptions {
  readonly revisions: FirstDraftPresencePublicationRevisions;
  readonly beforeStandaloneSelectionPublication: () => void;
  readonly onParticipants?: (
    participants: readonly FirstDraftParticipantPresence[],
  ) => void;
  readonly onProtocolError?: (error: Error) => void;
  readonly onSelectionPublished?: (publication: {
    readonly selectionRevision: number;
    readonly transactionId: string | null;
  }) => void;
}

/** Publishes and consumes ephemeral presence over an already-open transaction socket. */
export function attachFirstDraftPresence(
  connection: FirstDraftMessageDispatcher,
  editor: FirstDraftPresenceEditor,
  session: FirstDraftPresenceSession,
  options: FirstDraftPresenceClientOptions,
): FirstDraftPresenceAttachment {
  const socket = connection.socket;
  let disposed = false;
  const revisions = options.revisions;
  const participants = new Map<
    CollaborationSubjectKey,
    FirstDraftParticipantPresence
  >();
  const selections = new Map<
    CollaborationSubjectKey,
    FirstDraftSelectionPresence
  >();
  const ownKey = subjectKey(session.subject);
  const send = (message: Parameters<typeof encodeFirstDraftMessage>[0]) => {
    if (socket.readyState !== 1) {
      options.onProtocolError?.(
        new Error("First Draft presence requires an open collaboration socket"),
      );
      return false;
    }
    socket.send(encodeFirstDraftMessage(message));
    return true;
  };
  const publishParticipant = (active: boolean) =>
    send({
      type: "first-draft-participant-update",
      documentId: session.documentId,
      subject: session.subject,
      presenceRevision: revisions.presence++,
      active,
      metadata: session.metadata,
    });
  const publishSelection = (
    selection: EditorStableSelection,
    transactionId: string | null = null,
  ) => {
    if (disposed) return false;
    const selectionRevision = revisions.selection++;
    const published = send({
      type: "first-draft-selection-update",
      documentId: session.documentId,
      subject: session.subject,
      selectionRevision,
      selection,
    });
    if (published) {
      options.onSelectionPublished?.({ selectionRevision, transactionId });
    }
    return published;
  };
  const commitSelections = () => {
    editor.setSelections({
      entries: [...selections.values()]
        .filter((entry) => subjectKey(entry.subject) !== ownKey)
        .map((entry) => {
          const color = participants.get(subjectKey(entry.subject))?.metadata
            .color;
          return {
            subject: entry.subject,
            selectionRevision: entry.selectionRevision,
            selection: entry.selection,
            ...(color ? { color } : {}),
          };
        }),
    });
  };
  const publishParticipants = () =>
    options.onParticipants?.(
      [...participants.values()].filter(
        (participant) =>
          participant.active && subjectKey(participant.subject) !== ownKey,
      ),
    );
  const onMessage = (message: FirstDraftServerMessage) => {
    if (disposed) return;
    if ("documentId" in message && message.documentId !== session.documentId) {
      return;
    }
    if (message.type === "first-draft-participant-snapshot") {
      participants.clear();
      for (const participant of message.participants) {
        participants.set(subjectKey(participant.subject), participant);
      }
      publishParticipants();
      commitSelections();
      return;
    }
    if (message.type === "first-draft-participant-update") {
      const key = subjectKey(message.subject);
      const previous = participants.get(key);
      if (!previous || message.presenceRevision > previous.presenceRevision) {
        participants.set(key, message);
        if (!message.active) {
          selections.delete(key);
        }
        publishParticipants();
        commitSelections();
      }
      return;
    }
    if (message.type === "first-draft-selection-snapshot") {
      // The server snapshot is the authoritative set of currently leased
      // remote selections. Replacing this map removes expired presence without
      // touching the editor's canonical/local selection controller.
      selections.clear();
      for (const selection of message.selections) {
        selections.set(subjectKey(selection.subject), selection);
      }
      commitSelections();
      return;
    }
    if (message.type === "first-draft-selection-update") {
      const key = subjectKey(message.subject);
      const previous = selections.get(key);
      if (!previous || message.selectionRevision > previous.selectionRevision) {
        selections.set(key, message);
        commitSelections();
      }
    }
  };
  const unsubscribeMessages = connection.subscribe(onMessage);
  const publishCurrentSelection = (unlessEqual?: EditorStableSelection) => {
    const current = projectCanonicalSelectionToStable(editor.selection.getSnapshot());
    if (unlessEqual && editorStableSelectionsEqual(current, unlessEqual)) return false;
    return publishSelection(current);
  };
  const unsubscribeSelection = editor.subscribeStandaloneSelectionSettlements(
    (selection) => {
      if (!disposed) {
        options.beforeStandaloneSelectionPublication();
        publishSelection(selection);
      }
    },
  );
  publishParticipant(true);
  return Object.freeze({
    publishSelection,
    publishCurrentSelection,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeSelection();
      unsubscribeMessages();
      participants.clear();
      selections.clear();
      editor.setSelections({ entries: [] });
      options.onParticipants?.([]);
    },
  });
}

function subjectKey(
  subject: FirstDraftCollaborationSubject,
): CollaborationSubjectKey {
  const key = toCollaborationSubjectKey(subject);
  if (!key) {
    throw new TypeError("Invalid First Draft collaboration subject");
  }
  return key;
}
