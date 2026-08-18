import { describe, expect, it } from "vitest";
import {
  advanceFirstDraftTypingTriggerDismissal,
  initialFirstDraftTypingTriggerDismissalState,
  moveFirstDraftTypingTriggerActiveId,
  retainFirstDraftTypingTriggerActiveId,
} from "../typing-trigger-menu/index.ts";
import { filterFirstDraftPeople, firstDraftPeople } from "./people.ts";
import { firstDraftMentionTypingTrigger } from "./trigger.ts";

describe("First Draft mention policies", () => {
  it("allows start, ASCII space, and line-break boundaries only in text blocks", () => {
    const allowed = firstDraftMentionTypingTrigger.isAllowed!;
    const context = (textBeforeTrigger: string, blockType = "paragraph") => ({
      blockId: "block" as never,
      blockType,
      trigger: "@",
      triggerRange: {
        from: textBeforeTrigger.length,
        to: textBeforeTrigger.length + 1,
      },
      textBeforeTrigger,
    });
    expect(allowed(context(""))).toBe(true);
    expect(allowed(context("before "))).toBe(true);
    expect(allowed(context("before\n"))).toBe(true);
    expect(allowed(context("before\r"))).toBe(true);
    expect(allowed(context("before"))).toBe(false);
    expect(allowed(context("before\t"))).toBe(false);
    expect(allowed(context("name@example"))).toBe(false);
    expect(allowed(context("", "divider"))).toBe(false);
  });

  it("retains an available person, falls back to first, and wraps movement", () => {
    const candidates = firstDraftPeople.slice(0, 3);
    expect(retainFirstDraftTypingTriggerActiveId(null, candidates)).toBe(
      "person-001",
    );
    expect(
      retainFirstDraftTypingTriggerActiveId("person-002", candidates),
    ).toBe("person-002");
    expect(retainFirstDraftTypingTriggerActiveId("missing", candidates)).toBe(
      "person-001",
    );
    expect(
      moveFirstDraftTypingTriggerActiveId("person-001", candidates, -1),
    ).toBe("person-003");
    expect(
      moveFirstDraftTypingTriggerActiveId("person-003", candidates, 1),
    ).toBe("person-001");
  });

  it("dismisses on the second consecutive space without rewriting the query", () => {
    const count = (query: string) => filterFirstDraftPeople(query).length;
    let state = advanceFirstDraftTypingTriggerDismissal(
      initialFirstDraftTypingTriggerDismissalState,
      { sessionId: "one", revision: 1, query: "" },
      count,
    ).state;
    state = advanceFirstDraftTypingTriggerDismissal(
      state,
      { sessionId: "one", revision: 2, query: "maya " },
      count,
    ).state;
    expect(
      advanceFirstDraftTypingTriggerDismissal(
        state,
        { sessionId: "one", revision: 3, query: "maya  " },
        count,
      ),
    ).toMatchObject({ dismiss: true, reason: "double-space" });
  });

  it("dismisses after four unmatched Unicode letters and resets every streak edge", () => {
    const count = (query: string) => filterFirstDraftPeople(query).length;
    let state = advanceFirstDraftTypingTriggerDismissal(
      initialFirstDraftTypingTriggerDismissalState,
      { sessionId: "one", revision: 1, query: "" },
      count,
    ).state;
    for (const [index, query] of ["ζ", "ζλ", "ζλβ", "ζλβЖ"].entries()) {
      const next = advanceFirstDraftTypingTriggerDismissal(
        state,
        { sessionId: "one", revision: index + 2, query },
        count,
      );
      expect(next.dismiss).toBe(index === 3);
      state = next.state;
    }
    state = advanceFirstDraftTypingTriggerDismissal(
      state,
      { sessionId: "one", revision: 6, query: "ζλβЖ-" },
      count,
    ).state;
    expect(state.unmatchedLetterStreak).toBe(0);
    state = advanceFirstDraftTypingTriggerDismissal(
      state,
      { sessionId: "one", revision: 7, query: "maya" },
      count,
    ).state;
    expect(state.unmatchedLetterStreak).toBe(0);
    state = advanceFirstDraftTypingTriggerDismissal(
      state,
      { sessionId: "one", revision: 8, query: "m" },
      count,
    ).state;
    expect(state.unmatchedLetterStreak).toBe(0);
    expect(
      advanceFirstDraftTypingTriggerDismissal(
        state,
        { sessionId: "two", revision: 1, query: "ζ" },
        count,
      ).state.unmatchedLetterStreak,
    ).toBe(0);
  });
});
