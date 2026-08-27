import { describe, expect, it } from "vitest";
import {
  EditorState,
  EditorView,
  Plugin,
  Schema,
  type DecorationSet,
  type NodeSpec,
} from "../../prosemirror/index.ts";
import {
  buildPlaceholderDecorations,
  createPlaceholderPlugin,
} from "./placeholder.ts";
import type { TextPlaceholder } from "../../block-editor/options/plugin-options.ts";

const activePlaceholder = {
  text: "Type something…",
  visibility: "active",
} satisfies TextPlaceholder;
const alwaysPlaceholder = {
  text: "Alternate text",
  visibility: "always",
} satisfies TextPlaceholder;

describe("placeholder decorations", () => {
  it.each([
    ["paragraph", activePlaceholder],
    ["alternateTextBlock", alwaysPlaceholder],
  ] as const)("decorates an empty active %s", (nodeName, placeholder) => {
    const decorations = buildPlaceholderDecorations(
      createTextState(nodeName, ""),
      placeholder,
    );

    expect(decorations.find()).toHaveLength(1);
    const view = renderDecorations(createTextState(nodeName, ""), decorations);
    try {
      expect(
        view.dom.firstElementChild?.getAttribute("data-editor-placeholder"),
      ).toBe(placeholder.text);
    } finally {
      view.destroy();
    }
  });

  it.each([
    ["paragraph", activePlaceholder],
    ["alternateTextBlock", alwaysPlaceholder],
  ] as const)(
    "does not decorate a non-empty active %s",
    (nodeName, placeholder) => {
      expect(
        buildPlaceholderDecorations(
          createTextState(nodeName, "Populated"),
          placeholder,
        ).find(),
      ).toHaveLength(0);
    },
  );

  it("does not infer placeholder behavior from the text node type name", () => {
    const decorations = buildPlaceholderDecorations(
      createTextState("product_title", ""),
      activePlaceholder,
    );

    expect(decorations.find()).toHaveLength(1);
  });

  it("does not install placeholder-specific focus or blur state", () => {
    const plugin = createPlaceholderPlugin(activePlaceholder);
    const documentState = createTextState("paragraph", "");
    const pluginState = EditorState.create({
      schema: documentState.schema,
      doc: documentState.doc,
      plugins: [plugin],
    });

    expect(plugin.props.handleDOMEvents?.focus).toBeUndefined();
    expect(plugin.props.handleDOMEvents?.blur).toBeUndefined();
    expect(Object.keys(plugin.getState(pluginState)!)).toEqual(["decorations"]);
  });

  it("omits decorations for missing or empty placeholder text", () => {
    const state = createTextState("paragraph", "");

    expect(buildPlaceholderDecorations(state).find()).toHaveLength(0);
    expect(
      buildPlaceholderDecorations(state, {
        text: "",
        visibility: "active",
      }).find(),
    ).toHaveLength(0);
  });
});

function createTextState(nodeName: string, text: string): EditorState {
  const textBlock: NodeSpec = {
    content: "inline*",
    group: "block",
    toDOM: () => ["div", 0],
  };
  const schema = new Schema({
    nodes: {
      doc: { content: nodeName },
      [nodeName]: textBlock,
      text: { group: "inline" },
    },
  });
  const content = text ? [schema.text(text)] : undefined;
  return EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node(nodeName, null, content)]),
  });
}

function renderDecorations(
  state: EditorState,
  decorations: DecorationSet,
): EditorView {
  const plugin = new Plugin({
    props: {
      decorations: () => decorations,
    },
  });
  return new EditorView(null, {
    state: EditorState.create({
      schema: state.schema,
      doc: state.doc,
      plugins: [plugin],
    }),
  });
}
