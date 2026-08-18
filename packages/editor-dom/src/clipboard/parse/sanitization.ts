import { sanitizeEditorLinkUrl } from "@repo/editor-core/content/urls";
import { INLINE_ATOM_SEMANTIC_HTML_ATTRIBUTE } from "@repo/editor-core/content/inline-atoms";

export function sanitizeClipboardDocument(doc: Document): void {
  sanitizeSemanticDom(doc);
}

export function sanitizeSemanticDom(root: ParentNode): void {
  for (const node of Array.from(
    root.querySelectorAll(
      "script,style,meta,link,iframe,object,embed,template,[hidden]",
    ),
  ))
    node.remove();
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (!doc) return;
  const walker = doc.createTreeWalker(root, 128);
  const comments: Comment[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode as Comment);
  for (const comment of comments) comment.remove();
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "srcdoc" ||
        name === "srcset" ||
        name === "contenteditable" ||
        (name.startsWith("data-") &&
          name !== INLINE_ATOM_SEMANTIC_HTML_ATTRIBUTE)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
    for (const name of [
      "href",
      "src",
      "action",
      "formaction",
      "poster",
      "cite",
      "xlink:href",
    ]) {
      if (!element.hasAttribute(name)) continue;
      const sanitized = sanitizeEditorLinkUrl(element.getAttribute(name));
      if (sanitized && (name === "href" || !sanitized.startsWith("mailto:"))) {
        element.setAttribute(name, sanitized);
      } else {
        element.removeAttribute(name);
      }
    }
  }
}
