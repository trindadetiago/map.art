export interface StorageEntry {
  key: string;
  size: number;
  modifiedAt: Date;
}

/** Response headers stored with an object and returned on every GET. */
export interface PutOptions {
  contentType?: string;
  cacheControl?: string;
}

export interface Storage {
  put(key: string, data: Buffer, opts?: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<StorageEntry[]>;
  /**
   * Time-limited public GET URL for an object, fetchable without credentials.
   * `response` overrides headers the storage sends with the object (S3
   * response-content-* params) — e.g. a content type or cache policy.
   */
  presignGet(
    key: string,
    expiresInSeconds?: number,
    response?: { contentType?: string; cacheControl?: string },
  ): Promise<string>;
}
