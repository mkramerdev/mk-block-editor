import { describe, expect, it } from "vitest";
import {
  advanceFirstDraftTypingTriggerDismissal,
  initialFirstDraftTypingTriggerDismissalState,
  moveFirstDraftTypingTriggerActiveId,
  placeFirstDraftTypingTriggerMenu,
  retainFirstDraftTypingTriggerActiveId,
} from "../typing-trigger-menu/index.ts";
import {
  filterFirstDraftSlashActions,
  firstDraftSlashActionCatalog,
} from "./catalog.ts";
import { firstDraftSlashTypingTrigger } from "./trigger.ts";

describe("First Draft slash policies", () => {
  it("allows start, ASCII space, and line-break boundaries only in text blocks", () => {
    const allowed = firstDraftSlashTypingTrigger.isAllowed!;
    const context = (textBeforeTrigger: string, blockType = "paragraph") => ({
      blockId: "block" as never,
      blockType,
      trigger: "/",
      triggerRange: { from: textBeforeTrigger.length, to: textBeforeTrigger.length + 1 },
      textBeforeTrigger,
    });
    expect(allowed(context(""))).toBe(true);
    expect(allowed(context("before "))).toBe(true);
    expect(allowed(context("before\n"))).toBe(true);
    expect(allowed(context("before"))).toBe(false);
    expect(allowed(context("before\t"))).toBe(false);
    expect(allowed(context("", "divider"))).toBe(false);
  });

  it("always retains one active candidate and wraps movement", () => {
    const candidates = firstDraftSlashActionCatalog.slice(0, 3);
    expect(retainFirstDraftTypingTriggerActiveId(null, candidates)).toBe("paragraph");
    expect(retainFirstDraftTypingTriggerActiveId("heading-1", candidates)).toBe("heading-1");
    expect(retainFirstDraftTypingTriggerActiveId("missing", candidates)).toBe("paragraph");
    expect(moveFirstDraftTypingTriggerActiveId("paragraph", candidates, -1)).toBe("heading-2");
    expect(moveFirstDraftTypingTriggerActiveId("heading-2", candidates, 1)).toBe("paragraph");
  });

  it("dismisses only after the canonical second space revision", () => {
    const count = (query: string) => filterFirstDraftSlashActions(query).length;
    let state = advanceFirstDraftTypingTriggerDismissal(
      initialFirstDraftTypingTriggerDismissalState,
      { sessionId: "one", revision: 1, query: "" },
      count,
    ).state;
    let next = advanceFirstDraftTypingTriggerDismissal(
      state,
      { sessionId: "one", revision: 2, query: "heading " },
      count,
    );
    expect(next.dismiss).toBe(false);
    state = next.state;
    next = advanceFirstDraftTypingTriggerDismissal(
      state,
      { sessionId: "one", revision: 3, query: "heading  " },
      count,
    );
    expect(next).toMatchObject({ dismiss: true, reason: "double-space" });
  });

  it("counts four appended unmatched Unicode letters and resets on all edge changes", () => {
    const count = (query: string) => (query.startsWith("x") ? 0 : 2);
    let state = advanceFirstDraftTypingTriggerDismissal(
      initialFirstDraftTypingTriggerDismissalState,
      { sessionId: "one", revision: 1, query: "" },
      count,
    ).state;
    for (const [index, query] of ["x", "xé", "xéβ", "xéβЖ"].entries()) {
      const next = advanceFirstDraftTypingTriggerDismissal(
        state,
        { sessionId: "one", revision: index + 2, query },
        count,
      );
      expect(next.dismiss).toBe(index === 3);
      state = next.state;
    }
    expect(state.unmatchedLetterStreak).toBe(4);
    state = advanceFirstDraftTypingTriggerDismissal(
      state,
      { sessionId: "one", revision: 6, query: "xéβЖ-" },
      count,
    ).state;
    expect(state.unmatchedLetterStreak).toBe(0);
    state = advanceFirstDraftTypingTriggerDismissal(
      state,
      { sessionId: "one", revision: 7, query: "x" },
      count,
    ).state;
    expect(state.unmatchedLetterStreak).toBe(0);
    expect(
      advanceFirstDraftTypingTriggerDismissal(
        state,
        { sessionId: "two", revision: 1, query: "x" },
        count,
      ).state.unmatchedLetterStreak,
    ).toBe(0);
  });

  it("places strictly on the side with more space and honors visual viewport offsets", () => {
    const viewport = { left: 20, top: 100, width: 500, height: 400 };
    expect(
      placeFirstDraftTypingTriggerMenu(
        { left: 10, top: 390, width: 1, height: 20 },
        { width: 200, height: 300 },
        viewport,
      ),
    ).toMatchObject({ placement: "top", left: 28, availableHeight: 276 });
    expect(
      placeFirstDraftTypingTriggerMenu(
        { left: 500, top: 180, width: 1, height: 20 },
        { width: 200, height: 300 },
        viewport,
      ),
    ).toMatchObject({ placement: "bottom", left: 312, availableHeight: 286 });
    expect(
      placeFirstDraftTypingTriggerMenu(
        { left: 100, top: 290, width: 1, height: 20 },
        { width: 200, height: 100 },
        viewport,
      )?.placement,
    ).toBe("bottom");
  });

  it("positions upward from the rendered box height", () => {
    const position = placeFirstDraftTypingTriggerMenu(
      { left: 100, top: 500, width: 1, height: 20 },
      { width: 200, height: 120 },
      { left: 0, top: 0, width: 800, height: 700 },
    );
    expect(position).toMatchObject({
      placement: "top",
      top: 374,
      availableHeight: 486,
    });
  });
});
