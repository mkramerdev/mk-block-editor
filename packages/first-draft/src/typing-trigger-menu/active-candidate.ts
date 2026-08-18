export interface FirstDraftTypingTriggerCandidate {
  readonly id: string;
}

export function retainFirstDraftTypingTriggerActiveId(
  activeId: string | null,
  candidates: readonly FirstDraftTypingTriggerCandidate[],
): string | null {
  return candidates.some(({ id }) => id === activeId)
    ? activeId
    : (candidates[0]?.id ?? null);
}

export function moveFirstDraftTypingTriggerActiveId(
  activeId: string | null,
  candidates: readonly FirstDraftTypingTriggerCandidate[],
  delta: -1 | 1,
): string | null {
  if (candidates.length === 0) return null;
  const current = candidates.findIndex(({ id }) => id === activeId);
  const index = current < 0 ? 0 : current;
  return candidates[(index + delta + candidates.length) % candidates.length]!
    .id;
}
