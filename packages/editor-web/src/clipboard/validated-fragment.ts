import type { BlockType } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  assertValidCanonicalBlockFragment,
  type CanonicalBlockFragment,
  type CanonicalBlockFragmentCandidate,
} from "@repo/editor-core/editing";

const validatedClipboardFragment: unique symbol = Symbol(
  "validated-clipboard-fragment",
);

/** Package-internal proof scoped to one synchronous clipboard operation. */
export interface ValidatedClipboardFragment {
  readonly [validatedClipboardFragment]: CanonicalBlockFragment;
}

export function validateClipboardFragment(
  fragment: CanonicalBlockFragment,
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
): ValidatedClipboardFragment {
  assertValidCanonicalBlockFragment(fragment, { blockDefinitions });
  return validatedCapability(fragment);
}

export function validateClipboardFragmentCandidate(
  candidate: CanonicalBlockFragmentCandidate,
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
): ValidatedClipboardFragment {
  const fragment: CanonicalBlockFragment = {
    blocks: candidate.blocks,
    rootBlockIds: candidate.rootBlockIds,
    start: candidate.start,
    end: candidate.end,
  };
  assertValidCanonicalBlockFragment(fragment, { blockDefinitions });
  return validatedCapability(fragment);
}

export function readValidatedClipboardFragment(
  validated: ValidatedClipboardFragment,
): CanonicalBlockFragment {
  return validated[validatedClipboardFragment];
}

function validatedCapability(
  fragment: CanonicalBlockFragment,
): ValidatedClipboardFragment {
  return Object.freeze({ [validatedClipboardFragment]: fragment });
}
