export { observeEditorYjsAwarenessDisconnects } from "../observability/awareness-disconnects.ts";
export {
  Array as YArray,
  Doc,
  Doc as YDoc,
  applyUpdate,
  createAbsolutePositionFromRelativePosition,
  createRelativePositionFromTypeIndex,
  decodeRelativePosition,
  encodeRelativePosition,
  encodeStateAsUpdate,
  encodeStateVector,
  encodeStateVectorFromUpdate,
  diffUpdate,
  mergeUpdates,
} from "yjs";
export type { RelativePosition } from "yjs";
export { EDITOR_YJS_ORIGINS } from "../origins/origins.ts";
export { createBlockContentDocContext } from "../block-content/doc/context.ts";
export {
  applyPlannedCanonicalYjsContentMutation,
  canonicalOffsetToYjsIndex,
  ensureCanonicalYjsBlockContent,
  planCanonicalYjsContentMutation,
  readCanonicalYjsBlockContent,
  readCanonicalYjsBlockPlainText,
  readCanonicalYjsTextType,
  validateCanonicalYjsContentBase,
  writeCanonicalYjsBlockContent,
  yjsIndexToCanonicalOffset,
} from "../block-content/canonical-rich-text.ts";
export type { CanonicalYjsContentMutationPlan } from "../block-content/canonical-rich-text.ts";
export { createYjsBlockContentCheckpoint } from "../block-content/checkpoint.ts";
export {
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
} from "../block-content/checkpoint-format.ts";
export { observeBlockContentUpdates } from "../block-content/observation/observe-updates.ts";
export { createBlockContentFragmentContext } from "../fragments/fragment-context.ts";
export { applyBlockContentUpdate } from "../updates/apply-update.ts";
export { encodeBlockContentStateVector } from "../updates/state-vector.ts";
export { encodeBlockContentUpdate } from "../updates/encode-update.ts";
export type {
  EditorYjsAwarenessChangeEvent,
  EditorYjsAwarenessObservable,
  EditorYjsLogEvent,
  EditorYjsMetricEvent,
  EditorYjsObservabilityHooks,
} from "../observability/contracts.ts";
export type { EditorYjsFragmentContext } from "../fragments/contracts.ts";
export type { EditorYjsOrigin } from "../origins/contracts.ts";
export type {
  BlockContentDocContext,
  CreateBlockContentDocContextOptions,
} from "../block-content/doc/contracts.ts";
export type { BlockContentUpdateEvent } from "../block-content/observation/contracts.ts";
