// The storage contract. Everything the app does with photo bytes goes through
// this interface, so swapping Cloudflare R2 for S3 (or the local disk in dev)
// is one env var and never a code change outside lib/storage.

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface StorageDriver {
  /** Human name, surfaced in error messages and the health check. */
  readonly name: string;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}
