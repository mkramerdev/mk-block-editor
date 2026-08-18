/**
 * Runtime-neutral ownership envelope for encoded block content.
 *
 * The format and version are interpreted by the selected content runtime.
 * Payload bytes are owned by an immutable value once they cross a public
 * receipt boundary.
 */
export interface EditorEncodedContent {
  readonly format: string;
  readonly version: number;
  readonly payload: EditorImmutableBinary;
}

/**
 * Runtime-neutral immutable ownership for published encoded editor content.
 * No view of the privately owned storage is exposed.
 */
export class EditorImmutableBinary {
  readonly #bytes: Uint8Array;

  private constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    Object.freeze(this);
  }

  static copyOf(bytes: Uint8Array): EditorImmutableBinary {
    return new EditorImmutableBinary(new Uint8Array(bytes));
  }

  /**
   * Transfers an exclusively owned, full-buffer view and detaches the caller's
   * buffer. Non-transferable views fall back to one ownership copy.
   */
  static takeOwnership(bytes: Uint8Array): EditorImmutableBinary {
    if (
      bytes.buffer instanceof ArrayBuffer &&
      bytes.byteOffset === 0 &&
      bytes.byteLength === bytes.buffer.byteLength
    ) {
      const transfer = (
        globalThis as typeof globalThis & {
          readonly structuredClone: (
            value: Uint8Array,
            options: { readonly transfer: readonly ArrayBuffer[] },
          ) => Uint8Array;
        }
      ).structuredClone;
      if (typeof transfer !== "function") {
        throw new Error("Encoded-content ownership transfer is unavailable");
      }
      const owned = transfer(bytes, { transfer: [bytes.buffer] });
      return new EditorImmutableBinary(owned);
    }
    return EditorImmutableBinary.copyOf(bytes);
  }

  get byteLength(): number {
    return this.#bytes.byteLength;
  }

  byteAt(index: number): number | undefined {
    return this.#bytes[index];
  }

  equals(other: EditorImmutableBinary): boolean {
    if (this === other) return true;
    if (this.byteLength !== other.byteLength) return false;
    for (let index = 0; index < this.byteLength; index += 1) {
      if (this.#bytes[index] !== other.#bytes[index]) return false;
    }
    return true;
  }

  equalsBytes(other: Uint8Array): boolean {
    if (this.byteLength !== other.byteLength) return false;
    for (let index = 0; index < this.byteLength; index += 1) {
      if (this.#bytes[index] !== other[index]) return false;
    }
    return true;
  }

  copyInto(destination: Uint8Array, offset = 0): void {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError("Encoded-content destination offset is invalid");
    }
    if (offset + this.byteLength > destination.byteLength) {
      throw new RangeError("Encoded-content destination is too small");
    }
    destination.set(this.#bytes, offset);
  }

  copy(): Uint8Array {
    return new Uint8Array(this.#bytes);
  }
}

/** Incremental output produced by one accepted block-content commit. */
export interface EditorContentOperationUpdate extends EditorEncodedContent {
  readonly kind: "operation";
}

/** Accumulated state for one independent text block. */
export interface EditorContentCheckpoint extends EditorEncodedContent {
  readonly kind: "checkpoint";
}

/** Transport-safe state for one independent block; payload decoding is deferred. */
export interface EditorOpaqueContentCheckpoint {
  readonly kind: "checkpoint";
  readonly format: string;
  readonly version: number;
  readonly payloadBase64: string;
}
