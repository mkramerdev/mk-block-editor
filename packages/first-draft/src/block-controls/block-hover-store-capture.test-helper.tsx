import type { FirstDraftBlockHoverStore } from "./block-hover-store.ts";
import { useFirstDraftBlockHoverStore } from "./block-hover-provider.tsx";

export function FirstDraftBlockHoverStoreCapture({
  capture,
}: {
  readonly capture: (store: FirstDraftBlockHoverStore) => void;
}) {
  capture(useFirstDraftBlockHoverStore());
  return null;
}
