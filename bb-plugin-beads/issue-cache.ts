import type { Issue } from "./bd-client";

export const ISSUE_CACHE_TTL_MS = 15_000;
const ISSUE_CACHE_MAX_AGE_MS = 5 * 60_000;
const ISSUE_CACHE_MAX_ENTRIES = 24;

type IssueCacheEntry = {
  key: string;
  issues: Issue[];
  updatedAt: number;
  lastAccessedAt: number;
};

const cache = new Map<string, IssueCacheEntry>();

export function makeIssueCacheKey({
  workspacePath,
  projectId,
  query,
}: {
  workspacePath?: string;
  projectId?: string | null;
  query?: string;
}): string {
  return JSON.stringify({
    workspacePath: workspacePath?.trim() || null,
    projectId: projectId ?? null,
    query: query?.trim() || null,
  });
}

export function readCachedIssues(key: string): Issue[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > ISSUE_CACHE_MAX_AGE_MS) {
    cache.delete(key);
    return null;
  }
  entry.lastAccessedAt = Date.now();
  return entry.issues;
}

export function hasFreshCachedIssues(key: string): boolean {
  const entry = cache.get(key);
  return Boolean(entry && Date.now() - entry.updatedAt <= ISSUE_CACHE_TTL_MS);
}

export function writeCachedIssues(key: string, issues: Issue[]): void {
  const now = Date.now();
  cache.set(key, { key, issues, updatedAt: now, lastAccessedAt: now });
  while (cache.size > ISSUE_CACHE_MAX_ENTRIES) {
    const oldest = [...cache.values()].sort(
      (left, right) => left.lastAccessedAt - right.lastAccessedAt,
    )[0];
    if (!oldest) break;
    cache.delete(oldest.key);
  }
}

export function invalidateIssueCache(prefix?: string): void {
  if (prefix === undefined) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function clearIssueCache(): void {
  cache.clear();
}
