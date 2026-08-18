export function parseClipboardHtmlDocument(html: string): Document | null {
  const parser = typeof DOMParser !== "undefined" ? new DOMParser() : null;
  if (!parser) return null;
  return parser.parseFromString(html, "text/html");
}
