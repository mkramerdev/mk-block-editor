import { describe, expect, it } from "vitest";
import type {
	EditorYjsAwarenessChangeEvent,
	EditorYjsAwarenessObservable,
} from "./contracts.ts";
import { observeEditorYjsAwarenessDisconnects } from "./awareness-disconnects.ts";

describe("awareness disconnect observability", () => {
	it("reports awareness disconnects through neutral observability hooks", () => {
		const awareness = createTestAwarenessObservable();
		const metrics: Array<{ name: string; value?: number }> = [];
		const logs: Array<{
			level: string;
			message: string;
			context?: unknown;
		}> = [];

		const dispose = observeEditorYjsAwarenessDisconnects(awareness, {
			onMetric(event) {
				metrics.push({ name: event.name, value: event.value });
			},
			onLog(event) {
				logs.push(event);
			},
		});

		expect(awareness.listenerCount()).toBe(1);
		awareness.emit({ added: [1], updated: [], removed: [] });
		expect(metrics).toEqual([]);

		awareness.emit({ added: [], updated: [], removed: [7, 9] });
		expect(metrics).toEqual([
			{ name: "editor_yjs_awareness_disconnects_total", value: 2 },
		]);
		expect(logs).toEqual([
			{
				level: "warn",
				message: "editor-yjs awareness clients disconnected",
				context: { count: 2 },
			},
		]);

		dispose();
		expect(awareness.listenerCount()).toBe(0);
		awareness.emit({ added: [], updated: [], removed: [11] });
		expect(metrics).toHaveLength(1);
	});

	it("does not require observability hooks and unregisters cleanly", () => {
		const awareness = createTestAwarenessObservable();
		const dispose = observeEditorYjsAwarenessDisconnects(awareness);

		expect(awareness.listenerCount()).toBe(1);
		awareness.emit({ added: [], updated: [], removed: [1] });
		dispose();
		expect(awareness.listenerCount()).toBe(0);
		awareness.emit({ added: [], updated: [], removed: [2] });
		expect(awareness.listenerCount()).toBe(0);
	});
});

function createTestAwarenessObservable(): EditorYjsAwarenessObservable & {
	emit(event: EditorYjsAwarenessChangeEvent): void;
	listenerCount(): number;
} {
	const listeners: Array<(event: EditorYjsAwarenessChangeEvent) => void> = [];
	return {
		on(_eventName, listener) {
			listeners.push(listener);
		},
		off(_eventName, listener) {
			const index = listeners.indexOf(listener);
			if (index >= 0) listeners.splice(index, 1);
		},
		emit(event) {
			for (const listener of [...listeners]) listener(event);
		},
		listenerCount() {
			return listeners.length;
		},
	};
}
