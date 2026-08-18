import type {
  CanonicalSelectionNavigationResult,
  CanonicalMergeTargetResult,
  CanonicalNavigationInput,
} from "../boundary/canonical-navigation.ts";
import {
  findCanonicalSelectionTarget,
  findCanonicalMergeTarget,
} from "../boundary/canonical-navigation.ts";

export type PreviousMergeTargetResult = CanonicalMergeTargetResult;
export type {
  CanonicalSelectionNavigationResult,
  CanonicalNavigationInput,
};

export function findPreviousMergeTarget(
  input: CanonicalNavigationInput,
): PreviousMergeTargetResult {
  return findCanonicalMergeTarget(input, "previous");
}

export function findPreviousCanonicalSelectionTarget(
  input: CanonicalNavigationInput,
): CanonicalSelectionNavigationResult {
  return findCanonicalSelectionTarget(input, "previous");
}
