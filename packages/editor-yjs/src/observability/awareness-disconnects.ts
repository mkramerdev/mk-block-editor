import type {
	EditorYjsAwarenessChangeEvent,
	EditorYjsAwarenessObservable,
	EditorYjsObservabilityHooks,
} from "./contracts.ts";

export function observeEditorYjsAwarenessDisconnects(
	awareness: EditorYjsAwarenessObservable,
	observability?: EditorYjsObservabilityHooks,
): () => void {
	const handleChange = (event: EditorYjsAwarenessChangeEvent): void => {
		const removed = event.removed ?? [];
		if (removed.length === 0) return;

		observability?.onMetric?.({
			name: "editor_yjs_awareness_disconnects_total",
			value: removed.length,
		});
		observability?.onLog?.({
			level: "warn",
			message: "editor-yjs awareness clients disconnected",
			context: { count: removed.length },
		});
	};

	awareness.on("change", handleChange);
	return () => {
		awareness.off("change", handleChange);
	};
}
