import type { Map as YMap } from "yjs";
import { EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS } from "./constants.ts";
import type {
  BlockContentDocMetadata,
  EditorYjsBlockContentMetadataKey,
} from "./contracts.ts";

export function writeCanonicalBlockContentMetadata(
  metadata: YMap<unknown>,
  value: BlockContentDocMetadata,
): void {
  writeMetadataValue(
    metadata,
    EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS.blockId,
    value.blockId,
  );
  writeMetadataValue(
    metadata,
    EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS.documentKind,
    value.documentKind,
  );
}

function writeMetadataValue(
  metadata: YMap<unknown>,
  key: EditorYjsBlockContentMetadataKey,
  value: string,
): void {
  const existing = metadata.get(key);
  if (existing !== undefined && existing !== value) {
    throw new TypeError(
      `block content metadata ${key} does not match the context`,
    );
  }
  metadata.set(key, value);
}
