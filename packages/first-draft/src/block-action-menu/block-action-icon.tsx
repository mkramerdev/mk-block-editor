import {
  ArrowDownFromLine,
  ArrowUpFromLine,
  Copy,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { FirstDraftBlockAction } from "./catalog.ts";

interface BlockActionIconResolution {
  readonly name: string;
  readonly Icon: LucideIcon;
}

export function FirstDraftBlockActionIcon({
  action,
}: {
  readonly action: FirstDraftBlockAction;
}) {
  const { name, Icon } = resolveBlockActionIcon(action.id);
  return (
    <span
      className="first-draft-block-action-menu__icon"
      data-first-draft-block-action-icon={name}
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

function resolveBlockActionIcon(
  actionId: FirstDraftBlockAction["id"],
): BlockActionIconResolution {
  switch (actionId) {
    case "delete-block":
      return { name: "Trash2", Icon: Trash2 };
    case "insert-before":
      return { name: "ArrowUpFromLine", Icon: ArrowUpFromLine };
    case "insert-after":
      return { name: "ArrowDownFromLine", Icon: ArrowDownFromLine };
    case "duplicate-block":
      return { name: "Copy", Icon: Copy };
    default:
      return assertNever(actionId);
  }
}

function assertNever(value: never): never {
  throw new Error(`Missing First Draft block-action icon: ${String(value)}`);
}
