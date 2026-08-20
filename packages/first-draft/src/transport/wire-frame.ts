export const FIRST_DRAFT_PROTOCOL_VERSION = 5;
export const MAX_FIRST_DRAFT_FRAME_BYTES = 32 * 1024 * 1024;

const MAGIC = [0x46, 0x44, 0x54, FIRST_DRAFT_PROTOCOL_VERSION] as const;
const HEADER_BYTES = 8;
const LENGTH_BYTES = 4;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export interface FirstDraftWirePayload {
  readonly byteLength: number;
  copyInto(destination: Uint8Array, offset: number): void;
}

export type DecodeFirstDraftWireFrameResult =
  | {
      readonly ok: true;
      readonly metadata: unknown;
      readonly payloads: readonly Uint8Array[];
    }
  | { readonly ok: false; readonly error: string };

export function encodeFirstDraftWireFrame(
  metadata: unknown,
  payloads: readonly FirstDraftWirePayload[] = [],
): ArrayBuffer {
  const metadataBytes = textEncoder.encode(JSON.stringify(metadata));
  const frameLength =
    HEADER_BYTES +
    metadataBytes.byteLength +
    payloads.reduce(
      (total, payload) => total + LENGTH_BYTES + payload.byteLength,
      0,
    );
  if (frameLength > MAX_FIRST_DRAFT_FRAME_BYTES) {
    throw new Error("First Draft transaction frame exceeds the size limit");
  }
  const frame = new ArrayBuffer(frameLength);
  const bytes = new Uint8Array(frame);
  const view = new DataView(frame);
  bytes.set(MAGIC, 0);
  view.setUint32(4, metadataBytes.byteLength);
  bytes.set(metadataBytes, HEADER_BYTES);
  let offset = HEADER_BYTES + metadataBytes.byteLength;
  for (const payload of payloads) {
    view.setUint32(offset, payload.byteLength);
    offset += LENGTH_BYTES;
    payload.copyInto(bytes, offset);
    offset += payload.byteLength;
  }
  return frame;
}

export function decodeFirstDraftWireFrame(
  input: ArrayBuffer | ArrayBufferView,
): DecodeFirstDraftWireFrameResult {
  const bytes = toBytes(input);
  if (
    bytes.byteLength < HEADER_BYTES ||
    bytes.byteLength > MAX_FIRST_DRAFT_FRAME_BYTES
  ) {
    return invalid("First Draft frame length is invalid");
  }
  if (!MAGIC.every((byte, index) => bytes[index] === byte)) {
    return invalid("First Draft frame magic or version is invalid");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metadataLength = view.getUint32(4);
  const metadataEnd = HEADER_BYTES + metadataLength;
  if (metadataLength === 0 || metadataEnd > bytes.byteLength) {
    return invalid("First Draft frame metadata length is invalid");
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(
      textDecoder.decode(bytes.subarray(HEADER_BYTES, metadataEnd)),
    );
  } catch {
    return invalid("First Draft frame metadata is not valid UTF-8 JSON");
  }
  const payloads: Uint8Array[] = [];
  let offset = metadataEnd;
  while (offset < bytes.byteLength) {
    if (offset + LENGTH_BYTES > bytes.byteLength) {
      return invalid("First Draft binary segment length is truncated");
    }
    const length = view.getUint32(offset);
    offset += LENGTH_BYTES;
    if (length === 0 || offset + length > bytes.byteLength) {
      return invalid("First Draft binary segment is empty or truncated");
    }
    payloads.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  return { ok: true, metadata, payloads };
}

function toBytes(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  return input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function invalid(error: string): DecodeFirstDraftWireFrameResult {
  return { ok: false, error };
}
