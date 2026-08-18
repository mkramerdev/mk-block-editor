import { createElement } from "react";
import { EditorDocument } from "@repo/editor-web/document-runtime";
import {
  compileReadEditorDefinition,
  initializeReadEditor,
  useReadEditor,
  type ReadEditorDefinition,
} from "@repo/editor-web/read-runtime";
import { ReadTextBlockPrimitive } from "@repo/editor-web/block-renderer";

export const fixtureReadDefinition: ReadEditorDefinition = {
  defaultRoot: "paragraph",
  blocks: {
    paragraph: {
      kind: "text",
      type: "paragraph",
      rootLayout: "normal",
      renderer: ({ block, editor }) =>
        createElement(ReadTextBlockPrimitive, { block, editor }),
    },
  },
  inlineMarks: [],
  inlineAtoms: [],
};

export function GenericReadRuntimeFixture({
  snapshot,
}: {
  readonly snapshot: import("@repo/editor-core/codecs").EditorInstanceSnapshot;
}) {
  const editor = useReadEditor({ definition: fixtureReadDefinition, snapshot });
  return createElement(EditorDocument, { editor });
}

export const readBundleSurface = {
  EditorDocument,
  ReadTextBlockPrimitive,
  fixtureReadDefinition,
  useReadEditor,
  initializeReadEditor,
};

export function initializeGenericReadEditor(
  snapshot: import("@repo/editor-core/codecs").EditorInstanceSnapshot,
) {
  return initializeReadEditor({
    compiledDefinition: compileReadEditorDefinition(fixtureReadDefinition),
    snapshot,
  });
}
