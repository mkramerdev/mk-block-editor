import type { JsonObject as EditorJsonMap } from "../../kernel/json/json-value.ts";
import type { InlineMarkName } from "../marks/types.ts";

export type RichTextAttrsJson = EditorJsonMap;

export type RichTextMarkJson = EditorJsonMap & {
  readonly type: InlineMarkName;
  readonly attrs?: RichTextAttrsJson;
};

export type RichTextTextNodeJson = EditorJsonMap & {
  readonly type: "text";
  readonly text: string;
  readonly marks?: readonly RichTextMarkJson[];
};

export type RichTextHardBreakNodeJson = EditorJsonMap & {
  readonly type: "hard_break";
  readonly marks?: readonly RichTextMarkJson[];
};

export type RichTextAtomNodeJson = EditorJsonMap & {
  readonly type: string;
  readonly metadata: EditorJsonMap;
  readonly marks?: readonly RichTextMarkJson[];
};

export type RichTextInlineNodeJson =
  | RichTextTextNodeJson
  | RichTextHardBreakNodeJson
  | RichTextAtomNodeJson;

export type RichTextBlockNodeJson = EditorJsonMap & {
  readonly type: "paragraph";
  readonly content?: readonly RichTextInlineNodeJson[];
  readonly attrs?: RichTextAttrsJson;
};

export type RichTextDocumentNodeJson = EditorJsonMap & {
  readonly type: "doc";
  readonly content: readonly RichTextBlockNodeJson[];
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
