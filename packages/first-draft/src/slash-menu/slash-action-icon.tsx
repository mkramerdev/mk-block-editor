import {
  CodeXml,
  Columns2,
  Columns3,
  Columns4,
  Folder,
  Heading1,
  Heading2,
  Heading3,
  Lightbulb,
  List,
  ListCollapse,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Table,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { FirstDraftHeadingLevel } from "../heading-level.ts";
import type {
  FirstDraftSlashAction,
  FirstDraftSlashActionKind,
} from "./catalog.ts";

interface SlashActionIconResolution {
  readonly name: string;
  readonly Icon: LucideIcon;
}

export function FirstDraftSlashActionIcon({
  action,
}: {
  readonly action: FirstDraftSlashAction;
}) {
  const { name, Icon } = resolveSlashActionIcon(action.kind);
  return (
    <span
      className="first-draft-slash-menu__icon"
      data-first-draft-slash-action-icon={name}
      aria-hidden="true"
    >
      <Icon
        aria-hidden="true"
        focusable="false"
        size={16}
        strokeWidth={1.75}
      />
    </span>
  );
}

function resolveSlashActionIcon(
  kind: FirstDraftSlashActionKind,
): SlashActionIconResolution {
  switch (kind.type) {
    case "paragraph":
      return { name: "Type", Icon: Type };
    case "heading":
      return resolveHeadingIcon(kind.level);
    case "bulletList":
      return { name: "List", Icon: List };
    case "orderedList":
      return { name: "ListOrdered", Icon: ListOrdered };
    case "checklist":
      return { name: "ListTodo", Icon: ListTodo };
    case "quote":
      return { name: "Quote", Icon: Quote };
    case "code":
      return { name: "CodeXml", Icon: CodeXml };
    case "callout":
      return { name: "Lightbulb", Icon: Lightbulb };
    case "toggleHeading":
      return resolveHeadingIcon(kind.level);
    case "toggleListItem":
      return { name: "ListCollapse", Icon: ListCollapse };
    case "divider":
      return { name: "Minus", Icon: Minus };
    case "columns":
      return resolveColumnsIcon(kind.count);
    case "tabs":
      return { name: "Folder", Icon: Folder };
    case "table":
      return { name: "Table", Icon: Table };
    default:
      return assertNever(kind);
  }
}

function resolveHeadingIcon(
  level: FirstDraftHeadingLevel,
): SlashActionIconResolution {
  switch (level) {
    case 1:
      return { name: "Heading1", Icon: Heading1 };
    case 2:
      return { name: "Heading2", Icon: Heading2 };
    case 3:
      return { name: "Heading3", Icon: Heading3 };
    default:
      return assertNever(level);
  }
}

function resolveColumnsIcon(
  count: 2 | 3 | 4,
): SlashActionIconResolution {
  switch (count) {
    case 2:
      return { name: "Columns2", Icon: Columns2 };
    case 3:
      return { name: "Columns3", Icon: Columns3 };
    case 4:
      return { name: "Columns4", Icon: Columns4 };
    default:
      return assertNever(count);
  }
}

function assertNever(value: never): never {
  throw new Error(`Missing First Draft slash-action icon: ${String(value)}`);
}
