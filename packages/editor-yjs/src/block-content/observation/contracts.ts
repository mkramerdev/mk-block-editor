import type { BlockId } from "@repo/editor-core/kernel";

export interface BlockContentUpdateEvent {
  readonly blockId: BlockId;
  readonly update: Uint8Array;
  readonly origin: unknown;
}
