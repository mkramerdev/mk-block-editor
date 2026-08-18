import {
  createTextHtmlImportHandler,
  parseHtmlCanonicalFragment,
} from "@repo/editor-dom/clipboard";
import type { Schema } from "@repo/editor-dom/prosemirror";
import type { EditorClipboardBoundaryOptions } from "./boundary.ts";
import { createEditorClipboardBoundary } from "./boundary.ts";
import type { CompiledCanonicalEditorDefinition } from "../runtime/definition/compiled-editor-definition.ts";
import type { EditorDefinition } from "../runtime/definition/contracts.ts";

export function createDefinitionClipboardBoundary(options: {
  readonly compiledDefinition: CompiledCanonicalEditorDefinition;
  readonly schema?: Schema;
  readonly materializeSelection: EditorClipboardBoundaryOptions["materializeSelection"];
}) {
  const definition = options.compiledDefinition.definition;
  const codecs = options.compiledDefinition.contentCodecs;
  const importPolicy = definition.contentImport;
  if (!importPolicy) return null;
  return createEditorClipboardBoundary({
    blockDefinitions: definition.blocks,
    plainTextImportBlockType: importPolicy.plainTextBlockType,
    inlineMarks: definition.inlineMarks,
    inlineAtoms: definition.inlineAtoms,
    parseHtml: options.schema
      ? (html, plainText, handlers, limits) =>
          parseHtmlCanonicalFragment(html, plainText, {
            schema: options.schema!,
            blockDefinitions: definition.blocks,
            plainTextBlockType: importPolicy.plainTextBlockType,
            htmlImportHandlers: handlers,
            htmlExportHandlers: codecs.htmlExportHandlers,
            inlineAtoms: definition.inlineAtoms,
            limits,
          })
      : undefined,
    htmlImportHandlers: [
      ...defaultHtmlImportHandlers(definition),
      ...codecs.htmlImportHandlers,
    ],
    htmlExportHandlers: codecs.htmlExportHandlers,
    plainTextImportHandlers: codecs.plainTextImportHandlers,
    plainTextExportHandlers: codecs.plainTextExportHandlers,
    materializeSelection: options.materializeSelection,
  });
}

function defaultHtmlImportHandlers(definition: EditorDefinition) {
  const handlers = [];
  if (definition.blocks.paragraph?.kind === "text") {
    handlers.push(
      createTextHtmlImportHandler({
        id: "core.semantic-paragraph",
        blockType: "paragraph",
        tags: ["p"],
      }),
    );
  }
  if (definition.blocks.heading?.kind === "text") {
    handlers.push(
      createTextHtmlImportHandler({
        id: "core.semantic-heading",
        blockType: "heading",
        tags: ["h1", "h2", "h3", "h4", "h5", "h6"],
        metadata: (node) => ({
          level: Number(node.tagName.slice(1).toLowerCase()),
        }),
      }),
    );
  }
  return handlers;
}
