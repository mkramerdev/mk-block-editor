import type { ContentVersion } from "../../kernel/versioning/versions.ts";
import type { Block } from "./block.ts";

export interface BlockVersionMetadata {
  readonly metadataVersion: string;
  readonly contentVersion: ContentVersion | null;
}

export type VersionedBlock = Block & BlockVersionMetadata;
