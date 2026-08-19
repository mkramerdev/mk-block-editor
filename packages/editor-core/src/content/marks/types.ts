import type { BlockType } from "../../document/model/block.ts";
import type {
  InlineAttributeContract,
  InlineAttributePrimitive,
  InlineCommandMetadata,
  InlineTextContext,
} from "../rich-text/inline-attributes.ts";

export type InlineMarkName =
  | "strong"
  | "em"
  | "code"
  | "link"
  | "underline"
  | "strikethrough";

export interface InlineMarkBlockPolicy {
  readonly allowBlockTypes?: readonly BlockType[];
  readonly denyBlockTypes?: readonly BlockType[];
  readonly requireText?: boolean;
}

export interface InlineMarkDefinition<
  Name extends InlineMarkName = InlineMarkName,
> {
  readonly name: Name;
  readonly valueKind: "boolean" | "value";
  readonly attrs: Readonly<Record<string, InlineAttributeContract>>;
  readonly defaultAttrs: Readonly<Record<string, InlineAttributePrimitive>>;
  readonly contexts: readonly InlineTextContext[];
  readonly blockPolicy: InlineMarkBlockPolicy;
  readonly inclusive: boolean;
  readonly excludes?: string;
  readonly code?: boolean;
  readonly command: InlineCommandMetadata;
}
