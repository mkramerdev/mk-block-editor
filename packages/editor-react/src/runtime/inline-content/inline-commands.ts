import type {
  InlineMarkDefinition,
  InlineMarkName,
} from "@repo/editor-core/content/marks";import type {
  InlineMarkCommandAction,
  InlineMarkCommandReason,
  InlineMarkCommandState,
} from "@repo/editor-core/content/marks";

export type EditorInlineMarkCommandAction = InlineMarkCommandAction;

export interface EditorInlineMarkCommandOptions {
  action?: EditorInlineMarkCommandAction;
  attrs?: Readonly<Record<string, unknown>> | null;
  focus?: boolean;
}

export type EditorInlineCommandAvailability = "available" | "unavailable" | "partial";

export type EditorInlineMarkCommandState = InlineMarkCommandState & {
  availability: EditorInlineCommandAvailability;
};

export type EditorInlineMarkCommandStateMap = Readonly<Partial<Record<InlineMarkName, EditorInlineMarkCommandState>>>;

export type EditorInlineCommandId = string;

export type EditorInlineCommandKind = InlineMarkDefinition["command"]["kind"];

export interface EditorInlineCommandDescriptor {
  id: EditorInlineCommandId;
  kind: EditorInlineCommandKind;
  markName: InlineMarkName;
  valueKind: InlineMarkDefinition["valueKind"];
}

export type EditorInlineCommandStateMap = Record<EditorInlineCommandId, EditorInlineMarkCommandState>;

export function createEditorInlineCommandDescriptors(
  inlineMarks: readonly InlineMarkDefinition[],
): readonly EditorInlineCommandDescriptor[] {
  return inlineMarks.map((definition) => ({
    id: definition.command.id,
    kind: definition.command.kind,
    markName: definition.name,
    valueKind: definition.valueKind,
  }));
}

export function getEditorInlineCommandDescriptor(
  inlineMarks: readonly InlineMarkDefinition[],
  commandId: string,
): EditorInlineCommandDescriptor | null {
  return createEditorInlineCommandDescriptors(inlineMarks).find((definition) => definition.id === commandId) ?? null;
}

export function unavailableInlineMarkCommandState(
  markName: InlineMarkName,
  commandId: string,
  reason: InlineMarkCommandReason,
  availability: EditorInlineCommandAvailability = "unavailable",
): EditorInlineMarkCommandState {
  return {
    markName,
    commandId,
    availability,
    canExecute: false,
    active: false,
    mixed: false,
    value: null,
    reason,
  };
}

export function unavailableInlineMarkCommandStateMap(
  inlineMarks: readonly InlineMarkDefinition[],
  reason: InlineMarkCommandReason,
  availability: EditorInlineCommandAvailability = "unavailable",
): EditorInlineMarkCommandStateMap {
  return Object.fromEntries(inlineMarks.map((definition) => [
    definition.name,
    unavailableInlineMarkCommandState(definition.name, definition.command.id, reason, availability),
  ]));
}
