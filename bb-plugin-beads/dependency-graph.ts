import type { Issue, IssueDependency } from "./bd-client";

export type GraphRelation = "blocking" | "hierarchy" | "related" | "other";

export interface DependencyEdge {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  relation: GraphRelation;
  directed: boolean;
}

function relationFor(type: string): GraphRelation {
  const normalized = type.toLowerCase();
  if (["blocks", "conditional-blocks", "waits-for"].includes(normalized)) {
    return "blocking";
  }
  if (normalized === "parent-child") return "hierarchy";
  if (["related", "relates-to", "discovered-from"].includes(normalized)) {
    return "related";
  }
  return "other";
}

function edgeFromDependency(dependency: IssueDependency): DependencyEdge | null {
  if (!dependency.issue_id || !dependency.depends_on_id) return null;

  const relation = relationFor(dependency.type);
  // Beads stores “issue depends on depends_on_id”. For blocking and hierarchy
  // views, draw the useful direction: blocker/parent -> dependent/child.
  const reverseDirection = relation === "blocking" || relation === "hierarchy";
  const fromId = reverseDirection
    ? dependency.depends_on_id
    : dependency.issue_id;
  const toId = reverseDirection ? dependency.issue_id : dependency.depends_on_id;

  return {
    id: `${dependency.issue_id}:${dependency.depends_on_id}:${dependency.type}`,
    fromId,
    toId,
    type: dependency.type,
    relation,
    directed: relation !== "related",
  };
}

/** Build de-duplicated, visible dependency edges for the graph canvas. */
export function buildDependencyEdges(
  issues: readonly Issue[],
): DependencyEdge[] {
  const issueIds = new Set(issues.map((issue) => issue.id));
  const edges = new Map<string, DependencyEdge>();

  for (const issue of issues) {
    for (const dependency of [...issue.dependencies, ...issue.dependents]) {
      const edge = edgeFromDependency(dependency);
      if (!edge || !issueIds.has(edge.fromId) || !issueIds.has(edge.toId)) {
        continue;
      }
      edges.set(edge.id, edge);
    }
  }

  return [...edges.values()];
}
