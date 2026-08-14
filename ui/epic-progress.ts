// epic-progress.ts — pure helpers for epic / milestone progress modelling.
//
// No side effects on import.  No RPC, filesystem, or CLI calls.

import type { Issue } from "../beads/bd-client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface EpicProgress {
  /** The epic or milestone issue itself. */
  container: Issue;
  /** Total number of descendant work issues (all depths). */
  total: number;
  /** Number of descendant work issues whose status is "closed". */
  completed: number;
  /** Completion percentage rounded to an integer (0–100). */
  percentage: number;
  /** Status breakdown of descendant work issues. */
  statusCounts: Record<string, number>;
}

// ── Predicates ───────────────────────────────────────────────────────────────

/** Returns true when the issue acts as a container (epic or milestone). */
export function isContainerIssue(issue: Issue): boolean {
  const t = issue.issue_type ?? "";
  return t === "epic" || t === "milestone";
}

/** Returns true when the issue is a work item (not a container). */
function isWorkIssue(issue: Issue): boolean {
  return !isContainerIssue(issue);
}

// ── Parent / descendant helpers ──────────────────────────────────────────────

/**
 * Return the parent issue for a given issue, or `undefined` when the parent
 * field is absent, empty, or not found in the issue set.
 */
function findParent(issue: Issue, issueMap: Map<string, Issue>): Issue | undefined {
  const parentId = issue.parent;
  if (typeof parentId !== "string" || !parentId) {
    return undefined;
  }
  return issueMap.get(parentId) ?? undefined;
}

/**
 * Recursively collect all descendant work-issue IDs for a container,
 * traversing through intermediate containers as well.
 */
function collectDescendantWorkIds(
  containerId: string,
  issueMap: Map<string, Issue>,
  childrenMap: Map<string, Set<string>>,
  visited = new Set<string>(),
): Set<string> {
  const result = new Set<string>();
  const directChildren = childrenMap.get(containerId);
  if (!directChildren) return result;

  for (const childId of directChildren) {
    if (visited.has(childId)) continue;
    visited.add(childId);

    const child = issueMap.get(childId);
    if (!child) continue;

    if (isWorkIssue(child)) {
      result.add(childId);
    } else {
      // Recurse into nested containers
      const grandDescendants = collectDescendantWorkIds(childId, issueMap, childrenMap, visited);
      for (const id of grandDescendants) {
        result.add(id);
      }
    }
  }

  return result;
}

/**
 * Determine whether a work issue has a valid container ancestor
 * (epic or milestone) in the provided issue set.
 */
function hasContainerAncestor(issue: Issue, issueMap: Map<string, Issue>): boolean {
  let current = issue;
  const visited = new Set<string>();

  while (true) {
    if (visited.has(current.id)) return false;
    visited.add(current.id);

    const parent = findParent(current, issueMap);
    if (!parent) return false;

    if (isContainerIssue(parent)) return true;

    current = parent;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build progress summaries for all epic / milestone containers found in the
 * issue list.
 *
 * - `total` counts every descendant work issue (including nested containers'
 *   leaf work issues).
 * - `completed` counts those with status "closed".
 * - `percentage` is `Math.round((completed / total) * 100)` or `0` when
 *   `total` is `0`.
 * - `statusCounts` maps each distinct status to its count among descendant
 *   work issues.
 *
 * Handles empty input and missing / orphan parents without throwing.
 */
export function buildEpicProgress(issues: readonly Issue[]): EpicProgress[] {
  if (!issues || issues.length === 0) {
    return [];
  }

  // Build lookup maps
  const issueMap = new Map<string, Issue>();
  const childrenMap = new Map<string, Set<string>>();

  for (const issue of issues) {
    issueMap.set(issue.id, issue);

    // Build children map
    const parentId = issue.parent;
    if (typeof parentId === "string" && parentId) {
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, new Set());
      }
      childrenMap.get(parentId)!.add(issue.id);
    }
  }

  // Collect progress for each container
  const result: EpicProgress[] = [];

  for (const issue of issues) {
    if (!isContainerIssue(issue)) continue;

    const descendantIds = collectDescendantWorkIds(issue.id, issueMap, childrenMap);
    const total = descendantIds.size;
    const statusCounts: Record<string, number> = {};
    let completed = 0;

    for (const descId of descendantIds) {
      const desc = issueMap.get(descId);
      if (!desc) continue;

      const status = desc.status ?? "open";
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;

      if (status === "closed") {
        completed++;
      }
    }

    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    result.push({
      container: issue,
      total,
      completed,
      percentage,
      statusCounts,
    });
  }

  return result;
}

/**
 * Return all descendant work issues for an epic or milestone in source order.
 * Nested containers are traversed, while the container issues themselves are
 * excluded from the returned list.
 */
export function getDescendantWorkIssues(
  issues: readonly Issue[],
  containerId: string,
): Issue[] {
  if (!issues || issues.length === 0 || !containerId) {
    return [];
  }

  const issueMap = new Map<string, Issue>();
  const childrenMap = new Map<string, Set<string>>();
  for (const issue of issues) {
    issueMap.set(issue.id, issue);
    const parentId = issue.parent;
    if (typeof parentId !== "string" || !parentId) continue;
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, new Set());
    childrenMap.get(parentId)!.add(issue.id);
  }

  const descendantIds = collectDescendantWorkIds(
    containerId,
    issueMap,
    childrenMap,
  );
  return issues.filter((issue) => descendantIds.has(issue.id));
}

/**
 * Return work issues (non-epic / non-milestone) that have no valid container
 * ancestor in the provided issue set.
 *
 * Handles empty input and missing parents without throwing.
 */
export function getUnassignedWorkIssues(issues: readonly Issue[]): Issue[] {
  if (!issues || issues.length === 0) {
    return [];
  }

  const issueMap = new Map<string, Issue>();
  for (const issue of issues) {
    issueMap.set(issue.id, issue);
  }

  const unassigned: Issue[] = [];

  for (const issue of issues) {
    if (!isWorkIssue(issue)) continue;

    if (!hasContainerAncestor(issue, issueMap)) {
      unassigned.push(issue);
    }
  }

  return unassigned;
}
