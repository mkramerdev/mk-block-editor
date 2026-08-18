export interface EditorBlockCommandRequest<TPayload = unknown> {
  commandId: string;
  payload?: TPayload;
  from?: number;
  to?: number;
}
