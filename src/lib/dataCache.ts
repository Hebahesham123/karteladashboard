/**
 * Global in-memory session cache.
 * Lives at module scope → survives React unmount/remount (i.e. page navigation).
 * Entries expire after TTL_MS; call invalidate() after data uploads.
 */

const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface Entry<T> {
  data: T;
  ts: number;
}

class DataCache {
  private store = new Map<string, Entry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > TTL_MS) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.store.set(key, { data, ts: Date.now() });
  }

  /** Remove keys that start with prefix (or clear all if no prefix). */
  invalidate(prefix?: string): void {
    if (!prefix) { this.store.clear(); return; }
    this.store.forEach((_, k) => { if (k.startsWith(prefix)) this.store.delete(k); });
  }
}

export const dataCache = new DataCache();
