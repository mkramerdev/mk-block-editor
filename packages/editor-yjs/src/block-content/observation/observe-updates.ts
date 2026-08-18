import type { EditorYjsObservabilityHooks } from "../../observability/contracts.ts";
import type { BlockContentDocContext } from "../doc/contracts.ts";
import { assertBlockContentDocContext } from "../metadata/validate.ts";
import type { BlockContentUpdateEvent } from "./contracts.ts";

/**
 * Observes raw Yjs updates for one validated block content document.
 */
export function observeBlockContentUpdates(
	context: BlockContentDocContext,
	onUpdate: (event: BlockContentUpdateEvent) => void,
	observability?: EditorYjsObservabilityHooks,
): () => void {
	assertBlockContentDocContext(context);
	const listener = (update: Uint8Array, origin: unknown): void => {
		assertBlockContentDocContext(context);
		observability?.onMetric?.({
			name: "editor_yjs_block_content_update_bytes",
			value: update.byteLength,
			tags: {
				blockId: context.blockId,
			},
		});
		onUpdate({
			blockId: context.blockId,
			update,
			origin,
		});
	};
	context.doc.on("update", listener);
	return () => context.doc.off("update", listener);
}
