"use client";

import { useMemo, useSyncExternalStore, type CSSProperties } from "react";
import type { EditableEditor } from "@repo/editor-web/editor";
import {
  toCollaborationSubjectKey,
  type EditorDocumentGeometryReader,
  type EditorDocumentRect,
  type ResolvedSelectionFocusTarget,
} from "@repo/editor-web/document-runtime";
import {
  type CollaborationSubjectKey,
  type ResolvedEditorSelection,
} from "@repo/editor-web/editor";
import type {
  FirstDraftCollaborationSubject,
  FirstDraftParticipantPresence,
} from "./transport/message-protocol.ts";

export interface FirstDraftSelectionBadgeLayerProps {
  readonly editor: EditableEditor;
  readonly participants: readonly FirstDraftParticipantPresence[];
  readonly localSubject?: FirstDraftCollaborationSubject;
}

/** First Draft presentation for resolved generic remote selections. */
export function FirstDraftSelectionBadgeLayer({
  editor,
  participants,
  localSubject,
}: FirstDraftSelectionBadgeLayerProps) {
  const selections = useSyncExternalStore(
    editor.additionalSelections.subscribe,
    editor.additionalSelections.getSnapshot,
    editor.additionalSelections.getSnapshot,
  );
  const localSubjectKey = localSubject
    ? toCollaborationSubjectKey(localSubject)
    : null;
  const participantsBySubject = useMemo(() => {
    const result = new Map<
      CollaborationSubjectKey,
      FirstDraftParticipantPresence
    >();
    for (const participant of participants) {
      if (!participant.active) continue;
      const key = toCollaborationSubjectKey(participant.subject);
      if (!key || key === localSubjectKey) continue;
      result.set(key, participant);
    }
    return result;
  }, [localSubjectKey, participants]);
  const hasRenderableRemoteBadge = selections.some(
    (record) =>
      record.active &&
      record.resolution === "resolved" &&
      record.subject !== localSubjectKey &&
      participantsBySubject.has(record.subject),
  );
  useSyncExternalStore(
    hasRenderableRemoteBadge ? editor.geometry.subscribe : subscribeNever,
    hasRenderableRemoteBadge ? editor.geometry.getRevision : readZero,
    readZero,
  );

  return (
    <div
      className="first-draft-selection-badge-layer"
      data-first-draft-selection-badge-layer="true"
      aria-hidden="true"
    >
      {selections.flatMap((record) => {
        if (
          !record.active ||
          record.resolution !== "resolved" ||
          record.subject === localSubjectKey
        ) {
          return [];
        }
        const participant = participantsBySubject.get(record.subject);
        const target = record.resolvedSelection
          ? readFirstDraftSelectionBadgeTarget(record.resolvedSelection)
          : null;
        const rect = target
          ? readFirstDraftSelectionBadgeRect(editor.geometry, target)
          : null;
        if (!participant || !target || !rect) return [];
        const color = validatedParticipantColor(participant.metadata.color);
        if (!color) return [];
        return [
          <FirstDraftSelectionBadge
            key={record.subject}
            participant={participant}
            target={target}
            rect={rect}
            color={color}
          />,
        ];
      })}
    </div>
  );
}

const subscribeNever = () => () => undefined;
const readZero = () => 0;

function FirstDraftSelectionBadge({
  participant,
  target,
  rect,
  color,
}: {
  readonly participant: FirstDraftParticipantPresence;
  readonly target: ResolvedSelectionFocusTarget;
  readonly rect: EditorDocumentRect;
  readonly color: string;
}) {
  const label =
    validLabel(participant.metadata.displayName) ??
    validLabel(participant.subject.actorId) ??
    "Collaborator";
  const style = {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    "--first-draft-participant-color": color,
    "--first-draft-participant-foreground": readableForeground(color),
  } as CSSProperties;
  return (
    <span
      className="first-draft-selection-badge"
      data-first-draft-selection-badge={label}
      data-first-draft-selection-badge-actor={participant.subject.actorId}
      data-first-draft-selection-badge-client={participant.subject.clientId}
      data-first-draft-selection-badge-session={participant.subject.sessionId}
      data-first-draft-selection-badge-block-id={target.blockId}
      data-first-draft-selection-badge-target-kind={target.kind}
      data-first-draft-selection-badge-color={color}
      style={style}
    >
      {label}
    </span>
  );
}

function readFirstDraftSelectionBadgeTarget(
  selection: ResolvedEditorSelection,
): ResolvedSelectionFocusTarget | null {
  if (selection.kind === "block-internal") {
    return selection.decorationTarget ?? selection.focusTarget;
  }
  const anchor = selection.anchor;
  return anchor.textAnchor
    ? { kind: "text", blockId: anchor.blockId, point: anchor }
    : { kind: "block", blockId: anchor.blockId, target: null };
}

export function readFirstDraftSelectionBadgeRect(
  geometry: EditorDocumentGeometryReader,
  target: ResolvedSelectionFocusTarget,
): EditorDocumentRect | null {
  return target.kind === "text"
    ? target.point.affinity
      ? geometry.readTextCaretRect(
          target.blockId,
          target.point.textOffset,
          target.point.affinity,
        )
      : geometry.readTextCaretRect(target.blockId, target.point.textOffset)
    : geometry.readBlockSelectionRect(target.blockId, target.target);
}

function validatedParticipantColor(value: string): string | null {
  return /^#[0-9a-fA-F]{6}$/u.test(value) ? value : null;
}

function validLabel(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readableForeground(color: string): "#111827" | "#ffffff" {
  const channels = [1, 3, 5].map((start) =>
    Number.parseInt(color.slice(start, start + 2), 16),
  );
  const luminance =
    (channels[0]! * 299 + channels[1]! * 587 + channels[2]! * 114) / 1000;
  return luminance >= 150 ? "#111827" : "#ffffff";
}
