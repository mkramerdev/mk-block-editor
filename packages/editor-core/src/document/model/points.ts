import type { BlockId } from "../../kernel/identity/ids.ts";
import type { ContentVersion } from "../../kernel/versioning/versions.ts";

export interface RelativeTextPoint {
  encoded: string;
  assoc?: -1 | 0 | 1;
}

export interface TextPoint {
  blockId: BlockId;
  offset: number;
  contentVersion?: ContentVersion | string;
  relative?: RelativeTextPoint;
}
