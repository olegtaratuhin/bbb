import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectCatalogCache,
  hasFreshProjectCatalog,
  invalidateProjectCatalog,
  loadProjectCatalog,
  PROJECT_CATALOG_TTL_MS,
  readProjectCatalog,
  type BeadsProjectOption,
} from "../../project-catalog";

const projects: BeadsProjectOption[] = [
  {
    id: "project-one",
    name: "Project One",
    hasBeads: true,
    canInitialize: false,
    sourceAvailable: true,
  },
];

afterEach(() => {
  clearProjectCatalogCache();
  vi.useRealTimers();
});

describe("project catalog cache", () => {
  it("reuses a fresh catalog without calling the loader again", async () => {
    const loader = vi.fn().mockResolvedValue(projects);

    await loadProjectCatalog("bb-projects", loader);
    await loadProjectCatalog("bb-projects", loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(readProjectCatalog("bb-projects")).toEqual(projects);
    expect(hasFreshProjectCatalog("bb-projects")).toBe(true);
  });

  it("shares an in-flight request between mounts", async () => {
    let resolve!: (value: BeadsProjectOption[]) => void;
    const loader = vi.fn(
      () => new Promise<BeadsProjectOption[]>((done) => {
        resolve = done;
      }),
    );

    const first = loadProjectCatalog("bb-projects", loader);
    const second = loadProjectCatalog("bb-projects", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    resolve(projects);

    await expect(Promise.all([first, second])).resolves.toEqual([projects, projects]);
  });

  it("revalidates a stale catalog while retaining the previous snapshot", async () => {
    vi.useFakeTimers();
    const loader = vi
      .fn()
      .mockResolvedValueOnce(projects)
      .mockResolvedValueOnce([{ ...projects[0], name: "Updated Project" }]);

    await loadProjectCatalog("bb-projects", loader);
    vi.advanceTimersByTime(PROJECT_CATALOG_TTL_MS + 1);
    const refresh = loadProjectCatalog("bb-projects", loader);

    expect(readProjectCatalog("bb-projects")).toEqual(projects);
    await expect(refresh).resolves.toEqual([{ ...projects[0], name: "Updated Project" }]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("invalidates one catalog without affecting another key", async () => {
    await loadProjectCatalog("one", () => Promise.resolve(projects));
    await loadProjectCatalog("two", () => Promise.resolve(projects));

    invalidateProjectCatalog("one");

    expect(readProjectCatalog("one")).toBeNull();
    expect(readProjectCatalog("two")).toEqual(projects);
  });
});
