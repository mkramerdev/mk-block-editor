import {
  EditorImmutableBinary,
  type EditorContentOperationUpdate,
} from "@repo/editor-core/content/rich-text";
import type { BlockType } from "@repo/editor-core/document";
import {
  isStructuralKey,
  validateJsonObject,
  type BlockId,
  type JsonObject,
} from "@repo/editor-core/kernel";
import { validateUpdateBlockMetadataOperation } from "@repo/editor-core/metadata";
import {
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
} from "@repo/editor-yjs/checkpoint-format";
import type { UpdateBlockMetadataOperation } from "@repo/editor-core/operations";
import {
  editorStableSelectionsEqual,
  type EditorStableSelection,
} from "@repo/editor-react/selection";
import type {
  EditorTransportBlockGraphChange,
  EditorTransportTransaction,
} from "./transport-types.ts";
import {
  decodeFirstDraftBootstrap,
  serializeFirstDraftBootstrap,
  type ValidatedFirstDraftBootstrap,
} from "../bootstrap/bootstrap.ts";
import {
  decodeFirstDraftWireFrame,
  encodeFirstDraftWireFrame,
} from "./wire-frame.ts";

/** Maximum raw frame accepted from a First Draft client connection. */
export const MAX_FIRST_DRAFT_CLIENT_FRAME_BYTES = 2 * 1_024 * 1_024;
export {
  FIRST_DRAFT_PROTOCOL_VERSION,
  MAX_FIRST_DRAFT_FRAME_BYTES,
} from "./wire-frame.ts";

export function isValidFirstDraftDocumentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

export interface FirstDraftSessionIdentity {
  readonly actorId: string;
  readonly clientId: string;
  readonly sessionId: string;
  readonly documentId: string;
}

export interface ConnectFirstDraftSessionMessage extends FirstDraftSessionIdentity {
  readonly type: "connect-first-draft-session";
}

export interface FirstDraftSessionConnectedMessage extends FirstDraftSessionIdentity {
  readonly type: "first-draft-session-connected";
}

export interface FirstDraftDocumentIdentity {
  readonly documentId: string;
}

export interface SubscribeFirstDraftDocumentMessage extends FirstDraftDocumentIdentity {
  readonly type: "subscribe-first-draft-document";
  readonly knownRevision?: number;
}

export interface FirstDraftDocumentLoadedMessage extends FirstDraftDocumentIdentity {
  readonly type: "first-draft-document-loaded";
  readonly revision: number;
  /** Decoded and validated exactly once by the WebSocket message boundary. */
  readonly bootstrap: ValidatedFirstDraftBootstrap;
}

export type FirstDraftDocumentResynchronizationReason =
  | "revision-unavailable"
  | "revision-ahead"
  | "invalid-history";

export interface FirstDraftDocumentResynchronizedMessage
  extends FirstDraftDocumentIdentity {
  readonly type: "first-draft-document-resynchronized";
  readonly requestedRevision: number;
  readonly revision: number;
  readonly reason: FirstDraftDocumentResynchronizationReason;
  /** Decoded and validated exactly once by the WebSocket message boundary. */
  readonly bootstrap: ValidatedFirstDraftBootstrap;
}

export interface FirstDraftAcceptedTransactionReplayMessage extends FirstDraftDocumentIdentity {
  readonly type: "first-draft-accepted-transaction-replay";
  readonly transactionId: string;
  readonly baseRevision: number;
  readonly revision: number;
  readonly acceptedAt: number;
  readonly transaction: EditorTransportTransaction;
}

export interface FirstDraftDocumentCaughtUpMessage extends FirstDraftDocumentIdentity {
  readonly type: "first-draft-document-caught-up";
  readonly requestedRevision: number;
  readonly revision: number;
}

export interface UnsubscribeFirstDraftDocumentMessage extends FirstDraftDocumentIdentity {
  readonly type: "unsubscribe-first-draft-document";
}

export interface FirstDraftDocumentUnsubscribedMessage extends FirstDraftDocumentIdentity {
  readonly type: "first-draft-document-unsubscribed";
}

export interface FirstDraftCollaborationSubject {
  readonly actorId: string;
  readonly clientId: string;
  readonly sessionId: string;
}

export interface FirstDraftParticipantMetadata {
  readonly displayName: string;
  readonly color: string;
}

export interface FirstDraftParticipantPresence {
  readonly subject: FirstDraftCollaborationSubject;
  /** Ephemeral per-session ordering; unrelated to editor or database revisions. */
  readonly presenceRevision: number;
  readonly active: boolean;
  readonly metadata: FirstDraftParticipantMetadata;
}

export interface FirstDraftParticipantUpdateMessage
  extends FirstDraftDocumentIdentity, FirstDraftParticipantPresence {
  readonly type: "first-draft-participant-update";
}

export interface FirstDraftParticipantSnapshotMessage extends FirstDraftDocumentIdentity {
  readonly type: "first-draft-participant-snapshot";
  readonly participants: readonly FirstDraftParticipantPresence[];
}

export interface FirstDraftSelectionPresence {
  readonly subject: FirstDraftCollaborationSubject;
  /** Ephemeral per-session ordering; unrelated to editor or database revisions. */
  readonly selectionRevision: number;
  readonly selection: EditorStableSelection;
}

export interface FirstDraftSelectionUpdateMessage
  extends FirstDraftDocumentIdentity, FirstDraftSelectionPresence {
  readonly type: "first-draft-selection-update";
}

export interface FirstDraftSelectionSnapshotMessage extends FirstDraftDocumentIdentity {
  readonly type: "first-draft-selection-snapshot";
  readonly selections: readonly FirstDraftSelectionPresence[];
}

export function firstDraftCollaborationSubjectsEqual(
  left: FirstDraftCollaborationSubject,
  right: FirstDraftCollaborationSubject,
): boolean {
  return (
    left.actorId === right.actorId &&
    left.clientId === right.clientId &&
    left.sessionId === right.sessionId
  );
}

export function firstDraftParticipantPresencesEqual(
  left: FirstDraftParticipantPresence,
  right: FirstDraftParticipantPresence,
): boolean {
  return (
    firstDraftCollaborationSubjectsEqual(left.subject, right.subject) &&
    left.presenceRevision === right.presenceRevision &&
    left.active === right.active &&
    left.metadata.displayName === right.metadata.displayName &&
    left.metadata.color === right.metadata.color
  );
}

export function firstDraftSelectionValuesEqual(
  left: EditorStableSelection,
  right: EditorStableSelection,
): boolean {
  return editorStableSelectionsEqual(left, right);
}

export function firstDraftSelectionPresencesEqual(
  left: FirstDraftSelectionPresence,
  right: FirstDraftSelectionPresence,
): boolean {
  return (
    firstDraftCollaborationSubjectsEqual(left.subject, right.subject) &&
    left.selectionRevision === right.selectionRevision &&
    firstDraftSelectionValuesEqual(left.selection, right.selection)
  );
}

export interface FirstDraftProtocolErrorMessage {
  readonly type: "first-draft-protocol-error";
  readonly code: string;
  readonly message: string;
  readonly fatal: boolean;
}

export interface ProposedEditorTransactionMessage {
  readonly type: "proposed-editor-transaction";
  readonly transaction: EditorTransportTransaction;
}

export interface EditorTransactionAcceptedMessage {
  readonly type: "editor-transaction-accepted";
  readonly documentId: string;
  readonly transactionId: string;
  readonly baseRevision: number;
  readonly revision: number;
  readonly acceptedAt: number;
}

export type EditorTransactionPersistenceFailureReason =
  | "missing"
  | "invalid"
  | "integrity"
  | "unavailable";

export interface EditorTransactionPersistenceFailedMessage {
  readonly type: "editor-transaction-persistence-failed";
  readonly documentId: string;
  readonly transactionId: string;
  readonly reason: EditorTransactionPersistenceFailureReason;
  readonly retryable: boolean;
  readonly message: string;
}

export type FirstDraftClientMessage =
  | ConnectFirstDraftSessionMessage
  | SubscribeFirstDraftDocumentMessage
  | UnsubscribeFirstDraftDocumentMessage
  | FirstDraftParticipantUpdateMessage
  | FirstDraftSelectionUpdateMessage
  | ProposedEditorTransactionMessage;
export type FirstDraftServerMessage =
  | FirstDraftSessionConnectedMessage
  | FirstDraftDocumentLoadedMessage
  | FirstDraftDocumentResynchronizedMessage
  | FirstDraftAcceptedTransactionReplayMessage
  | FirstDraftDocumentCaughtUpMessage
  | FirstDraftDocumentUnsubscribedMessage
  | FirstDraftParticipantUpdateMessage
  | FirstDraftParticipantSnapshotMessage
  | FirstDraftSelectionUpdateMessage
  | FirstDraftSelectionSnapshotMessage
  | FirstDraftProtocolErrorMessage
  | EditorTransactionAcceptedMessage
  | EditorTransactionPersistenceFailedMessage;
export type FirstDraftMessage =
  | FirstDraftClientMessage
  | FirstDraftServerMessage;

export type DecodeFirstDraftMessageResult =
  | { readonly ok: true; readonly message: FirstDraftMessage }
  | { readonly ok: false; readonly error: string };

type InvalidDecodeResult = Extract<
  DecodeFirstDraftMessageResult,
  { readonly ok: false }
>;

interface BinaryContentDescriptor {
  readonly blockId: string;
  readonly blockType: string;
  readonly readProjection: JsonObject;
  readonly update: {
    readonly kind: "operation";
    readonly format: string;
    readonly version: number;
    readonly binaryIndex: number;
  };
}

/**
 * Encodes every First Draft socket message as one binary frame. Proposed
 * transaction metadata is JSON, followed by length-prefixed raw Yjs segments.
 */
export function encodeFirstDraftMessage(
  message: FirstDraftMessage,
): ArrayBuffer {
  const transactionMessage =
    message.type === "proposed-editor-transaction" ||
    message.type === "first-draft-accepted-transaction-replay";
  const binaryPayloads = transactionMessage
    ? message.transaction.content.map((entry) => entry.update.payload)
    : [];
  const metadata = transactionMessage
    ? {
        ...message,
        transaction: {
          ...message.transaction,
          content: message.transaction.content.map((entry, binaryIndex) => ({
            blockId: entry.blockId,
            blockType: entry.blockType,
            readProjection: entry.readProjection,
            update: {
              kind: entry.update.kind,
              format: entry.update.format,
              version: entry.update.version,
              binaryIndex,
            },
          })),
        },
      }
    : message.type === "first-draft-document-loaded" ||
        message.type === "first-draft-document-resynchronized"
      ? {
          ...message,
          bootstrap: serializeFirstDraftBootstrap(message.bootstrap),
        }
      : message;
  return encodeFirstDraftWireFrame(metadata, binaryPayloads);
}

export function decodeFirstDraftMessage(
  input: ArrayBuffer | ArrayBufferView,
): DecodeFirstDraftMessageResult {
  const decoded = decodeFirstDraftWireFrame(input);
  return decoded.ok
    ? validateMessageMetadata(decoded.metadata, decoded.payloads)
    : invalid(decoded.error);
}

function validateMessageMetadata(
  value: unknown,
  payloads: readonly Uint8Array[],
): DecodeFirstDraftMessageResult {
  if (!isRecord(value) || typeof value.type !== "string") {
    return invalid("First Draft message envelope is malformed");
  }
  if (value.type === "connect-first-draft-session") {
    if (payloads.length !== 0 || !validConnectMessage(value)) {
      return invalid("First Draft session connection is malformed");
    }
    return {
      ok: true,
      message: value as unknown as ConnectFirstDraftSessionMessage,
    };
  }
  if (value.type === "first-draft-session-connected") {
    if (payloads.length !== 0 || !validConnectedMessage(value)) {
      return invalid("First Draft session confirmation is malformed");
    }
    return {
      ok: true,
      message: value as unknown as FirstDraftSessionConnectedMessage,
    };
  }
  if (value.type === "subscribe-first-draft-document") {
    return validateNonBinaryMessage(
      value,
      payloads,
      validSubscribeDocumentMessage,
      "First Draft document subscription is malformed",
    );
  }
  if (value.type === "first-draft-document-loaded") {
    if (
      payloads.length !== 0 ||
      !hasExactKeys(value, ["type", "documentId", "revision", "bootstrap"]) ||
      !validDocumentIdentity(value) ||
      !isLocalRevision(value.revision)
    ) {
      return invalid("First Draft initial document is malformed");
    }
    try {
      const bootstrap = decodeFirstDraftBootstrap(value.bootstrap);
      if (
        bootstrap.documentId !== value.documentId ||
        bootstrap.revision !== value.revision
      ) {
        return invalid("First Draft initial document identity is inconsistent");
      }
      return {
        ok: true,
        message: Object.freeze({
          type: "first-draft-document-loaded" as const,
          documentId: value.documentId as string,
          revision: value.revision as number,
          bootstrap,
        }),
      };
    } catch (error) {
      return invalid(
        error instanceof Error
          ? error.message
          : "First Draft initial document is invalid",
      );
    }
  }
  if (value.type === "first-draft-document-resynchronized") {
    if (
      payloads.length !== 0 ||
      !hasExactKeys(value, [
        "type",
        "documentId",
        "requestedRevision",
        "revision",
        "reason",
        "bootstrap",
      ]) ||
      !validDocumentIdentity(value) ||
      !isLocalRevision(value.requestedRevision) ||
      !isLocalRevision(value.revision) ||
      !isResynchronizationReason(value.reason)
    ) {
      return invalid("First Draft document resynchronization is malformed");
    }
    try {
      const bootstrap = decodeFirstDraftBootstrap(value.bootstrap);
      if (
        bootstrap.documentId !== value.documentId ||
        bootstrap.revision !== value.revision
      ) {
        return invalid(
          "First Draft document resynchronization identity is inconsistent",
        );
      }
      return {
        ok: true,
        message: Object.freeze({
          type: "first-draft-document-resynchronized" as const,
          documentId: value.documentId as string,
          requestedRevision: value.requestedRevision as number,
          revision: value.revision as number,
          reason: value.reason as FirstDraftDocumentResynchronizationReason,
          bootstrap,
        }),
      };
    } catch (error) {
      return invalid(
        error instanceof Error
          ? error.message
          : "First Draft document resynchronization is invalid",
      );
    }
  }
  if (value.type === "first-draft-accepted-transaction-replay") {
    return validateTransportTransaction(value, payloads);
  }
  if (value.type === "first-draft-document-caught-up") {
    return validateNonBinaryMessage(
      value,
      payloads,
      validDocumentCaughtUpMessage,
      "First Draft document catch-up confirmation is malformed",
    );
  }
  if (value.type === "unsubscribe-first-draft-document") {
    return validateNonBinaryMessage(
      value,
      payloads,
      validDocumentMessage,
      "First Draft document unsubscription is malformed",
    );
  }
  if (value.type === "first-draft-document-unsubscribed") {
    return validateNonBinaryMessage(
      value,
      payloads,
      validDocumentMessage,
      "First Draft document unsubscription confirmation is malformed",
    );
  }
  if (value.type === "first-draft-participant-update") {
    return validateNonBinaryMessage(
      value,
      payloads,
      validParticipantUpdate,
      "First Draft participant update is malformed",
    );
  }
  if (value.type === "first-draft-participant-snapshot") {
    return validateNonBinaryMessage(
      value,
      payloads,
      validParticipantSnapshot,
      "First Draft participant snapshot is malformed",
    );
  }
  if (value.type === "first-draft-selection-update") {
    return validateNonBinaryMessage(
      value,
      payloads,
      validSelectionUpdate,
      "First Draft selection update is malformed",
    );
  }
  if (value.type === "first-draft-selection-snapshot") {
    return validateNonBinaryMessage(
      value,
      payloads,
      validSelectionSnapshot,
      "First Draft selection snapshot is malformed",
    );
  }
  if (value.type === "first-draft-protocol-error") {
    if (payloads.length !== 0 || !validErrorMessage(value)) {
      return invalid("First Draft protocol error message is malformed");
    }
    return {
      ok: true,
      message: value as unknown as FirstDraftProtocolErrorMessage,
    };
  }
  if (value.type === "editor-transaction-accepted") {
    if (payloads.length !== 0 || !validAcceptedMessage(value)) {
      return invalid("First Draft transaction acceptance is malformed");
    }
    return {
      ok: true,
      message: value as unknown as EditorTransactionAcceptedMessage,
    };
  }
  if (value.type === "editor-transaction-persistence-failed") {
    if (payloads.length !== 0 || !validPersistenceFailureMessage(value)) {
      return invalid(
        "First Draft transaction persistence failure is malformed",
      );
    }
    return {
      ok: true,
      message: value as unknown as EditorTransactionPersistenceFailedMessage,
    };
  }
  if (
    value.type !== "proposed-editor-transaction" &&
    value.type !== "first-draft-accepted-transaction-replay"
  ) {
    return invalid("First Draft message variant is unsupported");
  }
  return validateTransportTransaction(value, payloads);
}

function validateTransportTransaction(
  value: Record<string, unknown>,
  payloads: readonly Uint8Array[],
): DecodeFirstDraftMessageResult {
  const replay = value.type === "first-draft-accepted-transaction-replay";
  if (
    !hasExactKeys(
      value,
      replay
        ? [
            "type",
            "documentId",
            "transactionId",
            "baseRevision",
            "revision",
            "acceptedAt",
            "transaction",
          ]
        : ["type", "transaction"],
    )
  ) {
    return invalid("First Draft transaction envelope is malformed");
  }
  const checked = validateTransactionMetadata(value.transaction);
  if (!checked.ok) return checked;
  if (payloads.length !== checked.content.length) {
    return invalid("First Draft binary segment count does not match metadata");
  }
  const content = checked.content.map((entry, index) =>
    Object.freeze({
      blockId: entry.blockId as BlockId,
      blockType: entry.blockType as BlockType,
      readProjection:
        entry.readProjection as import("@repo/editor-core/codecs").EditorTextBlockContent,
      update: Object.freeze({
        kind: "operation" as const,
        format: entry.update.format,
        version: entry.update.version,
        payload: EditorImmutableBinary.takeOwnership(payloads[index]!),
      }) satisfies EditorContentOperationUpdate,
    }),
  );
  const transaction = Object.freeze({
    transactionId: checked.transactionId,
    historyAction: checked.historyAction,
    graph: checked.graph,
    metadata: checked.metadata,
    content: Object.freeze(content),
  });
  if (replay) {
    if (
      !validAcceptedTransactionFields(value) ||
      value.transactionId !== transaction.transactionId
    ) {
      return invalid("First Draft accepted transaction replay is malformed");
    }
    return {
      ok: true,
      message: Object.freeze({
        type: "first-draft-accepted-transaction-replay" as const,
        documentId: value.documentId as string,
        transactionId: value.transactionId as string,
        baseRevision: value.baseRevision as number,
        revision: value.revision as number,
        acceptedAt: value.acceptedAt as number,
        transaction,
      }),
    };
  }
  return {
    ok: true,
    message: Object.freeze({
      type: "proposed-editor-transaction" as const,
      transaction,
    }),
  };
}

interface CheckedTransactionMetadata {
  readonly ok: true;
  readonly transactionId: string;
  readonly historyAction: "command" | "undo" | "redo";
  readonly graph: {
    readonly changes: readonly EditorTransportBlockGraphChange[];
  } | null;
  readonly metadata: UpdateBlockMetadataOperation | null;
  readonly content: readonly BinaryContentDescriptor[];
}

function validateTransactionMetadata(
  value: unknown,
): CheckedTransactionMetadata | InvalidDecodeResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "transactionId",
      "historyAction",
      "graph",
      "metadata",
      "content",
    ])
  ) {
    return invalid("First Draft proposed transaction is malformed");
  }
  if (!isId(value.transactionId)) {
    return invalid("First Draft transaction identity is invalid");
  }
  if (!isHistoryAction(value.historyAction)) {
    return invalid("First Draft history action is invalid");
  }
  const graph = validateGraph(value.graph);
  if (!graph.ok) return graph;
  let metadata: UpdateBlockMetadataOperation | null = null;
  if (value.metadata !== null) {
    const metadataValidation = validateUpdateBlockMetadataOperation(
      value.metadata,
    );
    if (!metadataValidation.valid) {
      return invalid(
        `First Draft metadata operation is invalid: ${metadataValidation.errors.join("; ")}`,
      );
    }
    metadata = value.metadata as UpdateBlockMetadataOperation;
  }
  const content = validateContentDescriptors(value.content);
  if (!content.ok) return content;
  if (
    graph.graph === null &&
    metadata === null &&
    content.content.length === 0
  ) {
    return invalid("First Draft transaction contains no semantic changes");
  }
  return {
    ok: true,
    transactionId: value.transactionId,
    historyAction: value.historyAction,
    graph: graph.graph,
    metadata,
    content: content.content,
  };
}

function validConnectMessage(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, [
      "type",
      "actorId",
      "clientId",
      "sessionId",
      "documentId",
    ]) && validSessionIdentity(value)
  );
}

function validConnectedMessage(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, [
      "type",
      "actorId",
      "clientId",
      "sessionId",
      "documentId",
    ]) && validSessionIdentity(value)
  );
}

function validateNonBinaryMessage(
  value: Record<string, unknown>,
  payloads: readonly Uint8Array[],
  validate: (value: Record<string, unknown>) => boolean,
  error: string,
): DecodeFirstDraftMessageResult {
  return payloads.length === 0 && validate(value)
    ? { ok: true, message: value as unknown as FirstDraftMessage }
    : invalid(error);
}

function validDocumentMessage(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, ["type", "documentId"]) && validDocumentIdentity(value)
  );
}

function validSubscribeDocumentMessage(
  value: Record<string, unknown>,
): boolean {
  return (
    hasOnlyKeys(value, ["type", "documentId", "knownRevision"]) &&
    Object.keys(value).length >= 2 &&
    value.type === "subscribe-first-draft-document" &&
    validDocumentIdentity(value) &&
    (value.knownRevision === undefined || isLocalRevision(value.knownRevision))
  );
}

function isResynchronizationReason(
  value: unknown,
): value is FirstDraftDocumentResynchronizationReason {
  return (
    value === "revision-unavailable" ||
    value === "revision-ahead" ||
    value === "invalid-history"
  );
}

function validDocumentCaughtUpMessage(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, [
      "type",
      "documentId",
      "requestedRevision",
      "revision",
    ]) &&
    validDocumentIdentity(value) &&
    isLocalRevision(value.requestedRevision) &&
    isLocalRevision(value.revision) &&
    Number(value.revision) >= Number(value.requestedRevision)
  );
}

function validDocumentIdentity(value: Record<string, unknown>): boolean {
  return isValidFirstDraftDocumentId(value.documentId);
}

function validSubject(value: unknown): value is FirstDraftCollaborationSubject {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["actorId", "clientId", "sessionId"]) &&
    isBoundedIdentity(value.actorId) &&
    isBoundedIdentity(value.clientId) &&
    isBoundedIdentity(value.sessionId)
  );
}

function validParticipantMetadata(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["displayName", "color"]) &&
    typeof value.displayName === "string" &&
    value.displayName.trim().length > 0 &&
    value.displayName.length <= 48 &&
    value.displayName.trim() === value.displayName &&
    !hasUnsafeDisplayNameCharacters(value.displayName) &&
    typeof value.color === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(value.color)
  );
}

function hasUnsafeDisplayNameCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || "<>&".includes(character);
  });
}

function validParticipantPresence(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "subject",
      "presenceRevision",
      "active",
      "metadata",
    ]) &&
    validParticipantFields(value)
  );
}

function validParticipantFields(value: Record<string, unknown>): boolean {
  return (
    validSubject(value.subject) &&
    isEphemeralRevision(value.presenceRevision) &&
    typeof value.active === "boolean" &&
    validParticipantMetadata(value.metadata)
  );
}

function validParticipantUpdate(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, [
      "type",
      "documentId",
      "subject",
      "presenceRevision",
      "active",
      "metadata",
    ]) &&
    validDocumentIdentity(value) &&
    validParticipantFields(value)
  );
}

function validParticipantSnapshot(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, ["type", "documentId", "participants"]) &&
    validDocumentIdentity(value) &&
    Array.isArray(value.participants) &&
    value.participants.length <= 10_000 &&
    value.participants.every(validParticipantPresence)
  );
}

function validSelectionPresence(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["subject", "selectionRevision", "selection"]) &&
    validSelectionFields(value)
  );
}

function validSelectionFields(value: Record<string, unknown>): boolean {
  return (
    validSubject(value.subject) &&
    isEphemeralRevision(value.selectionRevision) &&
    validStableSelection(value.selection)
  );
}

function validSelectionUpdate(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, [
      "type",
      "documentId",
      "subject",
      "selectionRevision",
      "selection",
    ]) &&
    validDocumentIdentity(value) &&
    validSelectionFields(value)
  );
}

function validSelectionSnapshot(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, ["type", "documentId", "selections"]) &&
    validDocumentIdentity(value) &&
    Array.isArray(value.selections) &&
    value.selections.length <= 10_000 &&
    value.selections.every(validSelectionPresence)
  );
}

function validStableSelection(value: unknown): value is EditorStableSelection {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "none") return hasExactKeys(value, ["kind"]);
  if (
    value.kind !== "selection" ||
    !hasExactKeys(value, ["kind", "selection"]) ||
    !isRecord(value.selection)
  ) {
    return false;
  }
  const selection = value.selection;
  if (selection.kind === "document") {
    return (
      hasExactKeys(selection, ["kind", "direction", "anchor", "focus"]) &&
      (selection.direction === "forward" ||
        selection.direction === "backward") &&
      validStableSelectionPoint(selection.anchor) &&
      validStableSelectionPoint(selection.focus)
    );
  }
  return (
    selection.kind === "block-internal" &&
    hasExactKeys(selection, ["kind", "blockId", "subsystem", "payload"]) &&
    isId(selection.blockId) &&
    isBoundedIdentity(selection.subsystem) &&
    isJsonValue(selection.payload)
  );
}

function validStableSelectionPoint(value: unknown): boolean {
  if (!isRecord(value) || !isId(value.blockId)) return false;
  if (value.kind === "block") {
    return (
      hasExactKeys(value, ["kind", "blockId", "surface"]) &&
      value.surface === "block"
    );
  }
  if (
    value.kind !== "text" ||
    !hasExactKeys(value, [
      "kind",
      "blockId",
      "textOffset",
      "textAnchor",
      "affinity",
    ]) ||
    !Number.isSafeInteger(value.textOffset) ||
    Number(value.textOffset) < 0 ||
    (value.affinity !== null &&
      value.affinity !== "forward" &&
      value.affinity !== "backward") ||
    !isRecord(value.textAnchor) ||
    !hasExactKeys(value.textAnchor, ["kind", "codec", "version", "payload"]) ||
    value.textAnchor.kind !== "block-relative-text" ||
    !isBoundedIdentity(value.textAnchor.codec) ||
    value.textAnchor.version !== 1 ||
    !isRecord(value.textAnchor.payload) ||
    !hasOnlyKeys(value.textAnchor.payload, ["encoded", "assoc"]) ||
    typeof value.textAnchor.payload.encoded !== "string" ||
    value.textAnchor.payload.encoded.length > 65_536
  ) {
    return false;
  }
  const assoc = value.textAnchor.payload.assoc;
  return assoc === undefined || assoc === -1 || assoc === 0 || assoc === 1;
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

function validSessionIdentity(value: Record<string, unknown>): boolean {
  return (
    isBoundedIdentity(value.actorId) &&
    isBoundedIdentity(value.clientId) &&
    isBoundedIdentity(value.sessionId) &&
    isValidFirstDraftDocumentId(value.documentId)
  );
}

function validAcceptedMessage(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, [
      "type",
      "documentId",
      "transactionId",
      "baseRevision",
      "revision",
      "acceptedAt",
    ]) &&
    isValidFirstDraftDocumentId(value.documentId) &&
    isId(value.transactionId) &&
    isLocalRevision(value.baseRevision) &&
    isLocalRevision(value.revision) &&
    value.revision === value.baseRevision + 1 &&
    isLocalRevision(value.acceptedAt)
  );
}

function validAcceptedTransactionFields(
  value: Record<string, unknown>,
): boolean {
  return (
    isValidFirstDraftDocumentId(value.documentId) &&
    isId(value.transactionId) &&
    isLocalRevision(value.baseRevision) &&
    isLocalRevision(value.revision) &&
    value.revision === Number(value.baseRevision) + 1 &&
    isLocalRevision(value.acceptedAt)
  );
}

function validPersistenceFailureMessage(
  value: Record<string, unknown>,
): boolean {
  return (
    hasExactKeys(value, [
      "type",
      "documentId",
      "transactionId",
      "reason",
      "retryable",
      "message",
    ]) &&
    isValidFirstDraftDocumentId(value.documentId) &&
    isId(value.transactionId) &&
    isPersistenceFailureReason(value.reason) &&
    typeof value.retryable === "boolean" &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    value.message.length <= 4_096
  );
}

function isPersistenceFailureReason(
  value: unknown,
): value is EditorTransactionPersistenceFailureReason {
  return (
    value === "missing" ||
    value === "invalid" ||
    value === "integrity" ||
    value === "unavailable"
  );
}

function validErrorMessage(value: Record<string, unknown>): boolean {
  return (
    hasExactKeys(value, ["type", "code", "message", "fatal"]) &&
    isBoundedText(value.code) &&
    typeof value.message === "string" &&
    value.message.length <= 4_096 &&
    typeof value.fatal === "boolean"
  );
}

function validateGraph(value: unknown):
  | {
      readonly ok: true;
      readonly graph: {
        readonly changes: readonly EditorTransportBlockGraphChange[];
      } | null;
    }
  | InvalidDecodeResult {
  if (value === null) return { ok: true, graph: null };
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["changes"]) ||
    !Array.isArray(value.changes) ||
    value.changes.length === 0
  ) {
    return invalid("First Draft graph operation is malformed");
  }
  for (const change of value.changes) {
    if (!validGraphChange(change)) {
      return invalid("First Draft graph change is invalid");
    }
  }
  return {
    ok: true,
    graph: value as unknown as {
      readonly changes: readonly EditorTransportBlockGraphChange[];
    },
  };
}

function validGraphChange(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.kind !== "string" ||
    !isId(value.blockId)
  ) {
    return false;
  }
  if (value.kind === "delete") {
    return hasExactKeys(value, ["kind", "blockId"]);
  }
  if (value.kind === "change-type") {
    return (
      hasExactKeys(value, ["kind", "blockId", "blockType"]) &&
      isId(value.blockType)
    );
  }
  if (value.kind === "move" || value.kind === "restore") {
    return (
      hasExactKeys(value, ["kind", "blockId", "placement"]) &&
      validPlacement(value.placement)
    );
  }
  if (
    value.kind !== "create" ||
    !isId(value.blockType) ||
    !validPlacement(value.placement)
  ) {
    return false;
  }
  if (
    !hasOnlyKeys(value, [
      "kind",
      "blockId",
      "blockType",
      "placement",
      "initialMetadata",
    ])
  ) {
    return false;
  }
  return (
    value.initialMetadata === undefined ||
    validateJsonObject(value.initialMetadata, "initialMetadata").length === 0
  );
}

function validPlacement(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["parentId", "previousSiblingId", "nextSiblingId"]) &&
    [value.parentId, value.previousSiblingId, value.nextSiblingId].every(
      (candidate) => candidate === null || isId(candidate),
    )
  );
}

function validateContentDescriptors(
  value: unknown,
):
  | { readonly ok: true; readonly content: readonly BinaryContentDescriptor[] }
  | InvalidDecodeResult {
  if (!Array.isArray(value)) {
    return invalid("First Draft content updates must be an array");
  }
  const blockIds = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, [
        "blockId",
        "blockType",
        "readProjection",
        "update",
      ]) ||
      !isId(entry.blockId) ||
      !isId(entry.blockType) ||
      blockIds.has(entry.blockId) ||
      validateJsonObject(entry.readProjection, "readProjection").length > 0 ||
      !isRecord(entry.update) ||
      !hasExactKeys(entry.update, [
        "kind",
        "format",
        "version",
        "binaryIndex",
      ]) ||
      entry.update.kind !== "operation" ||
      entry.update.format !== EDITOR_YJS_CONTENT_FORMAT ||
      entry.update.version !== EDITOR_YJS_CONTENT_FORMAT_VERSION ||
      entry.update.binaryIndex !== index
    ) {
      return invalid("First Draft content operation data is invalid");
    }
    blockIds.add(entry.blockId);
  }
  return { ok: true, content: value as BinaryContentDescriptor[] };
}

function invalid(error: string): InvalidDecodeResult {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && isStructuralKey(value);
}

function isBoundedText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 2_048
  );
}

function isBoundedIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    value.trim() === value &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isEphemeralRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isLocalRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isHistoryAction(value: unknown): value is "command" | "undo" | "redo" {
  return value === "command" || value === "undo" || value === "redo";
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => expected.includes(key))
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return Object.keys(value).every((key) => expected.includes(key));
}
