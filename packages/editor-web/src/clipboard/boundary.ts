import type { BlockType } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  assertValidCanonicalBlockFragment,
  type CanonicalBlockFragment,
} from "@repo/editor-core/editing";
import type { EditorSelectionSnapshot } from "@repo/editor-react/selection";
import { serializeCanonicalFragmentHtml } from "./canonical-html-export.ts";
import {
  exportCanonicalFragmentPlainText,
  importCanonicalFragmentPlainText,
} from "./canonical-plain-text.ts";
import type {
  EditorClipboardImportLimits,
  EditorHtmlExportHandler,
  EditorHtmlImportHandler,
  EditorPlainTextExportHandler,
  EditorPlainTextImportHandler,
} from "./codec-contracts.ts";
import { resolveEditorClipboardImportLimits, utf8ByteLength } from "./limits.ts";
import {
  parseCanonicalBlockFragmentWirePayload,
  serializeCanonicalBlockFragmentWirePayload,
} from "./wire-codec.ts";

export interface EditorClipboardBoundaryOptions {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly plainTextImportBlockType: BlockType;
  readonly materializeSelection: (
    selection: EditorSelectionSnapshot,
  ) =>
    | CanonicalBlockFragment
    | null
    | { readonly ok: true; readonly fragment: CanonicalBlockFragment }
    | { readonly ok: false };
  readonly inlineMarks?: Parameters<typeof serializeCanonicalFragmentHtml>[1]["inlineMarks"];
  readonly inlineAtoms?: Parameters<typeof serializeCanonicalFragmentHtml>[1]["inlineAtoms"];
  readonly parseHtml?: (
    html: string,
    plainText: string,
    handlers: readonly EditorHtmlImportHandler[],
    limits: EditorClipboardImportLimits,
  ) => CanonicalBlockFragment | null;
  readonly htmlImportHandlers?: readonly EditorHtmlImportHandler[];
  readonly htmlExportHandlers?: readonly EditorHtmlExportHandler[];
  readonly plainTextImportHandlers?: readonly EditorPlainTextImportHandler[];
  readonly plainTextExportHandlers?: readonly EditorPlainTextExportHandler[];
  readonly limits?: Partial<EditorClipboardImportLimits>;
}

export interface EditorClipboardBoundary {
  writeSelection(
    clipboardData: DataTransfer,
    selection: EditorSelectionSnapshot,
  ): boolean;
  readClipboardBlocks(
    clipboardData: DataTransfer,
  ): CanonicalBlockFragment | null;
}

export function createEditorClipboardBoundary(
  options: EditorClipboardBoundaryOptions,
): EditorClipboardBoundary {
  const limits = resolveEditorClipboardImportLimits(options.limits);
  const plainTextDefinition =
    options.blockDefinitions[options.plainTextImportBlockType];
  if (!plainTextDefinition || plainTextDefinition.kind !== "text") {
    throw new Error(
      `Plain-text import type ${options.plainTextImportBlockType} must be a defined text block.`,
    );
  }
  const htmlImportHandlers = orderedUniqueHandlers(options.htmlImportHandlers ?? []);
  const htmlExportHandlers = orderedUniqueHandlers(
    options.htmlExportHandlers ?? [],
  );
  const plainTextImportHandlers = orderedUniqueHandlers(
    options.plainTextImportHandlers ?? [],
  );
  const plainTextExportHandlers = orderedUniqueHandlers(
    options.plainTextExportHandlers ?? [],
  );
  const plainTextOptions = {
    blockDefinitions: options.blockDefinitions,
    defaultTextBlockType: options.plainTextImportBlockType,
    importHandlers: plainTextImportHandlers,
    exportHandlers: plainTextExportHandlers,
    limits,
  };
  const wireOptions = {
    blockDefinitions: options.blockDefinitions,
    limits,
  };
  const decodeRepresentations = (
    html: string,
    plainText: string,
  ): CanonicalBlockFragment | null => {
    if (html) {
      if (options.parseHtml) {
        try {
          const fragment = options.parseHtml(
            html,
            plainText,
            htmlImportHandlers,
            limits,
          );
          if (fragment) return fragment;
        } catch {
          // Reject this untrusted candidate and continue to plain text.
        }
      }
    }
    return readPlainTextFragment(plainText, plainTextOptions);
  };

  return Object.freeze({
    writeSelection(
      clipboardData: DataTransfer,
      selection: EditorSelectionSnapshot,
    ) {
      let fragment: CanonicalBlockFragment | null;
      try {
        fragment = readMaterializedFragment(
          options.materializeSelection(selection),
        );
      } catch {
        return false;
      }
      if (!fragment) return false;
      try {
        assertValidCanonicalBlockFragment(fragment, {
          blockDefinitions: options.blockDefinitions,
        });
      } catch {
        return false;
      }

      // Every representation is derived before the required first write.
      let plainText: string;
      try {
        plainText = exportCanonicalFragmentPlainText(
          fragment,
          plainTextOptions,
        );
        if (utf8ByteLength(plainText) > limits.maxPlainTextBytes) return false;
      } catch {
        return false;
      }
      let canonicalPayload: string | null = null;
      try {
        canonicalPayload = serializeCanonicalBlockFragmentWirePayload(
          fragment,
          wireOptions,
        );
      } catch {
        canonicalPayload = null;
      }
      let html: string | null = null;
      try {
        const semanticHtml = serializeCanonicalFragmentHtml(fragment, {
          blockDefinitions: options.blockDefinitions,
          inlineMarks: options.inlineMarks ?? [],
          inlineAtoms: options.inlineAtoms ?? [],
          htmlExportHandlers,
        });
        const candidate =
          semanticHtml !== null && canonicalPayload !== null
            ? embedCanonicalFragmentPayload(semanticHtml, canonicalPayload)
            : semanticHtml;
        html =
          candidate !== null && utf8ByteLength(candidate) <= limits.maxHtmlBytes
            ? candidate
            : null;
      } catch {
        html = null;
      }

      try {
        clipboardData.setData("text/plain", plainText);
      } catch {
        return false;
      }
      if (html !== null) {
        try {
          clipboardData.setData("text/html", html);
        } catch {
          // Plain text is the required successful representation.
        }
      }
      return true;
    },

    readClipboardBlocks(clipboardData: DataTransfer) {
      const html = readData(clipboardData, "text/html");
      const canonicalPayload = html
        ? readCanonicalFragmentPayload(html)
        : null;
      if (canonicalPayload) {
        const fragment = parseCanonicalBlockFragmentWirePayload(
          canonicalPayload,
          wireOptions,
        );
        if (fragment) return fragment;
      }
      return decodeRepresentations(
        html,
        readData(clipboardData, "text/plain"),
      );
    },

  });
}

const CANONICAL_HTML_ATTRIBUTE = "data-editor-canonical-fragment";

function embedCanonicalFragmentPayload(html: string, payload: string): string {
  return `<div ${CANONICAL_HTML_ATTRIBUTE}="${encodeURIComponent(payload)}">${html}</div>`;
}

function readCanonicalFragmentPayload(html: string): string | null {
  const match = new RegExp(
    `${CANONICAL_HTML_ATTRIBUTE}\\s*=\\s*["']([^"']+)["']`,
    "iu",
  ).exec(html);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function readPlainTextFragment(
  text: string,
  options: Parameters<typeof importCanonicalFragmentPlainText>[1],
): CanonicalBlockFragment | null {
  if (!text) return null;
  try {
    return importCanonicalFragmentPlainText(text, options);
  } catch {
    return null;
  }
}

function readMaterializedFragment(
  result: ReturnType<EditorClipboardBoundaryOptions["materializeSelection"]>,
): CanonicalBlockFragment | null {
  if (!result) return null;
  if ("blocks" in result) return result;
  return result.ok ? result.fragment : null;
}

function readData(clipboardData: DataTransfer, format: string): string {
  try {
    return clipboardData.getData(format);
  } catch {
    return "";
  }
}

function orderedUniqueHandlers<T extends { readonly id: string }>(
  handlers: readonly T[],
): readonly T[] {
  const ids = new Set<string>();
  for (const handler of handlers) {
    if (!handler || typeof handler.id !== "string" || handler.id.length === 0) {
      throw new Error("Content codec handlers require a non-empty id.");
    }
    if (ids.has(handler.id)) {
      throw new Error(
        `Content codec handler ${handler.id} is registered twice.`,
      );
    }
    ids.add(handler.id);
  }
  return Object.freeze([...handlers]);
}
