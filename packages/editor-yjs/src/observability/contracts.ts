export interface EditorYjsMetricEvent {
  name: string;
  value?: number;
  tags?: Record<string, string | number | boolean>;
}

export interface EditorYjsLogEvent {
  level: "info" | "warn" | "error";
  message: string;
  context?: unknown;
}

export interface EditorYjsObservabilityHooks {
  onMetric?(event: EditorYjsMetricEvent): void;
  onLog?(event: EditorYjsLogEvent): void;
}

export interface EditorYjsAwarenessChangeEvent {
  added?: readonly number[];
  updated?: readonly number[];
  removed?: readonly number[];
}

export interface EditorYjsAwarenessObservable {
  on(
    eventName: "change",
    listener: (
      event: EditorYjsAwarenessChangeEvent,
      ...args: readonly unknown[]
    ) => void,
  ): void;
  off(
    eventName: "change",
    listener: (
      event: EditorYjsAwarenessChangeEvent,
      ...args: readonly unknown[]
    ) => void,
  ): void;
}
