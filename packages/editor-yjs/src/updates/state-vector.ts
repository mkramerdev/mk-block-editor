import { encodeStateVector } from "yjs";
import type { BlockContentDocContext } from "../block-content/doc/contracts.ts";
import { assertBlockContentDocContext } from "../block-content/metadata/validate.ts";

export function encodeBlockContentStateVector(
  context: BlockContentDocContext,
): Uint8Array {
  assertBlockContentDocContext(context);
  return encodeStateVector(context.doc);
}
