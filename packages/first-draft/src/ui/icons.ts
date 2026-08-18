export interface FirstDraftIconElement {
  readonly tag: "circle" | "path";
  readonly attrs: Readonly<Record<string, string | number>>;
}

export interface FirstDraftIconData {
  readonly viewBox: string;
  readonly elements: readonly FirstDraftIconElement[];
}

export const gripVerticalIcon: FirstDraftIconData = {
  viewBox: "0 0 24 24",
  elements: [
    { tag: "circle", attrs: { cx: 9, cy: 5, r: 1 } },
    { tag: "circle", attrs: { cx: 9, cy: 12, r: 1 } },
    { tag: "circle", attrs: { cx: 9, cy: 19, r: 1 } },
    { tag: "circle", attrs: { cx: 15, cy: 5, r: 1 } },
    { tag: "circle", attrs: { cx: 15, cy: 12, r: 1 } },
    { tag: "circle", attrs: { cx: 15, cy: 19, r: 1 } },
  ],
};

export const plusIcon: FirstDraftIconData = {
  viewBox: "0 0 24 24",
  elements: [{ tag: "path", attrs: { d: "M5 12h14M12 5v14" } }],
};

export const linkIcon: FirstDraftIconData = {
  viewBox: "0 0 24 24",
  elements: [
    {
      tag: "path",
      attrs: {
        d: "M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.14-1.14",
      },
    },
  ],
};
