import {
  ArrowDownFromLine,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  ArrowUpFromLine,
  Copy,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type {
  FirstDraftTableAction,
  FirstDraftTableActionId,
} from "./catalog.ts";

interface TableActionIconResolution {
  readonly name: string;
  readonly Icon: LucideIcon;
}

export function FirstDraftTableActionIcon({
  action,
}: {
  readonly action: FirstDraftTableAction;
}) {
  const { name, Icon } = resolveTableActionIcon(action.id);
  return (
    <span
      className="first-draft-table-action-menu__icon"
      data-first-draft-table-action-icon={name}
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

function resolveTableActionIcon(
  actionId: FirstDraftTableActionId,
): TableActionIconResolution {
  switch (actionId) {
    case "delete-row":
    case "delete-column":
      return { name: "Trash2", Icon: Trash2 };
    case "insert-row-above":
      return { name: "ArrowUpFromLine", Icon: ArrowUpFromLine };
    case "insert-row-below":
      return { name: "ArrowDownFromLine", Icon: ArrowDownFromLine };
    case "duplicate-row":
    case "duplicate-column":
      return { name: "Copy", Icon: Copy };
    case "insert-column-left":
      return { name: "ArrowLeftFromLine", Icon: ArrowLeftFromLine };
    case "insert-column-right":
      return { name: "ArrowRightFromLine", Icon: ArrowRightFromLine };
    default:
      return assertNever(actionId);
  }
}

function assertNever(value: never): never {
  throw new Error(`Missing First Draft table-action icon: ${String(value)}`);
}
