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
  allowBlockTypes?: readonly BlockType[];
  denyBlockTypes?: readonly BlockType[];
  requireText?: boolean;
}

export interface InlineMarkDefinition<
  Name extends InlineMarkName = InlineMarkName,
> {
  name: Name;
  valueKind: "boolean" | "value";
  attrs: Readonly<Record<string, InlineAttributeContract>>;
  defaultAttrs: Readonly<Record<string, InlineAttributePrimitive>>;
  contexts: readonly InlineTextContext[];
  blockPolicy: InlineMarkBlockPolicy;
  inclusive: boolean;
  excludes?: string;
  code?: boolean;
  command: InlineCommandMetadata;
}
