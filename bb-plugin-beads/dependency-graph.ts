import type { Issue, IssueDependency } from "./bd-client";

export type GraphRelation = "blocking" | "hierarchy" | "related" | "other";
export type GraphOrientation = "horizontal" | "vertical";

export const GRAPH_NODE_WIDTH = 196;
export const GRAPH_NODE_HEIGHT = 68;
export const GRAPH_COLUMN_GAP = 52;
export const GRAPH_ROW_GAP = 24;

export interface DependencyEdge {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  relation: GraphRelation;
  directed: boolean;
}

export interface GraphNodePosition {
  issue: Issue;
  x: number;
  y: number;
  layer: number;
}

export interface DependencyGraphLayout {
  nodes: GraphNodePosition[];
  width: number;
  height: number;
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

/**
 * Arrange dependency layers in the requested reading direction.
 *
 * The edge direction is always blocker/parent -> dependent/child. Horizontal
 * is the default because it keeps the original graph behavior; vertical uses
 * the same layers and ordering, rotated so the dependency flow reads down.
 */
export function layoutDependencyGraph(
  issues: readonly Issue[],
  edges: readonly DependencyEdge[],
  orientation: GraphOrientation = "horizontal",
): DependencyGraphLayout {
  // Keep isolated issues visible as nodes too. The graph still draws only
  // actual relationships, but a card should not disappear merely because it
  // has no dependency edge (which is especially easy to miss for closed work).
  const graphIssues = [...issues].sort((a, b) => a.id.localeCompare(b.id));
  const levels = new Map(graphIssues.map((issue) => [issue.id, 0]));

  // Longest-path layering keeps blockers and parents before their dependents.
  // Bounded passes also keep malformed/cyclic dependency data renderable.
  for (let pass = 0; pass < graphIssues.length; pass++) {
    let changed = false;
    for (const edge of edges) {
      const nextLevel = (levels.get(edge.fromId) ?? 0) + 1;
      if (nextLevel > (levels.get(edge.toId) ?? 0)) {
        levels.set(edge.toId, nextLevel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byLayer = new Map<number, Issue[]>();
  for (const issue of graphIssues) {
    const layer = levels.get(issue.id) ?? 0;
    const bucket = byLayer.get(layer) ?? [];
    bucket.push(issue);
    byLayer.set(layer, bucket);
  }

  const maxLayer = Math.max(...byLayer.keys(), 0);
  const maxRows = Math.max(
    ...[...byLayer.values()].map((layerIssues) => layerIssues.length),
    1,
  );
  const layerWidth = GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP;
  const layerHeight = GRAPH_NODE_HEIGHT + GRAPH_COLUMN_GAP;
  const rowWidth = GRAPH_NODE_WIDTH + GRAPH_ROW_GAP;
  const rowHeight = GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP;
  const width =
    orientation === "horizontal"
      ? Math.max(680, 48 + (maxLayer + 1) * layerWidth)
      : Math.max(420, 48 + maxRows * rowWidth);
  const height =
    orientation === "horizontal"
      ? Math.max(260, 48 + maxRows * rowHeight)
      : Math.max(260, 48 + (maxLayer + 1) * layerHeight);

  const nodes: GraphNodePosition[] = [];
  for (const [layer, layerIssues] of [...byLayer.entries()].sort(
    ([a], [b]) => a - b,
  )) {
    layerIssues.sort((a, b) => a.id.localeCompare(b.id));
    const layerContentSize =
      orientation === "horizontal"
        ? layerIssues.length * GRAPH_NODE_HEIGHT +
          (layerIssues.length - 1) * GRAPH_ROW_GAP
        : layerIssues.length * GRAPH_NODE_WIDTH +
          (layerIssues.length - 1) * GRAPH_ROW_GAP;
    const crossAxisOffset =
      ((orientation === "horizontal" ? height : width) - layerContentSize) / 2;

    layerIssues.forEach((issue, index) => {
      nodes.push({
        issue,
        layer,
        x:
          orientation === "horizontal"
            ? 24 + layer * layerWidth
            : crossAxisOffset + index * rowWidth,
        y:
          orientation === "horizontal"
            ? crossAxisOffset + index * rowHeight
            : 24 + layer * layerHeight,
      });
    });
  }

  return orientation === "horizontal"
    ? {
        nodes,
        width,
        height,
      }
    : {
        nodes,
        width,
        height,
      };
}
