import type { BlockDefinition } from "../../definitions/block-definition.ts";
import {
  contentSelection,
  wholeSelection,
} from "../../selection/block-selection.ts";

export type BlockCreationSelectionTargetKind = "text" | "block";

/**
 * Resolves whether a block definition can be the explicit focus target of a
 * canonical creation. Text and atomic definitions retain their model defaults;
 * wrappers participate only when they declare an explicit selectable model.
 */
export function blockCreationSelectionTargetKind(
  definition: BlockDefinition,
): BlockCreationSelectionTargetKind | null {
  const model =
    definition.selection ??
    (definition.kind === "text"
      ? contentSelection()
      : definition.kind === "atomic"
        ? wholeSelection()
        : null);
  if (!model?.projection.selectable) return null;
  if (
    definition.kind === "text" &&
    model.projection.endpoint.kind === "content"
  ) {
    return "text";
  }
  if (
    definition.kind !== "text" &&
    model.projection.endpoint.kind === "block"
  ) {
    return "block";
  }
  return null;
}
