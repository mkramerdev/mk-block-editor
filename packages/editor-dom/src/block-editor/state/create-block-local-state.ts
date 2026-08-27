import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  EditorState,
  TextSelection,
  type PMNode,
  type Plugin,
  type Schema,
} from "../../prosemirror/index.ts";
import { canonicalOffsetToProseMirrorDocumentPosition } from "../../caret/coordinates/offset-codec.ts";
import { blockLocalProseMirrorSchema } from "../../schema/block-local/schema.ts";
import { parseBlockLocalProseMirrorDocument } from "../../schema/block-local/document-parsing.ts";
import { createBlockLocalDomPlugins } from "../../plugins/aggregate/create-block-local-dom-plugins.ts";
import type { BlockLocalDomPluginOptions } from "../options/plugin-options.ts";

export interface CreateBlockLocalProseMirrorStateOptions {
  blockId: BlockId;
  blockType: BlockType;
  doc?: PMNode | string | Record<string, unknown> | null;
  schema?: Schema;
  pluginOptions?: Partial<BlockLocalDomPluginOptions>;
  plugins?: readonly Plugin[];
  /** Canonical block-local caret installed in the first immutable state. */
  selection?: { readonly canonicalOffset: number };
}

export function createBlockLocalProseMirrorState(
  options: CreateBlockLocalProseMirrorStateOptions,
): EditorState {
  const schema = options.schema ?? blockLocalProseMirrorSchema;
  const doc = isProseMirrorNode(options.doc)
    ? options.doc
    : parseBlockLocalProseMirrorDocument(
        options.doc ?? null,
        options.blockType,
        schema,
      );
  const pluginOptions: BlockLocalDomPluginOptions = {
    blockId: options.blockId,
    blockType: options.blockType,
    ...options.pluginOptions,
  };
  const plugins = options.plugins
    ? [...options.plugins]
    : createBlockLocalDomPlugins(pluginOptions);
  const selection = options.selection
    ? TextSelection.create(
        doc,
        canonicalOffsetToProseMirrorDocumentPosition(
          options.selection.canonicalOffset,
          doc,
        ),
      )
    : undefined;
  return EditorState.create({ schema, doc, plugins, selection });
}

function isProseMirrorNode(
  input: CreateBlockLocalProseMirrorStateOptions["doc"],
): input is PMNode {
  return Boolean(
    input && typeof input === "object" && "toJSON" in input && "copy" in input,
  );
}
