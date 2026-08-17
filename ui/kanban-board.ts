import type { Issue } from "../beads/bd-client";

export const KANBAN_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
] as const;

export type KanbanStatus = (typeof KANBAN_STATUSES)[number];

export interface KanbanDropTarget {
  status: KanbanStatus;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Return the canonical board bucket for an issue status. */
export function kanbanStatus(status: string | undefined): KanbanStatus | "__other" {
  return KANBAN_STATUSES.includes(status as KanbanStatus)
    ? (status as KanbanStatus)
    : "__other";
}

/** Find the status column under a pointer, or null when it is outside the board. */
export function kanbanDropStatus(
  targets: readonly KanbanDropTarget[],
  x: number,
  y: number,
): KanbanStatus | null {
  const target = targets.find(
    (candidate) =>
      x >= candidate.left &&
      x <= candidate.right &&
      y >= candidate.top &&
      y <= candidate.bottom,
  );
  return target?.status ?? null;
}

/** Apply an optimistic status change without changing the order of the result. */
export function applyIssueStatus(
  issues: readonly Issue[],
  issueId: string,
  status: KanbanStatus,
): Issue[] {
  return issues.map((issue) =>
    issue.id === issueId ? { ...issue, status } : issue,
  );
}
