import type { BlockId } from "../../../kernel/identity/ids.ts";
import type { JsonObject } from "../../../kernel/json/json-value.ts";
import { normalizeBlockMetadata } from "../../../metadata/block-metadata.ts";
import type { ReplaceBlockMetadataOperation } from "../types.ts";

export function replaceBlockMetadata(input: {
  readonly blockId: BlockId;
  readonly expectedMetadataVersion: string;
  readonly metadata: JsonObject | null;
}): ReplaceBlockMetadataOperation {
  const metadata = normalizeBlockMetadata(input.metadata ?? undefined);
  return {
    kind: "replaceBlockMetadata",
    blockId: input.blockId,
    expectedMetadataVersion: input.expectedMetadataVersion,
    metadata: metadata ?? null,
  };
}
