import { sanitizeInlineMarkAttrs } from "./schema.ts";
import type { InlineMarkDefinition, InlineMarkName } from "./types.ts";

export type InlineMarkCommandAction = "toggle" | "add" | "remove";

export type ResolvedInlineMarkCommandAction = "add" | "remove";

export type InlineMarkCommandReason =
  | "missing-mark"
  | "unsupported-context"
  | "empty-range"
  | "invalid-attrs";

export interface InlineMarkCommandState {
  markName: InlineMarkDefinition["name"];
  commandId: string;
  canExecute: boolean;
  active: boolean;
  mixed: boolean;
  value: Record<string, unknown> | null;
  reason?: InlineMarkCommandReason;
}

export type InlineMarkCommandRangeSegmentKind =
  | "text"
  | "hard-break"
  | "inline-atom";

export interface InlineMarkCommandRangeSegment {
  from: number;
  to: number;
  kind: InlineMarkCommandRangeSegmentKind;
  text?: string;
  markAttrs?: Readonly<Record<string, unknown>> | null;
}

export interface InlineMarkCommandRange {
  from: number;
  to: number;
}

export interface InlineMarkCommandPlan {
  state: InlineMarkCommandState;
  action: ResolvedInlineMarkCommandAction;
  attrs: Record<string, unknown>;
  ranges: readonly InlineMarkCommandRange[];
}

export function planInlineMarkCommand(input: {
  definition: InlineMarkDefinition;
  segments: readonly InlineMarkCommandRangeSegment[];
  action?: InlineMarkCommandAction;
  attrs?: Readonly<Record<string, unknown>> | null;
}): InlineMarkCommandPlan | null {
  const state = createInlineMarkCommandStateFromRange(
    input.definition,
    input.segments,
  );
  if (!state.canExecute) return null;
  const action = resolveInlineMarkCommandAction(state, input.action);
  const attrs = resolveInlineMarkCommandAttrs(
    input.definition,
    action,
    input.attrs,
  );
  if (!attrs) return null;
  return {
    state,
    action,
    attrs,
    ranges: markableInlineMarkCommandRanges(input.segments),
  };
}

export function createInlineMarkCommandStateFromRange(
  definition: InlineMarkDefinition,
  segments: readonly InlineMarkCommandRangeSegment[],
): InlineMarkCommandState {
  const markableSegments = segments.filter(
    isInlineMarkCommandRangeSegmentMarkable,
  );
  if (markableSegments.length === 0)
    return inactiveInlineMarkCommandState(definition, "empty-range");

  let hasMarkedContent = false;
  let hasUnmarkedContent = false;
  const values: Record<string, unknown>[] = [];
  for (const segment of markableSegments) {
    if (segment.markAttrs) {
      hasMarkedContent = true;
      values.push({ ...segment.markAttrs });
    } else {
      hasUnmarkedContent = true;
    }
  }

  return createInlineMarkCommandStateFromParts(definition, {
    hasMarkedContent,
    hasUnmarkedContent,
    values,
  });
}

export function combineInlineMarkCommandStates(
  definition: InlineMarkDefinition,
  states: readonly InlineMarkCommandState[],
): InlineMarkCommandState {
  const executableStates = states.filter((state) => state.canExecute);
  if (executableStates.length === 0)
    return inactiveInlineMarkCommandState(definition, "empty-range");

  let hasMarkedContent = false;
  let hasUnmarkedContent = false;
  const values: Record<string, unknown>[] = [];
  for (const state of executableStates) {
    if (state.active && !state.mixed) {
      hasMarkedContent = true;
      values.push(state.value ?? {});
      continue;
    }
    if (state.mixed) {
      hasMarkedContent = true;
      hasUnmarkedContent = true;
      continue;
    }
    hasUnmarkedContent = true;
  }

  return createInlineMarkCommandStateFromParts(definition, {
    hasMarkedContent,
    hasUnmarkedContent,
    values,
  });
}

export function createInlineMarkCursorCommandState(
  definition: InlineMarkDefinition,
  activeValue: Record<string, unknown> | null,
): InlineMarkCommandState {
  return {
    markName: definition.name,
    commandId: definition.command.id,
    canExecute: true,
    active: activeValue !== null,
    mixed: false,
    value: activeValue,
  };
}

export function inactiveInlineMarkCommandState(
  definition: InlineMarkDefinition,
  reason: InlineMarkCommandReason,
): InlineMarkCommandState {
  return {
    markName: definition.name,
    commandId: definition.command.id,
    canExecute: false,
    active: false,
    mixed: false,
    value: null,
    reason,
  };
}

export function missingInlineMarkCommandState(
  markName: InlineMarkName,
): InlineMarkCommandState {
  return {
    markName,
    commandId: `inline.mark.${markName}.missing`,
    canExecute: false,
    active: false,
    mixed: false,
    value: null,
    reason: "missing-mark",
  };
}

export function resolveInlineMarkCommandAction(
  state: Pick<InlineMarkCommandState, "active" | "mixed">,
  action: InlineMarkCommandAction | undefined,
): ResolvedInlineMarkCommandAction {
  if (action === "add" || action === "remove") return action;
  return state.active && !state.mixed ? "remove" : "add";
}

export function resolveInlineMarkCommandAttrs(
  definition: InlineMarkDefinition,
  action: ResolvedInlineMarkCommandAction,
  attrs: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, unknown> | null {
  if (action === "remove") return {};
  if (definition.valueKind === "value" || attrs !== undefined) {
    return sanitizeInlineMarkAttrs(
      definition,
      attrs ?? definition.defaultAttrs,
    );
  }
  return {};
}

export function validateInlineMarkCommandAttrs(
  definition: InlineMarkDefinition,
  attrs: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  return (
    attrs === undefined || sanitizeInlineMarkAttrs(definition, attrs) !== null
  );
}

export function isInlineMarkCommandRangeSegmentMarkable(
  segment: InlineMarkCommandRangeSegment,
): boolean {
  return (
    segment.kind === "text" &&
    segment.to > segment.from &&
    typeof segment.text === "string" &&
    /\S/.test(segment.text)
  );
}

export function inlineMarkValuesEqual(
  left: Readonly<Record<string, unknown>> | null,
  right: Readonly<Record<string, unknown>> | null,
): boolean {
  if (left === null || right === null) return left === right;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) => key === rightKeys[index] && left[key] === right[key],
  );
}

export function distinctInlineMarkValues(
  values: readonly Record<string, unknown>[],
): Array<Record<string, unknown>> {
  const distinct: Array<Record<string, unknown>> = [];
  for (const value of values) {
    if (!distinct.some((candidate) => inlineMarkValuesEqual(candidate, value)))
      distinct.push({ ...value });
  }
  return distinct;
}

function createInlineMarkCommandStateFromParts(
  definition: InlineMarkDefinition,
  parts: {
    hasMarkedContent: boolean;
    hasUnmarkedContent: boolean;
    values: readonly Record<string, unknown>[];
  },
): InlineMarkCommandState {
  const distinctValues = distinctInlineMarkValues(parts.values);
  const active =
    parts.hasMarkedContent &&
    !parts.hasUnmarkedContent &&
    distinctValues.length <= 1;
  return {
    markName: definition.name,
    commandId: definition.command.id,
    canExecute: true,
    active,
    mixed:
      (parts.hasMarkedContent && parts.hasUnmarkedContent) ||
      distinctValues.length > 1,
    value: active ? (distinctValues[0] ?? {}) : null,
  };
}

function markableInlineMarkCommandRanges(
  segments: readonly InlineMarkCommandRangeSegment[],
): InlineMarkCommandRange[] {
  const ranges: InlineMarkCommandRange[] = [];
  for (const segment of segments) {
    if (!isInlineMarkCommandRangeSegmentMarkable(segment)) continue;
    const previous = ranges[ranges.length - 1];
    if (previous && previous.to === segment.from) {
      previous.to = segment.to;
      continue;
    }
    ranges.push({ from: segment.from, to: segment.to });
  }
  return ranges;
}
