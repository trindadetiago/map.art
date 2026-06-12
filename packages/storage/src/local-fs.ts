import { promises as fs, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Storage, StorageEntry } from './types';

export class LocalFs implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private resolveKey(key: string): string {
    const normalized = key.replaceAll('\\', '/').replace(/^\/+/, '');
    const full = resolve(this.root, normalized);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Invalid storage key (path escapes root): ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.resolveKey(key);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, data);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolveKey(key));
  }

  async has(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolveKey(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  async presignReadUrl(key: string, _ttlSeconds: number): Promise<string> {
    return `/api/storage/${key}`;
  }

  async list(prefix = ''): Promise<StorageEntry[]> {
    const base = this.resolveKey(prefix);
    if (!existsSync(base)) return [];
    const entries: StorageEntry[] = [];
    const root = this.root;

    async function walk(dir: string): Promise<void> {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const full = join(dir, item.name);
        if (item.isDirectory()) {
          await walk(full);
        } else if (item.isFile()) {
          const stat = await fs.stat(full);
          entries.push({
            key: relative(root, full).split(sep).join('/'),
            size: stat.size,
            modifiedAt: stat.mtime,
          });
        }
      }
    }

    const baseStat = await fs.stat(base).catch(() => null);
    if (baseStat?.isFile()) {
      entries.push({
        key: relative(root, base).split(sep).join('/'),
        size: baseStat.size,
        modifiedAt: baseStat.mtime,
      });
    } else if (baseStat?.isDirectory()) {
      await walk(base);
    }

    return entries.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  }
}
