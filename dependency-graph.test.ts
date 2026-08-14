import { describe, expect, it } from "vitest";
import {
  buildDependencyEdges,
  layoutDependencyGraph,
} from "./dependency-graph";
import type { Issue } from "./bd-client";

function issue(
  id: string,
  dependencies: Issue["dependencies"] = [],
): Issue {
  return {
    id,
    title: id,
    labels: [],
    dependencies,
    dependents: [],
  };
}

describe("buildDependencyEdges", () => {
  it("draws blockers toward the issue they unblock", () => {
    const edges = buildDependencyEdges([
      issue("A"),
      issue("B", [
        { issue_id: "B", depends_on_id: "A", type: "blocks" },
      ]),
    ]);

    expect(edges).toEqual([
      {
        id: "B:A:blocks",
        fromId: "A",
        toId: "B",
        type: "blocks",
        relation: "blocking",
        directed: true,
      },
    ]);
  });

  it("keeps hierarchy and related edges visually distinct", () => {
    const edges = buildDependencyEdges([
      issue("P"),
      issue("C", [
        { issue_id: "C", depends_on_id: "P", type: "parent-child" },
      ]),
      issue("R", [
        { issue_id: "R", depends_on_id: "P", type: "related" },
      ]),
    ]);

    expect(edges.map(({ relation, directed }) => [relation, directed])).toEqual([
      ["hierarchy", true],
      ["related", false],
    ]);
  });

  it("omits edges whose endpoints are outside the current scope", () => {
    expect(
      buildDependencyEdges([
        issue("A"),
        issue("B", [
          { issue_id: "B", depends_on_id: "missing", type: "blocks" },
        ]),
      ]),
    ).toEqual([]);
  });
});

describe("layoutDependencyGraph", () => {
  it("keeps the default dependency flow horizontal", () => {
    const issues = [
      issue("A"),
      issue("B", [{ issue_id: "B", depends_on_id: "A", type: "blocks" }]),
    ];
    const layout = layoutDependencyGraph(issues, buildDependencyEdges(issues));
    const positions = new Map(layout.nodes.map((node) => [node.issue.id, node]));

    expect(positions.get("B")?.x).toBeGreaterThan(positions.get("A")?.x ?? 0);
    expect(positions.get("B")?.y).toBe(96);
    expect(positions.get("A")?.y).toBe(positions.get("B")?.y);
  });

  it("rotates dependency flow vertically without changing its layers", () => {
    const issues = [
      issue("A"),
      issue("B", [{ issue_id: "B", depends_on_id: "A", type: "blocks" }]),
    ];
    const layout = layoutDependencyGraph(
      issues,
      buildDependencyEdges(issues),
      "vertical",
    );
    const positions = new Map(layout.nodes.map((node) => [node.issue.id, node]));

    expect(positions.get("B")?.y).toBeGreaterThan(positions.get("A")?.y ?? 0);
    expect(positions.get("B")?.x).toBe(112);
    expect(positions.get("A")?.x).toBe(positions.get("B")?.x);
  });

  it("keeps isolated issues visible, including closed ones", () => {
    const closedIssue = { ...issue("closed"), status: "closed" };
    const layout = layoutDependencyGraph([closedIssue], []);

    expect(layout.nodes.map((node) => node.issue.id)).toEqual(["closed"]);
  });
});
