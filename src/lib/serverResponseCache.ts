type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const cache = new Map<string, CacheEntry<unknown>>();

export async function getOrSetServerCache<T>(
  key: string,
  ttlMs: number,
  resolver: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) return cached.value;

  const value = await resolver();
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export function invalidateServerCache(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
