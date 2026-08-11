import { describe, expect, it } from "vitest";
import { buildDependencyEdges } from "./dependency-graph";
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
