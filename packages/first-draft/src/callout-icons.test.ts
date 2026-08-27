import { describe, expect, it } from "vitest";
import {
  FIRST_DRAFT_CALLOUT_ICONS,
  resolveFirstDraftCalloutIcon,
} from "./callout-icons.ts";

describe("First Draft callout icons", () => {
  it("uses the consistently sized note icon in the picker catalog", () => {
    expect(FIRST_DRAFT_CALLOUT_ICONS).toEqual([
      { id: "idea", label: "Idea", glyph: "💡" },
      { id: "note", label: "Note", glyph: "📝" },
      { id: "warning", label: "Warning", glyph: "⚠" },
      { id: "task", label: "Task", glyph: "☑" },
    ]);
  });

  it("projects legacy info metadata to the replacement note icon", () => {
    expect(resolveFirstDraftCalloutIcon("info")).toEqual({
      id: "note",
      label: "Note",
      glyph: "📝",
    });
  });
});
