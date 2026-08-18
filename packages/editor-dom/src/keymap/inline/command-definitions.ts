import type {
  InlineMarkDefinition,
  InlineMarkName,
} from "@repo/editor-core/content/marks";

export interface InlineMarkDomCommandDefinition {
  id: string;
  kind: Extract<
    InlineMarkDefinition["command"]["kind"],
    "toggle-mark" | "set-mark-value"
  >;
  markName: InlineMarkName;
  definition: InlineMarkDefinition;
}

export function createInlineMarkCommandDefinitions(
  inlineMarks: readonly InlineMarkDefinition[],
): readonly InlineMarkDomCommandDefinition[] {
  return inlineMarks.map((definition) => {
    return {
      id: definition.command.id,
      kind: definition.valueKind === "value" ? "set-mark-value" : "toggle-mark",
      markName: definition.name,
      definition,
    };
  });
}
