import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
});

describe("First Draft definition import order", () => {
  it("initializes the table renderers before the assembled definition", async () => {
    const renderers = await import("./blocks/table/renderers.tsx");
    const definition = await import("./first-draft-definition.tsx");

    expect(
      readTableRenderer(definition.firstDraftBlockDefinitions, "table"),
    ).toBe(renderers.TableRenderer);
    expect(
      readTableRenderer(definition.firstDraftBlockDefinitions, "tableRow"),
    ).toBe(renderers.TableRowRenderer);
    expect(
      readTableRenderer(definition.firstDraftBlockDefinitions, "tableCell"),
    ).toBe(renderers.TableCellRenderer);
  });

  it("initializes the assembled definition before reading its table renderers", async () => {
    const definition = await import("./first-draft-definition.tsx");
    const renderers = await import("./blocks/table/renderers.tsx");

    expect(
      readTableRenderer(definition.firstDraftBlockDefinitions, "table"),
    ).toBe(renderers.TableRenderer);
    expect(
      readTableRenderer(definition.firstDraftBlockDefinitions, "tableRow"),
    ).toBe(renderers.TableRowRenderer);
    expect(
      readTableRenderer(definition.firstDraftBlockDefinitions, "tableCell"),
    ).toBe(renderers.TableCellRenderer);
  });
});

type FirstDraftBlockDefinitions =
  (typeof import("./first-draft-definition.tsx"))["firstDraftBlockDefinitions"];

function readTableRenderer(
  definitions: FirstDraftBlockDefinitions,
  type: "table" | "tableRow" | "tableCell",
) {
  const definition = definitions[type];
  if (!definition) throw new Error(`missing ${type} definition`);
  return definition.renderer;
}
