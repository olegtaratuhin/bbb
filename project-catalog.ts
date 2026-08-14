export type BeadsProjectOption = {
  id: string;
  name: string;
  hasBeads: boolean;
  canInitialize: boolean;
  sourceAvailable: boolean;
};

export const PROJECT_CATALOG_TTL_MS = 30_000;
const PROJECT_CATALOG_MAX_AGE_MS = 5 * 60_000;

type CatalogEntry = {
  projects: BeadsProjectOption[];
  updatedAt: number;
};

const catalog = new Map<string, CatalogEntry>();
const requests = new Map<string, Promise<BeadsProjectOption[]>>();

export function readProjectCatalog(key: string): BeadsProjectOption[] | null {
  const entry = catalog.get(key);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > PROJECT_CATALOG_MAX_AGE_MS) {
    catalog.delete(key);
    return null;
  }
  return entry.projects;
}

export function hasFreshProjectCatalog(key: string): boolean {
  const entry = catalog.get(key);
  return Boolean(entry && Date.now() - entry.updatedAt <= PROJECT_CATALOG_TTL_MS);
}

export function loadProjectCatalog(
  key: string,
  loader: () => Promise<BeadsProjectOption[]>,
  options: { force?: boolean } = {},
): Promise<BeadsProjectOption[]> {
  if (!options.force && hasFreshProjectCatalog(key)) {
    return Promise.resolve(readProjectCatalog(key) ?? []);
  }

  const existingRequest = requests.get(key);
  if (existingRequest) return existingRequest;

  const request = loader().then((projects) => {
    catalog.set(key, { projects, updatedAt: Date.now() });
    return projects;
  });
  requests.set(key, request);
  return request.then(
    (projects) => {
      if (requests.get(key) === request) requests.delete(key);
      return projects;
    },
    (cause) => {
      if (requests.get(key) === request) requests.delete(key);
      throw cause;
    },
  );
}

export function invalidateProjectCatalog(key?: string): void {
  if (key === undefined) {
    catalog.clear();
    return;
  }
  catalog.delete(key);
}

export function clearProjectCatalogCache(): void {
  catalog.clear();
  requests.clear();
}
