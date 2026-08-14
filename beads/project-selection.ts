export interface BeadsProjectReference {
  id: string;
  hasBeads: boolean;
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
  const beadsProjects = projects.filter((project) => project.hasBeads);
  const projectIds = new Set(beadsProjects.map((project) => project.id));
  if (currentProjectId && projectIds.has(currentProjectId)) {
    return currentProjectId;
  }

  const latestThreadProject = [...threads]
    .filter((thread) => !thread.isArchived && projectIds.has(thread.projectId))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (latestThreadProject) return latestThreadProject.projectId;
  if (beadsProjects[0]) return beadsProjects[0].id;

  // If there is no initialized project yet, keep the panel useful by opening
  // the current BB project so it can offer the setup flow in context.
  const knownProjectIds = new Set(projects.map((project) => project.id));
  if (currentProjectId && knownProjectIds.has(currentProjectId)) {
    return currentProjectId;
  }
  const latestKnownThread = [...threads]
    .filter((thread) => !thread.isArchived && knownProjectIds.has(thread.projectId))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  return latestKnownThread?.projectId ?? projects[0]?.id ?? null;
}
