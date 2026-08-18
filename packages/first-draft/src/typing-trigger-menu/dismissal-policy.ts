export interface FirstDraftTypingTriggerDismissalState {
  readonly sessionId: string | null;
  readonly revision: number;
  readonly query: string;
  readonly candidateCount: number;
  readonly unmatchedLetterStreak: number;
}

export interface FirstDraftTypingTriggerDismissalResult {
  readonly state: FirstDraftTypingTriggerDismissalState;
  readonly dismiss: boolean;
  readonly reason: "double-space" | "unmatched-letters" | null;
}

export const initialFirstDraftTypingTriggerDismissalState: FirstDraftTypingTriggerDismissalState =
  Object.freeze({
    sessionId: null,
    revision: 0,
    query: "",
    candidateCount: 0,
    unmatchedLetterStreak: 0,
  });

export function advanceFirstDraftTypingTriggerDismissal(
  previous: FirstDraftTypingTriggerDismissalState,
  current: {
    readonly sessionId: string;
    readonly revision: number;
    readonly query: string;
  },
  candidateCountForQuery: (query: string) => number,
): FirstDraftTypingTriggerDismissalResult {
  const currentCount = candidateCountForQuery(current.query);
  if (
    previous.sessionId !== current.sessionId ||
    current.revision < previous.revision
  ) {
    return result(
      {
        sessionId: current.sessionId,
        revision: current.revision,
        query: current.query,
        candidateCount: currentCount,
        unmatchedLetterStreak: 0,
      },
      null,
    );
  }
  if (current.revision === previous.revision) return result(previous, null);
  if (!current.query.startsWith(previous.query)) {
    return result(
      {
        sessionId: current.sessionId,
        revision: current.revision,
        query: current.query,
        candidateCount: currentCount,
        unmatchedLetterStreak: 0,
      },
      null,
    );
  }

  const appended = current.query.slice(previous.query.length);
  if (appended.length === 0) {
    return result(
      {
        sessionId: current.sessionId,
        revision: current.revision,
        query: current.query,
        candidateCount: currentCount,
        unmatchedLetterStreak: 0,
      },
      null,
    );
  }

  let streak = previous.unmatchedLetterStreak;
  let partialQuery = previous.query;
  let priorCount = previous.candidateCount;
  for (const codePoint of Array.from(appended)) {
    partialQuery += codePoint;
    const nextCount = candidateCountForQuery(partialQuery);
    if (nextCount > 0) {
      streak = 0;
    } else if (/^\p{L}$/u.test(codePoint)) {
      streak = priorCount > 0 ? 1 : streak + 1;
    } else {
      streak = 0;
    }
    priorCount = nextCount;
  }
  const state = {
    sessionId: current.sessionId,
    revision: current.revision,
    query: current.query,
    candidateCount: currentCount,
    unmatchedLetterStreak: streak,
  };
  const doubleSpace =
    appended.endsWith(" ") && current.query.endsWith("  ");
  return result(
    state,
    doubleSpace
      ? "double-space"
      : streak > 3
        ? "unmatched-letters"
        : null,
  );
}

function result(
  state: FirstDraftTypingTriggerDismissalState,
  reason: FirstDraftTypingTriggerDismissalResult["reason"],
): FirstDraftTypingTriggerDismissalResult {
  return { state: Object.freeze(state), dismiss: reason !== null, reason };
}
