import { encodeStateAsUpdate } from "yjs";
import type { BlockContentDocContext } from "../block-content/doc/contracts.ts";
import { assertBlockContentDocContext } from "../block-content/metadata/validate.ts";

export function encodeBlockContentUpdate(
  context: BlockContentDocContext,
): Uint8Array {
  assertBlockContentDocContext(context);
  return encodeStateAsUpdate(context.doc);
}
