import type {
  CollaborationSubject,
  CollaborationSubjectKey,
} from "./contracts.ts";

export function toCollaborationSubjectKey(
  value: unknown,
): CollaborationSubjectKey | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["actorId", "clientId", "sessionId"])
  ) {
    return null;
  }
  const subject = value as unknown as CollaborationSubject;
  if (
    !validIdentityPart(subject.actorId) ||
    !validIdentityPart(subject.clientId) ||
    !validIdentityPart(subject.sessionId)
  ) {
    return null;
  }
  return [subject.actorId, subject.clientId, subject.sessionId]
    .map((part) => `${part.length}:${part}`)
    .join("|") as CollaborationSubjectKey;
}

function validIdentityPart(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
