import type { BlockType } from "@repo/editor-core/document";
import type { PMNode, Schema } from "../../prosemirror/index.ts";
import { blockLocalProseMirrorSchema } from "./schema.ts";

export function createEmptyBlockLocalProseMirrorDocument(
  _blockType: BlockType,
  schema = blockLocalProseMirrorSchema,
): PMNode {
  const nodeName = "paragraph";
  const nodeType = schema.nodes[nodeName];
  if (!nodeType) {
    throw new Error(`missing block-local node type ${nodeName}`);
  }
  return schema.node("doc", null, [
    nodeType.createAndFill() ?? nodeType.create(),
  ]);
}

export function createTextBlockLocalProseMirrorDocument(
  blockType: BlockType,
  text: string,
  schema: Schema = blockLocalProseMirrorSchema,
): PMNode {
  const doc = createEmptyBlockLocalProseMirrorDocument(blockType, schema);
  if (!text) return doc;
  const child = doc.firstChild;
  if (!child) return doc;
  return schema.node("doc", null, [
    child.type.create(child.attrs, schema.text(text), child.marks),
  ]);
}
