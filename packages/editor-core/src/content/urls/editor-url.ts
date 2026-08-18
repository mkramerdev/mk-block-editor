export function sanitizeEditorLinkUrl(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return looksLikeAbsoluteHost(trimmed.slice(2)) ? `https:${trimmed}` : null;
  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return trimmed;
  }
  const protocolMatch = /^([a-zA-Z][a-zA-Z\d+.-]*):/.exec(trimmed);
  if (!protocolMatch) return looksLikeAbsoluteHost(trimmed) ? `https://${trimmed}` : null;
  if (!trimmed.includes("://") && looksLikeHostWithPortPath(trimmed)) return `https://${trimmed}`;
  const protocol = protocolMatch[1]?.toLowerCase();
  if (protocol === "http" || protocol === "https") return trimmed;
  if (protocol === "mailto") return trimmed;
  return null;
}

function looksLikeHostWithPortPath(value: string): boolean {
  return /^(?:localhost|[a-zA-Z\d-]+(?:\.[a-zA-Z\d-]+)+):\d+(?:[/?#].*)?$/.test(value);
}

function looksLikeAbsoluteHost(value: string): boolean {
  return /^(?:localhost|[a-zA-Z\d-]+(?:\.[a-zA-Z\d-]+)+)(?::\d+)?(?:[/?#].*)?$/.test(value);
}
