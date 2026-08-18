import type { BlockId } from "@repo/editor-core/kernel";
import type { Map as YMap } from "yjs";
import type { BlockContentDocContext } from "../doc/contracts.ts";
import {
	EDITOR_YJS_BLOCK_CONTENT_DOCUMENT_KIND,
	EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS,
} from "./constants.ts";
import type {
	BlockContentDocMetadata,
	EditorYjsBlockContentDocumentKind,
} from "./contracts.ts";

export function readBlockContentDocumentKind(
	metadata: YMap<unknown>,
): EditorYjsBlockContentDocumentKind | null {
	const value = metadata.get(EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS.documentKind);
	return value === EDITOR_YJS_BLOCK_CONTENT_DOCUMENT_KIND
		? EDITOR_YJS_BLOCK_CONTENT_DOCUMENT_KIND
		: null;
}

export function readBlockContentDocMetadata(
	context: BlockContentDocContext,
): Partial<BlockContentDocMetadata> {
	const metadata = context.metadata;
	return {
		blockId: metadata.get(
			EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS.blockId,
		) as BlockId | undefined,
		documentKind: readBlockContentDocumentKind(metadata) ?? undefined,
	};
}
