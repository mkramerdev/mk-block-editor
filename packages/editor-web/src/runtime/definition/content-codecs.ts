import type {
  EditorHtmlExportHandler,
  EditorHtmlImportHandler,
} from "@repo/editor-dom/clipboard";
import type {
  EditorPlainTextExportHandler,
  EditorPlainTextImportHandler,
} from "../../clipboard/codec-contracts.ts";
import type {
  EditorContentCodecs,
  EditorInternalSelectionCutHandler,
  EditorInternalSelectionFragmentMaterializer,
} from "./contracts.ts";

export interface CompiledEditorContentCodecs {
  readonly htmlImportHandlers: readonly EditorHtmlImportHandler[];
  readonly htmlExportHandlers: readonly EditorHtmlExportHandler[];
  readonly plainTextImportHandlers: readonly EditorPlainTextImportHandler[];
  readonly plainTextExportHandlers: readonly EditorPlainTextExportHandler[];
  readonly internalSelectionFragmentMaterializers: readonly EditorInternalSelectionFragmentMaterializer[];
  readonly internalSelectionCutHandlers: readonly EditorInternalSelectionCutHandler[];
}

const allowedContentCodecFields = new Set([
  "htmlImportHandlers",
  "htmlExportHandlers",
  "plainTextImportHandlers",
  "plainTextExportHandlers",
  "internalSelectionFragmentMaterializers",
  "internalSelectionCutHandlers",
]);

export function compileEditorContentCodecs(
  codecs: EditorContentCodecs | undefined,
): CompiledEditorContentCodecs {
  if (codecs !== undefined && (!codecs || typeof codecs !== "object")) {
    throw new Error("EditorDefinition.contentCodecs must be an object.");
  }
  const unsupported = Object.keys(codecs ?? {}).filter(
    (field) => !allowedContentCodecFields.has(field),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `EditorDefinition.contentCodecs includes unsupported fields: ${unsupported.join(", ")}.`,
    );
  }
  const htmlImportHandlers = compileHandlerList(
    codecs?.htmlImportHandlers,
    "htmlImportHandlers",
  );
  const htmlExportHandlers = compileHandlerList(
    codecs?.htmlExportHandlers,
    "htmlExportHandlers",
  );
  const plainTextImportHandlers = compileHandlerList(
    codecs?.plainTextImportHandlers,
    "plainTextImportHandlers",
  );
  const plainTextExportHandlers = compileHandlerList(
    codecs?.plainTextExportHandlers,
    "plainTextExportHandlers",
  );
  const internalSelectionFragmentMaterializers = compileHandlerList(
    codecs?.internalSelectionFragmentMaterializers,
    "internalSelectionFragmentMaterializers",
  );
  const internalSelectionCutHandlers = compileHandlerList(
    codecs?.internalSelectionCutHandlers,
    "internalSelectionCutHandlers",
  );
  const ids = new Set<string>();
  for (const handler of [
    ...htmlImportHandlers,
    ...htmlExportHandlers,
    ...plainTextImportHandlers,
    ...plainTextExportHandlers,
    ...internalSelectionFragmentMaterializers,
    ...internalSelectionCutHandlers,
  ]) {
    if (ids.has(handler.id)) {
      throw new Error(
        `Editor content codec handler ${handler.id} is registered more than once.`,
      );
    }
    ids.add(handler.id);
  }
  return Object.freeze({
    htmlImportHandlers,
    htmlExportHandlers,
    plainTextImportHandlers,
    plainTextExportHandlers,
    internalSelectionFragmentMaterializers,
    internalSelectionCutHandlers,
  });
}

function compileHandlerList<T extends { readonly id: string }>(
  handlers: readonly T[] | undefined,
  field: string,
): readonly T[] {
  if (handlers !== undefined && !Array.isArray(handlers)) {
    throw new Error(`EditorContentCodecs.${field} must be an array.`);
  }
  const compiled: T[] = [];
  for (const handler of handlers ?? []) {
    if (
      !handler ||
      typeof handler !== "object" ||
      typeof handler.id !== "string" ||
      handler.id.trim().length === 0 ||
      handler.id.trim() !== handler.id
    ) {
      throw new Error(
        `EditorContentCodecs.${field} includes an invalid handler id.`,
      );
    }
    compiled.push(Object.freeze({ ...handler }));
  }
  return Object.freeze(compiled);
}
