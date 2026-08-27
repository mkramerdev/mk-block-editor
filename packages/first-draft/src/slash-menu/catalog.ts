import {
  FIRST_DRAFT_HEADING_LEVELS,
  type FirstDraftHeadingLevel,
} from "../heading-level.ts";

export type FirstDraftSlashActionCategory =
  | "Text"
  | "Lists"
  | "Toggles"
  | "Layout";

export type FirstDraftSlashActionKind =
  | { readonly type: "paragraph" }
  | { readonly type: "heading"; readonly level: FirstDraftHeadingLevel }
  | { readonly type: "bulletList" }
  | { readonly type: "orderedList" }
  | { readonly type: "checklist" }
  | { readonly type: "quote" }
  | { readonly type: "code" }
  | { readonly type: "callout" }
  | { readonly type: "toggleHeading"; readonly level: FirstDraftHeadingLevel }
  | { readonly type: "toggleListItem" }
  | { readonly type: "divider" }
  | { readonly type: "columns"; readonly count: 2 | 3 | 4 }
  | { readonly type: "tabs" }
  | { readonly type: "table" };

export interface FirstDraftSlashAction {
  readonly id: string;
  readonly label: string;
  readonly category: FirstDraftSlashActionCategory;
  readonly keywords: readonly string[];
  readonly kind: FirstDraftSlashActionKind;
  readonly searchableText: string;
}

function action(
  id: string,
  label: string,
  category: FirstDraftSlashActionCategory,
  keywords: readonly string[],
  kind: FirstDraftSlashActionKind,
): FirstDraftSlashAction {
  return Object.freeze({
    id,
    label,
    category,
    keywords: Object.freeze([...keywords]),
    kind,
    searchableText: [id, label, category, ...keywords].join(" ").toLowerCase(),
  });
}

const headings = FIRST_DRAFT_HEADING_LEVELS.map((level) => {
  return action(
    `heading-${level}`,
    `Heading ${level}`,
    "Text",
    ["heading", "title", `h${level}`],
    { type: "heading", level },
  );
});

const toggleHeadings = FIRST_DRAFT_HEADING_LEVELS.map((level) => {
  return action(
    `toggle-heading-${level}`,
    `Toggle Heading ${level}`,
    "Toggles",
    ["toggle", "heading", "collapse", "details", `h${level}`],
    { type: "toggleHeading", level },
  );
});

export const firstDraftSlashActionCatalog: readonly FirstDraftSlashAction[] =
  Object.freeze([
    action(
      "paragraph",
      "Text / Paragraph",
      "Text",
      ["text", "paragraph", "body"],
      {
        type: "paragraph",
      },
    ),
    ...headings,
    action(
      "bullet-list",
      "Bullet List",
      "Lists",
      ["bullet", "unordered", "list", "ul"],
      {
        type: "bulletList",
      },
    ),
    action(
      "numbered-list",
      "Numbered List",
      "Lists",
      ["numbered", "ordered", "list", "ol"],
      {
        type: "orderedList",
      },
    ),
    action(
      "checklist",
      "Checklist",
      "Lists",
      ["checklist", "todo", "task", "checkbox"],
      {
        type: "checklist",
      },
    ),
    action("quote", "Quote", "Text", ["quote", "blockquote"], {
      type: "quote",
    }),
    action("code", "Code", "Text", ["code", "preformatted", "snippet"], {
      type: "code",
    }),
    action("callout", "Callout", "Text", ["callout", "note", "info"], {
      type: "callout",
    }),
    ...toggleHeadings,
    action(
      "toggle-list",
      "Toggle List",
      "Toggles",
      ["toggle", "list", "collapse", "details"],
      {
        type: "toggleListItem",
      },
    ),
    action(
      "divider",
      "Divider",
      "Text",
      ["divider", "separator", "line", "hr"],
      { type: "divider" },
    ),
    action(
      "columns-2",
      "2 Columns",
      "Layout",
      ["columns", "column", "layout", "grid", "two"],
      {
        type: "columns",
        count: 2,
      },
    ),
    action(
      "columns-3",
      "3 Columns",
      "Layout",
      ["columns", "column", "layout", "grid", "three"],
      {
        type: "columns",
        count: 3,
      },
    ),
    action(
      "columns-4",
      "4 Columns",
      "Layout",
      ["columns", "column", "layout", "grid", "four"],
      {
        type: "columns",
        count: 4,
      },
    ),
    action("tabs", "Tabs", "Layout", ["tabs", "tab", "panes"], {
      type: "tabs",
    }),
    action("table", "Table", "Layout", ["table", "grid", "rows", "columns"], {
      type: "table",
    }),
  ]);

export function filterFirstDraftSlashActions(
  query: string,
  catalog: readonly FirstDraftSlashAction[] = firstDraftSlashActionCatalog,
): readonly FirstDraftSlashAction[] {
  const normalized = query.trim().toLowerCase();
  const words = normalized.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return catalog;
  return catalog
    .flatMap((candidate, index) => {
      if (!words.every((word) => candidate.searchableText.includes(word))) {
        return [];
      }
      const id = candidate.id.toLowerCase();
      const label = candidate.label.toLowerCase();
      const score =
        id === normalized || label === normalized
          ? 0
          : id.startsWith(normalized) || label.startsWith(normalized)
            ? 1
            : words.every(
                  (word) => id.startsWith(word) || label.startsWith(word),
                )
              ? 2
              : 3;
      return [{ candidate, index, score }];
    })
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ candidate }) => candidate);
}
