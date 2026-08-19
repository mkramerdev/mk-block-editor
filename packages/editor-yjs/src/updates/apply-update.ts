import { applyUpdate } from "yjs";
import type { BlockContentDocContext } from "../block-content/doc/contracts.ts";
import { assertBlockContentDocContext } from "../block-content/metadata/validate.ts";
import { EDITOR_YJS_ORIGINS } from "../origins/origins.ts";

/** Applies bytes to a context selected by an already-validated block envelope. */
export function applyBlockContentUpdate(
  context: BlockContentDocContext,
  update: Uint8Array,
  origin: unknown = EDITOR_YJS_ORIGINS.REMOTE_UPDATE,
): void {
  assertBlockContentDocContext(context);
  applyUpdate(context.doc, update, origin);
  assertBlockContentDocContext(context);
}
