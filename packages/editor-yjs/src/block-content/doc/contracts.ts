import type { BlockId } from "@repo/editor-core/kernel";
import type { Doc, Map as YMap } from "yjs";
import type { EditorYjsFragmentContext } from "../../fragments/contracts.ts";
import type {
  BlockContentDocMetadataValidation,
  EditorYjsBlockContentDocumentKind,
  EditorYjsBlockContentMetadataKey,
} from "../metadata/contracts.ts";

export interface CreateBlockContentDocContextOptions {
  blockId: BlockId;
  doc?: Doc;
  destroyDocOnDestroy?: boolean;
}

export interface BlockContentDocContext extends EditorYjsFragmentContext {
  readonly metadata: YMap<unknown>;
  readonly blockId: BlockId;
  readonly documentKind: EditorYjsBlockContentDocumentKind;
  readonly destroyDocOnDestroy: boolean;
  getMetadataMap(): YMap<unknown>;
  getMetadata<T = unknown>(
    key: EditorYjsBlockContentMetadataKey,
  ): T | undefined;
  getDocumentKind(): EditorYjsBlockContentDocumentKind | null;
  validateMetadata(): BlockContentDocMetadataValidation;
  destroy(): void;
}
