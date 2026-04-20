export interface StorageEntry {
  key: string;
  size: number;
  modifiedAt: Date;
}

export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<StorageEntry[]>;
}
