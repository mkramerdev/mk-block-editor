import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { firstDraftMentionDefinition } from "./mentions.tsx";

describe("First Draft mention renderer", () => {
  afterEach(cleanup);

  it("resolves a known stable ID through the current people catalog", () => {
    render(firstDraftMentionDefinition.render({ id: "person-001" }));
    const mention = screen.getByLabelText("person mention Maya Chen");
    expect(mention.textContent).toBe("@Maya Chen");
    expect(mention.getAttribute("data-mention-id")).toBe("person-001");
  });

  it("renders unknown IDs with an explicit safe fallback", () => {
    render(
      firstDraftMentionDefinition.render({
        id: "<img src=x onerror=alert(1)>",
      }),
    );
    const mention = screen.getByLabelText("person mention Unknown person");
    expect(mention.textContent).toBe("@Unknown person");
    expect(mention.textContent).not.toContain("<img");
  });

  it("keeps the canonical atom model limited to required string ID metadata", () => {
    expect(firstDraftMentionDefinition.metadata).toEqual({
      id: { type: "string", required: true },
    });
  });
});
