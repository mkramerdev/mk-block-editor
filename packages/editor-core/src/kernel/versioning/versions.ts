import type { Brand } from "../identity/brand.ts";

export type ContentVersion = Brand<string, "ContentVersion">;

export function asContentVersion(value: string): ContentVersion {
  if (value.length === 0) {
    throw new TypeError("content version must not be empty");
  }
  return value as ContentVersion;
}
