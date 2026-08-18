import {
  INITIAL_BLOCK_GRAPH_VERSION,
  assertValidBlockGraphVersion,
} from "@repo/editor-core/document";
import type { EditorSessionState } from "./contracts.ts";

export function createInitialEditorSessionState(options: {
  blockGraphVersion?: number;
  createdAt?: number;
  updatedAt?: number;
}): EditorSessionState {
  const blockGraphVersion =
    options.blockGraphVersion ?? INITIAL_BLOCK_GRAPH_VERSION;
  assertValidBlockGraphVersion(blockGraphVersion);
  return {
    blockGraphVersion,
    createdAt: options.createdAt ?? Date.now(),
    updatedAt: options.updatedAt ?? Date.now(),
  };
}
