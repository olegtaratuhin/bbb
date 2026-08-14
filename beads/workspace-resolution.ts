export interface WorkspaceResolutionInput {
  configuredProjectId?: string | null;
  projectId?: string | null;
  workspacePath?: string | null;
}

export type WorkspaceTarget =
  | { kind: "path"; path: string }
  | { kind: "project"; projectId: string }
  | null;

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Select the CLI target, keeping explicit configuration ahead of discovery. */
export function resolveWorkspaceTarget({
  configuredProjectId,
  projectId,
  workspacePath,
}: WorkspaceResolutionInput): WorkspaceTarget {
  const path = nonEmpty(workspacePath);
  if (path) return { kind: "path", path };

  const selectedProjectId = nonEmpty(configuredProjectId) ?? nonEmpty(projectId);
  return selectedProjectId
    ? { kind: "project", projectId: selectedProjectId }
    : null;
}

export interface ProjectSourceLike {
  isDefault?: boolean;
  path?: string;
  type?: string;
  hostId?: string;
}

/** Pick the BB project source that can be used as a local bd working directory. */
export function selectLocalWorkspaceSource(
  sources: readonly ProjectSourceLike[],
): ProjectSourceLike {
  const source = sources.find((candidate) => candidate.isDefault) ?? sources[0];
  if (!source || source.type !== "local_path" || !source.path?.trim()) {
    throw new Error("The selected project has no local workspace for bd");
  }
  return source;
}
