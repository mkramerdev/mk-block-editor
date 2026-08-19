import type { InlineMarkDefinition } from "@repo/editor-core/content/marks";
import {
  Schema,
  type MarkSpec,
  type NodeSpec,
} from "../../prosemirror/index.ts";
import { createInlineAtomNodeSpecs } from "../inline/atom-node-specs.ts";
import { createInlineMarkSpecs } from "../inline/mark-specs.ts";
import { defaultBlockLocalNodeSpecs } from "./node-specs.ts";

export interface CreateBlockLocalProseMirrorSchemaOptions {
  nodes?: Readonly<Record<string, NodeSpec>>;
  marks?: Readonly<Record<string, MarkSpec>>;
  inlineMarks?: readonly InlineMarkDefinition[];
  inlineAtoms?: readonly { readonly type: string }[];
}

export function createBlockLocalProseMirrorSchema(
  options: CreateBlockLocalProseMirrorSchemaOptions = {},
): Schema {
  return new Schema({
    nodes: {
      ...defaultBlockLocalNodeSpecs,
      ...createInlineAtomNodeSpecs(options.inlineAtoms ?? []),
      ...options.nodes,
    },
    marks: {
      ...createInlineMarkSpecs(options.inlineMarks),
      ...options.marks,
    },
  });
}

export const blockLocalProseMirrorSchema = createBlockLocalProseMirrorSchema();
