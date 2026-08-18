import { isStructuralKey } from "@repo/editor-core/kernel";
import type { BlockContentDocContext } from "../doc/contracts.ts";
import { EDITOR_YJS_BLOCK_CONTENT_DOCUMENT_KIND } from "./constants.ts";
import type {
	BlockContentDocMetadata,
	BlockContentDocMetadataValidation,
} from "./contracts.ts";
import { readBlockContentDocMetadata } from "./read.ts";

/**
 * Validates that a context still represents its canonical block-content Y.Doc.
 */
export function validateBlockContentDocContext(
	context: BlockContentDocContext,
): BlockContentDocMetadataValidation {
	const metadata = readBlockContentDocMetadata(context);
	if (!isStructuralKey(context.blockId)) {
		return invalidValidation(
			"invalid-context-id",
			"block content context blockId must be a non-empty structural key",
			metadata,
		);
	}
	if (metadata.blockId !== context.blockId) {
		return invalidValidation(
			"metadata-mismatch",
			"block content metadata blockId does not match the context",
			metadata,
		);
	}
	if (metadata.documentKind !== EDITOR_YJS_BLOCK_CONTENT_DOCUMENT_KIND) {
		return invalidValidation(
			"invalid-document-kind",
			"block content metadata documentKind must be block-content",
			metadata,
		);
	}
	return {
		ok: true,
		metadata: metadata as BlockContentDocMetadata,
	};
}

export function assertBlockContentDocContext(
	context: BlockContentDocContext,
): void {
	const validation = validateBlockContentDocContext(context);
	if (!validation.ok) throw new TypeError(validation.message);
}

function invalidValidation(
	reason: Extract<BlockContentDocMetadataValidation, { ok: false }>["reason"],
	message: string,
	metadata: Partial<BlockContentDocMetadata>,
): Extract<BlockContentDocMetadataValidation, { ok: false }> {
	return {
		ok: false,
		reason,
		message,
		metadata,
	};
}
