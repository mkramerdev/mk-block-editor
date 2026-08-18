import type { BlockId } from "@repo/editor-core/kernel";
import type {
	EDITOR_YJS_BLOCK_CONTENT_DOCUMENT_KIND,
	EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS,
} from "./constants.ts";

export type EditorYjsBlockContentDocumentKind =
	typeof EDITOR_YJS_BLOCK_CONTENT_DOCUMENT_KIND;

export type EditorYjsBlockContentMetadataKey =
	(typeof EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS)[keyof typeof EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS];

export interface BlockContentDocMetadata {
	readonly blockId: BlockId;
	readonly documentKind: EditorYjsBlockContentDocumentKind;
}

export type BlockContentDocMetadataValidation =
	| {
			readonly ok: true;
			readonly metadata: BlockContentDocMetadata;
	  }
	| {
			readonly ok: false;
			readonly reason:
				| "invalid-context-id"
				| "metadata-mismatch"
				| "invalid-document-kind";
			readonly message: string;
			readonly metadata: Partial<BlockContentDocMetadata>;
	  };
