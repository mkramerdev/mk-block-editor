import type { BlockType } from "@repo/editor-core/document";
import type { PMNode, Schema } from "../../prosemirror/index.ts";
import type { BlockLocalDocumentMappingOptions } from "./document-mapping.ts";
import {
  getBlockLocalTextNodeAttrs,
  getBlockLocalTextNodeName,
} from "./document-mapping.ts";
import { blockLocalProseMirrorSchema } from "./schema.ts";

export function createEmptyBlockLocalProseMirrorDocument(
  blockType: BlockType,
  schema = blockLocalProseMirrorSchema,
  options: BlockLocalDocumentMappingOptions = {},
): PMNode {
  const nodeName = getBlockLocalTextNodeName(blockType, options);
  const attrs = getBlockLocalTextNodeAttrs(blockType, options);
  const nodeType = schema.nodes[nodeName];
  if (!nodeType) {
    throw new Error(`missing block-local node type ${nodeName}`);
  }
  return schema.node("doc", null, [
    nodeType.createAndFill(attrs ?? null) ?? nodeType.create(attrs ?? null),
  ]);
}

export function createTextBlockLocalProseMirrorDocument(
  blockType: BlockType,
  text: string,
  schema: Schema = blockLocalProseMirrorSchema,
  options: BlockLocalDocumentMappingOptions = {},
): PMNode {
  const doc = createEmptyBlockLocalProseMirrorDocument(
    blockType,
    schema,
    options,
  );
  if (!text) return doc;
  const child = doc.firstChild;
  if (!child) return doc;
  return schema.node("doc", null, [
    child.type.create(child.attrs, schema.text(text), child.marks),
  ]);
}
