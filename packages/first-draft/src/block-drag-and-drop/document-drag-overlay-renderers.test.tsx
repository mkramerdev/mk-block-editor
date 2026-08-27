import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import { asBlockId, type JsonObject } from "@repo/editor-core/kernel";
import { firstDraftBlockDefinitions } from "../first-draft-definition.tsx";
import type {
  FirstDraftBlockDragPresentationState,
  FirstDraftBlockDragPreviewNode,
  FirstDraftBlockType,
} from "./document-drag-overlay-contracts.ts";
import { FirstDraftDocumentBlockDragPreview } from "./document-drag-overlay.tsx";
import {
  firstDraftDocumentBlockDragPreviewTypes,
  renderFirstDraftDocumentBlockDragPreviewNode,
} from "./document-drag-overlay-renderers.tsx";

const textTypes = new Set<FirstDraftBlockType>(["paragraph", "heading", "tableCell"]);
let firstDraftStyles: HTMLStyleElement;

beforeAll(() => {
  firstDraftStyles = document.createElement("style");
  firstDraftStyles.textContent = readFileSync(
    join(process.cwd(), "src/first-draft.css"),
    "utf8",
  );
  document.head.append(firstDraftStyles);
});

afterAll(() => {
  firstDraftStyles.remove();
});

function richText(value: string): RichTextDocumentNodeJson {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: value ? [{ type: "text", text: value }] : [] }],
  };
}

function node(
  type: FirstDraftBlockType,
  value: string,
  options: {
    readonly children?: readonly FirstDraftBlockDragPreviewNode[];
    readonly metadata?: JsonObject;
    readonly presentation?: Partial<FirstDraftBlockDragPresentationState>;
    readonly text?: string;
  } = {},
): FirstDraftBlockDragPreviewNode {
  return Object.freeze({
    block: Object.freeze({
      id: asBlockId(value),
      type,
      parentId: null,
      tombstone: null,
      metadata: options.metadata,
      metadataVersion: `metadata:${value}`,
      contentVersion: null,
    }),
    content: textTypes.has(type) ? richText(options.text ?? value) : null,
    children: Object.freeze([...(options.children ?? [])]),
    presentation: Object.freeze({
      headingLevel: type === "heading" ? 1 : null,
      checked: type === "checklistItem" ? false : null,
      orderedListOrdinal: type === "orderedListItem" ? 1 : null,
      collapsed:
        type === "toggleHeading" || type === "toggleListItem" ? false : null,
      selectedTabPaneId: null,
      columns: null,
      table: null,
      ...options.presentation,
    }),
  });
}

function minimal(type: FirstDraftBlockType): FirstDraftBlockDragPreviewNode {
  const paragraph = (suffix: string) => node("paragraph", `paragraph-${suffix}`, { text: `text-${suffix}` });
  switch (type) {
    case "paragraph":
    case "heading":
    case "tableCell":
    case "divider":
      return node(type, `matrix-${type}`);
    case "bulletList":
      return node(type, "matrix-bullet-list", { children: [minimal("bulletListItem")] });
    case "orderedList":
      return node(type, "matrix-ordered-list", { children: [minimal("orderedListItem")] });
    case "checklist":
      return node(type, "matrix-checklist", { children: [minimal("checklistItem")] });
    case "bulletListItem":
    case "orderedListItem":
    case "checklistItem":
      return node(type, `matrix-${type}`, { children: [paragraph(type)] });
    case "quote":
    case "code":
    case "callout":
    case "column":
    case "tabPane":
    case "toggleHeadingBody":
    case "toggleListItemBody":
      return node(type, `matrix-${type}`, { children: [paragraph(type)] });
    case "toggleHeading":
      return node(type, "matrix-toggle-heading", {
        children: [node("heading", "matrix-toggle-heading-summary"), minimal("toggleHeadingBody")],
      });
    case "toggleListItem":
      return node(type, "matrix-toggle-list", {
        children: [paragraph("toggle-list-summary"), minimal("toggleListItemBody")],
      });
    case "columns":
      return node(type, "matrix-columns", {
        children: [minimal("column"), node("column", "matrix-column-two", { children: [paragraph("column-two")] })],
        presentation: {
          columns: {
            tracks: "minmax(0, 2fr) minmax(0, 1fr)",
            orderedColumnIds: [asBlockId("matrix-column"), asBlockId("matrix-column-two")],
            weights: [2, 1],
          },
        },
      });
    case "tabs": {
      const first = node("tabPane", "matrix-pane-one", { metadata: { title: "One" }, children: [paragraph("pane-one")] });
      const second = node("tabPane", "matrix-pane-two", { metadata: { title: "Two" }, children: [paragraph("pane-two")] });
      return node(type, "matrix-tabs", {
        children: [first, second],
        presentation: { selectedTabPaneId: second.block.id },
      });
    }
    case "tableRow":
      return node(type, "matrix-row", { children: [node("tableCell", "matrix-cell")] });
    case "table":
      return node(type, "matrix-table", {
        children: [minimal("tableRow")],
        presentation: {
          table: {
            columnIds: ["column"],
            columnWidths: { column: 200 },
            tracks: "200px",
            rowCount: 1,
            columnCount: 1,
          },
        },
      });
  }
}

function expectTransparentBackground(element: Element): void {
  expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(
    getComputedStyle(element).backgroundColor,
  );
}

describe("FirstDraftDocumentBlockDragPreview", () => {
  it("keeps the registry exhaustive with the live First Draft block catalog", () => {
    expect([...firstDraftDocumentBlockDragPreviewTypes].sort()).toEqual(
      Object.keys(firstDraftBlockDefinitions).sort(),
    );
  });

  it.each(firstDraftDocumentBlockDragPreviewTypes)(
    "mounts an inert visual adapter for %s",
    (type) => {
      const rendered = render(
        <FirstDraftDocumentBlockDragPreview snapshot={minimal(type)} />,
      );
      const root = rendered.container.firstElementChild;
      expect(root?.classList.contains("first-draft-document-block-drag-overlay")).toBe(true);
      expect(root?.getAttribute("aria-hidden")).toBe("true");
      expect(root?.hasAttribute("inert")).toBe(true);
      expect(root?.querySelector(`[data-first-draft-preview-block-type="${type}"]`)).not.toBeNull();
      expect(root?.querySelector('[data-editor-block-shell="true"]')).toBeNull();
      expect(root?.querySelector("[data-editor-block-id]")).toBeNull();
      expect(root?.querySelector("[data-editor-text-root]")).toBeNull();
      expect(root?.querySelector("[contenteditable]")).toBeNull();
      expect(root?.querySelector(".first-draft-block-drop-target")).toBeNull();
      expect(root?.querySelector("[data-editor-ui]")).toBeNull();
      expect(root?.querySelector("button, input, select, textarea")).toBeNull();
    },
  );

  it.each([
    "paragraph",
    "heading",
    "bulletList",
    "quote",
    "code",
    "callout",
    "toggleHeading",
    "columns",
    "tabs",
    "table",
    "divider",
  ] as const)("keeps shared overlay infrastructure transparent for %s", (type) => {
    const rendered = render(
      <div className="first-draft-example">
        <FirstDraftDocumentBlockDragPreview snapshot={minimal(type)} />
      </div>,
    );
    const root = rendered.container.querySelector<HTMLElement>(
      ".first-draft-document-block-drag-overlay",
    )!;

    expectTransparentBackground(root);
    for (const wrapper of root.querySelectorAll<HTMLElement>(
      '[class*="first-draft-document-block-drag-overlay__"]',
    )) {
      expectTransparentBackground(wrapper);
    }
  });

  it("keeps backgroundless presentations transparent and surfaced presentations block-owned", () => {
    const backgroundlessTypes = [
      ["paragraph", ".paragraph-block__paragraph"],
      ["heading", ".heading-block__heading"],
      ["bulletList", ".first-draft-document-block-drag-overlay__list"],
      ["quote", ".quote-block__quote"],
      ["toggleHeading", ".toggle-heading-block__toggle"],
      ["columns", ".columns-block__grid"],
      ["tabs", ".tabs-block__tabs"],
      ["divider", ".divider-block__rule"],
    ] as const;

    for (const [type, selector] of backgroundlessTypes) {
      const rendered = render(
        <div className="first-draft-example">
          <FirstDraftDocumentBlockDragPreview snapshot={minimal(type)} />
        </div>,
      );
      expectTransparentBackground(
        rendered.container.querySelector<HTMLElement>(selector)!,
      );
      rendered.unmount();
    }

    for (const [type, selector] of [
      ["callout", ".callout-block__callout"],
      ["code", ".code-block__presentation"],
    ] as const) {
      const rendered = render(
        <div className="first-draft-example">
          <FirstDraftDocumentBlockDragPreview snapshot={minimal(type)} />
        </div>,
      );
      const presentation = rendered.container.querySelector<HTMLElement>(selector)!;
      expect(getComputedStyle(presentation).background).toBe(
        "var(--color-foreground)",
      );
      rendered.unmount();
    }
  });

  it("draws complete visible state for toggles, tabs, columns, tables, and ordered items", () => {
    const collapsed = minimal("toggleHeading");
    const collapsedSnapshot = node("toggleHeading", "collapsed", {
      children: collapsed.children,
      presentation: { collapsed: true },
    });
    const collapsedRender = render(<FirstDraftDocumentBlockDragPreview snapshot={collapsedSnapshot} />);
    expect(collapsedRender.container.textContent).toContain("matrix-toggle-heading-summary");
    expect(collapsedRender.container.textContent).not.toContain("text-toggleHeadingBody");

    const expandedRender = render(<FirstDraftDocumentBlockDragPreview snapshot={collapsed} />);
    expect(expandedRender.container.textContent).toContain("text-toggleHeadingBody");

    const tabsRender = render(<FirstDraftDocumentBlockDragPreview snapshot={minimal("tabs")} />);
    expect(tabsRender.container.textContent).toContain("One");
    expect(tabsRender.container.textContent).toContain("Two");
    expect(tabsRender.container.textContent).toContain("text-pane-two");
    expect(tabsRender.container.textContent).not.toContain("text-pane-one");

    const columnsRender = render(<FirstDraftDocumentBlockDragPreview snapshot={minimal("columns")} />);
    const grid = columnsRender.container.querySelector<HTMLElement>(".columns-block__grid");
    expect(grid?.style.getPropertyValue("--columns-block-tracks")).toBe("minmax(0, 2fr) minmax(0, 1fr)");
    expect(grid?.querySelectorAll('[data-first-draft-preview-block-type="column"]')).toHaveLength(2);
    expect(grid?.querySelectorAll(":scope > .columns-block__resize-overlay")).toHaveLength(1);
    expect(grid?.querySelectorAll(".columns-block__boundary")).toHaveLength(1);
    expect(grid?.querySelectorAll(".columns-block__divider")).toHaveLength(1);
    expect(grid?.querySelector(".columns-block__resize-handle")).toBeNull();
    expect(
      grid?.querySelector(".first-draft-append-paragraph-surface"),
    ).toBeNull();
    expect(grid?.querySelector("[role='separator']")).toBeNull();

    const table = node("table", "ordered-table", {
      children: [
        node("tableRow", "row-one", { children: [node("tableCell", "a", { text: "A" }), node("tableCell", "b", { text: "B" })] }),
        node("tableRow", "row-two", { children: [node("tableCell", "c", { text: "C" }), node("tableCell", "d", { text: "D" })] }),
      ],
      presentation: {
        table: {
          columnIds: ["left", "right"],
          columnWidths: { left: 180, right: 240 },
          tracks: "180px 240px",
          rowCount: 2,
          columnCount: 2,
        },
      },
    });
    const tableRender = render(<FirstDraftDocumentBlockDragPreview snapshot={table} />);
    const tableGrid = tableRender.container.querySelector<HTMLElement>(
      ".table-block__grid",
    );
    expect(tableGrid).not.toBeNull();
    expect(tableRender.container.querySelectorAll(".table-block__grid")).toHaveLength(1);
    expect(tableGrid?.style.getPropertyValue("--first-draft-table-tracks")).toBe(
      "180px 240px",
    );
    expect(tableRender.container.querySelectorAll('[role="row"]')).toHaveLength(2);
    expect([...tableRender.container.querySelectorAll('[role="gridcell"]')].map((cell) => cell.textContent)).toEqual(["A", "B", "C", "D"]);
    expect(
      tableRender.container.querySelector(
        ".table-block__object, .table-block__scroll, .table-block__frame, .table-block__grid-stack",
      ),
    ).toBeNull();

    const ordered = minimal("orderedListItem");
    const orderedRender = render(
      <FirstDraftDocumentBlockDragPreview
        snapshot={node("orderedListItem", "ordinal", {
          children: ordered.children,
          presentation: { orderedListOrdinal: 7 },
        })}
      />,
    );
    expect(orderedRender.container.querySelector(".list-item-block__marker")?.textContent).toBe("7.");
  });

  it.each([1, 2, 3] as const)("retains semantic heading level h%s", (level) => {
    const rendered = render(
      <FirstDraftDocumentBlockDragPreview
        snapshot={node("heading", `heading-${level}`, {
          text: `Level ${level}`,
          presentation: { headingLevel: level },
        })}
      />,
    );
    expect(rendered.container.querySelector(`h${level}`)?.textContent).toBe(`Level ${level}`);
  });

  it.each([
    ["heading", ".heading-block__heading"],
    ["callout", ".callout-block__callout"],
    ["toggleHeading", ".toggle-heading-block__toggle"],
    ["columns", ".columns-block__grid"],
    ["tabs", ".tabs-block__tabs"],
    ["divider", ".divider-block__rule"],
  ] as const)(
    "removes only the top-level %s document-flow margin",
    (type, selector) => {
      const rendered = render(
        <div className="first-draft-example">
          <FirstDraftDocumentBlockDragPreview snapshot={minimal(type)} />
        </div>,
      );
      const visual = rendered.container.querySelector<HTMLElement>(selector)!;
      const computed = getComputedStyle(visual);

      expect(computed.marginTop).toBe("0px");
      expect(computed.marginRight).toBe("0px");
      expect(computed.marginBottom).toBe("0px");
      expect(computed.marginLeft).toBe("0px");
    },
  );

  it("retains nested heading spacing inside a top-level callout", () => {
    const rendered = render(
      <div className="first-draft-example">
        <FirstDraftDocumentBlockDragPreview
          snapshot={node("callout", "spaced-callout", {
            children: [
              node("heading", "nested-callout-heading", {
                presentation: { headingLevel: 1 },
              }),
            ],
          })}
        />
      </div>,
    );
    const callout = rendered.container.querySelector<HTMLElement>(
      ".callout-block__callout",
    )!;
    const nestedHeading = rendered.container.querySelector<HTMLElement>(
      ".heading-block__heading",
    )!;

    expect(getComputedStyle(callout).marginTop).toBe("0px");
    expect(getComputedStyle(nestedHeading).marginTop).toBe("1.5rem");
    expect(getComputedStyle(nestedHeading).marginBottom).toBe("0.25rem");
  });

  it("fails explicitly for an unknown type instead of falling back to a live renderer", () => {
    const unknown = {
      ...minimal("paragraph"),
      block: { ...minimal("paragraph").block, type: "futureBlock" },
    } as unknown as FirstDraftBlockDragPreviewNode;
    expect(() => render(renderFirstDraftDocumentBlockDragPreviewNode(unknown))).toThrow(
      "No First Draft document drag preview renderer for futureBlock",
    );
  });
});
