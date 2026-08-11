const ROOT_COMPOSE_PROJECT_ID_KEY = "bb.root-compose.project-id";

export interface ComposerScopeLike {
  kind: string;
  projectId?: string | null;
}

export interface ProjectIdCandidates {
  configuredProjectId?: string | null;
  composerProjectId?: string | null;
  rootComposeProjectId?: string | null;
  routeProjectId?: string | null;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function projectIdFromComposerScope(scope: ComposerScopeLike): string | null {
  return nonEmpty(scope.projectId);
}

export function chooseProjectId({
  configuredProjectId,
  composerProjectId,
  rootComposeProjectId,
  routeProjectId,
}: ProjectIdCandidates): string | null {
  return (
    nonEmpty(configuredProjectId) ??
    nonEmpty(routeProjectId) ??
    nonEmpty(composerProjectId) ??
    nonEmpty(rootComposeProjectId)
  );
}

export function readRootComposeProjectId(
  storage: Pick<Storage, "getItem"> | undefined,
): string | null {
  return nonEmpty(storage?.getItem(ROOT_COMPOSE_PROJECT_ID_KEY));
}
