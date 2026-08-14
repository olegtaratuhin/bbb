import { afterEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "./bd-client";
import {
  clearIssueCache,
  hasFreshCachedIssues,
  invalidateIssueCache,
  ISSUE_CACHE_TTL_MS,
  makeIssueCacheKey,
  readCachedIssues,
  writeCachedIssues,
} from "./issue-cache";

const issue = (id: string) => ({
  id,
  title: `Issue ${id}`,
  labels: [],
  dependencies: [],
  dependents: [],
}) as Issue;

afterEach(() => {
  clearIssueCache();
  vi.useRealTimers();
});

describe("issue cache", () => {
  it("isolates entries by workspace, project, and query", () => {
    const first = makeIssueCacheKey({ workspacePath: "/repo-one", projectId: "p1", query: "status=open" });
    const second = makeIssueCacheKey({ workspacePath: "/repo-two", projectId: "p1", query: "status=open" });
    const third = makeIssueCacheKey({ workspacePath: "/repo-one", projectId: "p2", query: "status=open" });
    const fourth = makeIssueCacheKey({ workspacePath: "/repo-one", projectId: "p1", query: "status=closed" });

    writeCachedIssues(first, [issue("one")]);

    expect(readCachedIssues(first)?.[0]?.id).toBe("one");
    expect(readCachedIssues(second)).toBeNull();
    expect(readCachedIssues(third)).toBeNull();
    expect(readCachedIssues(fourth)).toBeNull();
  });

  it("marks a recent entry fresh and allows stale reads for revalidation", () => {
    vi.useFakeTimers();
    const key = makeIssueCacheKey({ projectId: "p1" });
    writeCachedIssues(key, [issue("one")]);

    expect(hasFreshCachedIssues(key)).toBe(true);
    vi.advanceTimersByTime(ISSUE_CACHE_TTL_MS + 1);

    expect(hasFreshCachedIssues(key)).toBe(false);
    expect(readCachedIssues(key)?.[0]?.id).toBe("one");
  });

  it("invalidates entries by key prefix or globally", () => {
    writeCachedIssues('{"workspacePath":"/repo","projectId":"p1"}', [issue("one")]);
    writeCachedIssues('other', [issue("two")]);

    invalidateIssueCache('{"workspacePath":"/repo"');
    expect(readCachedIssues('other')?.[0]?.id).toBe("two");
    expect(readCachedIssues('{"workspacePath":"/repo","projectId":"p1"}')).toBeNull();

    invalidateIssueCache();
    expect(readCachedIssues("other")).toBeNull();
  });

  it("evicts the least recently accessed entry after reaching the bound", () => {
    vi.useFakeTimers();
    const keys = Array.from({ length: 25 }, (_, index) => `key-${index}`);
    keys.forEach((key) => writeCachedIssues(key, [issue(key)]));
    expect(readCachedIssues(keys[0]!)).toBeNull();

    // Touching key-1 makes it newer than key-2 before the next eviction.
    vi.advanceTimersByTime(1);
    expect(readCachedIssues(keys[1]!)?.[0]?.id).toBe("key-1");
    writeCachedIssues("key-25", [issue("key-25")]);

    expect(readCachedIssues(keys[1]!)?.[0]?.id).toBe("key-1");
    expect(readCachedIssues(keys[2]!)).toBeNull();
  });
});
