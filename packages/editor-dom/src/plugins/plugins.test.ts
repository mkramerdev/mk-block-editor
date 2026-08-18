import { describe, expect, it } from "vitest";
import { createBlockLocalDomPlugins } from "./aggregate/create-block-local-dom-plugins.ts";
import { Plugin, PluginKey } from "../prosemirror/index.ts";

describe("editor-dom plugins", () => {
  it("does not install optional private plugins by default", () => {
    const privatePluginKey = new PluginKey("privateTrigger");
    const basePlugins = createBlockLocalDomPlugins({
      blockId: "block-1" as never,
      blockType: "paragraph",
    });
    const privatePlugins = createBlockLocalDomPlugins({
      blockId: "block-1" as never,
      blockType: "paragraph",
      additionalPlugins: [new Plugin({ key: privatePluginKey })],
    });

    expect(hasPluginKey(basePlugins, privatePluginKey)).toBe(false);
    expect(hasPluginKey(privatePlugins, privatePluginKey)).toBe(true);
  });

  it("installs no pointer handlers for ordinary text blocks", () => {
    const plugins = createBlockLocalDomPlugins({
      blockId: "block-1" as never,
      blockType: "paragraph",
    });

    expect(
      plugins.some((plugin) =>
        ["pointerdown", "mousedown"].some(
          (event) =>
            typeof plugin.props.handleDOMEvents?.[event] === "function",
        ),
      ),
    ).toBe(false);
  });
});

function hasPluginKey(
  plugins: ReturnType<typeof createBlockLocalDomPlugins>,
  key: NonNullable<
    ReturnType<typeof createBlockLocalDomPlugins>[number]["spec"]["key"]
  >,
): boolean {
  return plugins.some((plugin) => plugin.spec.key === key);
}
