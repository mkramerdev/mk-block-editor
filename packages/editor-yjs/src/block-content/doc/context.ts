import { Doc } from "yjs";
import {
  EDITOR_YJS_BLOCK_CONTENT_DOCUMENT_KIND,
  EDITOR_YJS_BLOCK_CONTENT_FRAGMENT_NAME,
  EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS,
  EDITOR_YJS_BLOCK_CONTENT_METADATA_MAP_NAME,
} from "../metadata/constants.ts";
import type { EditorYjsBlockContentMetadataKey } from "../metadata/contracts.ts";
import { readBlockContentDocumentKind } from "../metadata/read.ts";
import { validateBlockContentDocContext } from "../metadata/validate.ts";
import { writeCanonicalBlockContentMetadata } from "../metadata/write.ts";
import type {
  BlockContentDocContext,
  CreateBlockContentDocContextOptions,
} from "./contracts.ts";

/**
 * Creates or wraps one Y.Doc for one editable block content document.
 */
export function createBlockContentDocContext(
  options: CreateBlockContentDocContextOptions,
): BlockContentDocContext {
  const providedDoc = options.doc;
  const doc = providedDoc ?? new Doc();
  const fragment = doc.getXmlFragment(EDITOR_YJS_BLOCK_CONTENT_FRAGMENT_NAME);
  const metadata = doc.getMap<unknown>(
    EDITOR_YJS_BLOCK_CONTENT_METADATA_MAP_NAME,
  );
  const destroyDocOnDestroy =
    options.destroyDocOnDestroy ?? providedDoc === undefined;
  // A hydrated document already carries canonical metadata. Rewriting the
  // same values would still create new CRDT structs on this client's clock,
  // causing the next incremental content update to depend on unshared
  // metadata operations. Only seed metadata for a genuinely empty document;
  // existing metadata is validated below without mutation.
  if (
    metadata.get(EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS.blockId) ===
      undefined &&
    metadata.get(EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS.documentKind) ===
      undefined
  ) {
    writeCanonicalBlockContentMetadata(metadata, {
      blockId: options.blockId,
      documentKind: EDITOR_YJS_BLOCK_CONTENT_DOCUMENT_KIND,
    });
  }

  const context: BlockContentDocContext = {
    doc,
    fragment,
    metadata,
    blockId: options.blockId,
    documentKind: EDITOR_YJS_BLOCK_CONTENT_DOCUMENT_KIND,
    destroyDocOnDestroy,
    getFragment: () => fragment,
    getMetadataMap: () => metadata,
    getMetadata: <T = unknown>(key: EditorYjsBlockContentMetadataKey) =>
      metadata.get(key) as T | undefined,
    getDocumentKind: () => readBlockContentDocumentKind(metadata),
    validateMetadata: () => validateBlockContentDocContext(context),
    destroy: () => {
      if (destroyDocOnDestroy) {
        doc.destroy();
      }
    },
  };

  const validation = validateBlockContentDocContext(context);
  if (!validation.ok) throw new TypeError(validation.message);

  return context;
}
