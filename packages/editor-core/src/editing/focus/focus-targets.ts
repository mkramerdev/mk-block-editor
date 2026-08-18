/**
 * Defines which blocks can receive text focus after generic editing reducers run.
 * Inputs are caller-provided definitions; returns neutral focus eligibility only. It does not inspect
 * editor selection, host focus, or rendering state.
 */
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { BlockType } from "../../document/model/block.ts";

export function isEditableFocusTarget(
  blockType: BlockType,
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
): boolean {
  const definition = blockDefinitions[blockType];
  if (!definition) return false;
  return definition.kind === "text" || definition.kind === "atomic";
}
