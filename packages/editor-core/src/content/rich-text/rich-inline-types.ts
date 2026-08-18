import type {
  JsonObject as EditorJsonMap,
} from "../../kernel/json/json-value.ts";
import type { InlineMarkName } from "../marks/types.ts";

export type RichTextAttrsJson = EditorJsonMap;

export type RichTextMarkJson = EditorJsonMap & {
  type: InlineMarkName;
  attrs?: RichTextAttrsJson;
};

export type RichTextTextNodeJson = EditorJsonMap & {
  type: "text";
  text: string;
  marks?: RichTextMarkJson[];
};

export type RichTextHardBreakNodeJson = EditorJsonMap & {
  type: "hard_break";
  marks?: RichTextMarkJson[];
};

export type RichTextAtomNodeJson = EditorJsonMap & {
  type: string;
  metadata: EditorJsonMap;
  marks?: RichTextMarkJson[];
};

export type RichTextInlineNodeJson =
  | RichTextTextNodeJson
  | RichTextHardBreakNodeJson
  | RichTextAtomNodeJson;

export type RichTextBlockNodeJson = EditorJsonMap & {
  type: "paragraph";
  content?: RichTextInlineNodeJson[];
  attrs?: RichTextAttrsJson;
};

export type RichTextDocumentNodeJson = EditorJsonMap & {
  type: "doc";
  content: RichTextBlockNodeJson[];
};

export type RichTextJsonValidationResult<T> =
  | {
      readonly valid: true;
      readonly value: T;
      readonly errors: readonly [];
    }
  | {
      readonly valid: false;
      readonly value: null;
      readonly errors: readonly string[];
    };
