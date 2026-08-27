export const FIRST_DRAFT_CALLOUT_ICONS = Object.freeze([
  { id: "idea", label: "Idea", glyph: "💡" },
  { id: "note", label: "Note", glyph: "📝" },
  { id: "warning", label: "Warning", glyph: "⚠" },
  { id: "task", label: "Task", glyph: "☑" },
] as const);

export type FirstDraftCalloutIcon =
  (typeof FIRST_DRAFT_CALLOUT_ICONS)[number];

/** Keeps documents written with the old, undersized info glyph readable. */
export function resolveFirstDraftCalloutIcon(
  value: unknown,
): FirstDraftCalloutIcon {
  const normalized = value === "info" ? "note" : value;
  return (
    FIRST_DRAFT_CALLOUT_ICONS.find((icon) => icon.id === normalized) ??
    FIRST_DRAFT_CALLOUT_ICONS[0]
  );
}
