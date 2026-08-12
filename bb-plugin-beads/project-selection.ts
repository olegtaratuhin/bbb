export interface BeadsProjectReference {
  id: string;
}

export interface BeadsThreadReference {
  projectId: string;
  updatedAt: number;
  isArchived: boolean;
}

/**
 * Pick the project a Beads panel should open before the user makes an
 * explicit choice. The current BB project is strongest; otherwise the most
 * recently updated non-archived thread gives us the user's latest context.
 */
export function chooseDefaultBeadsProject({
  currentProjectId,
  projects,
  threads,
}: {
  currentProjectId: string | null;
  projects: readonly BeadsProjectReference[];
  threads: readonly BeadsThreadReference[];
}): string | null {
  const projectIds = new Set(projects.map((project) => project.id));
  if (currentProjectId && projectIds.has(currentProjectId)) {
    return currentProjectId;
  }

  const latestThreadProject = [...threads]
    .filter((thread) => !thread.isArchived && projectIds.has(thread.projectId))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  return latestThreadProject?.projectId ?? projects[0]?.id ?? null;
}
