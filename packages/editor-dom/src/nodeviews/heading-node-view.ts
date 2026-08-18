import type { NodeView, NodeViewConstructor, PMNode } from "../prosemirror/index.ts";
import {
  normalizeHeadingLevel,
  type HeadingLevel,
} from "@repo/editor-core/document";

export type HeadingNodeViewLevel = HeadingLevel;

export function createHeadingNodeView(level: unknown): NodeViewConstructor {
  const headingLevel = normalizeHeadingLevel(level);
  return (node) => new HeadingNodeView(node, headingLevel);
}

class HeadingNodeView implements NodeView {
  readonly dom: HTMLHeadingElement;
  readonly contentDOM: HTMLElement;
  private node: PMNode;
  private readonly level: HeadingNodeViewLevel;

  constructor(node: PMNode, level: HeadingNodeViewLevel) {
    this.node = node;
    this.level = level;
    this.dom = document.createElement(`h${level}`) as HTMLHeadingElement;
    this.contentDOM = this.dom;
    this.render();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  private render(): void {
    this.dom.setAttribute("data-block-node", "heading");
    this.dom.setAttribute("data-level", String(this.level));
  }
}
