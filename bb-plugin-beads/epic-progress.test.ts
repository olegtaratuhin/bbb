import { describe, it, expect } from "vitest";
import {
  buildEpicProgress,
  getUnassignedWorkIssues,
  isContainerIssue,
  type EpicProgress,
} from "./epic-progress";
import type { Issue } from "./bd-client";

// ── Helpers ──────────────────────────────────────────────────────────────────

function issue(overrides: Partial<Issue> & { id: string }): Issue {
  return {
    id: overrides.id,
    title: overrides.title ?? "",
    labels: overrides.labels ?? [],
    dependencies: overrides.dependencies ?? [],
    dependents: overrides.dependents ?? [],
    ...(overrides as Record<string, unknown>),
  };
}

// ── isContainerIssue ─────────────────────────────────────────────────────────

describe("isContainerIssue", () => {
  it("returns true for epic type", () => {
    expect(isContainerIssue(issue({ id: "1", issue_type: "epic" }))).toBe(true);
  });

  it("returns true for milestone type", () => {
    expect(isContainerIssue(issue({ id: "1", issue_type: "milestone" }))).toBe(true);
  });

  it("returns false for task type", () => {
    expect(isContainerIssue(issue({ id: "1", issue_type: "task" }))).toBe(false);
  });

  it("returns false for undefined type", () => {
    expect(isContainerIssue(issue({ id: "1" }))).toBe(false);
  });
});

// ── buildEpicProgress: empty input ───────────────────────────────────────────

describe("buildEpicProgress — empty input", () => {
  it("returns empty array for empty input", () => {
    expect(buildEpicProgress([])).toEqual([]);
  });

  it("returns empty array for no containers", () => {
    const issues: Issue[] = [
      issue({ id: "a", issue_type: "task", status: "open" }),
      issue({ id: "b", issue_type: "bug", status: "closed" }),
    ];
    expect(buildEpicProgress(issues)).toEqual([]);
  });

  it("handles container with no children", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic", title: "Epic" }),
    ];
    const result = buildEpicProgress(issues);
    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(0);
    expect(result[0].completed).toBe(0);
    expect(result[0].percentage).toBe(0);
    expect(result[0].statusCounts).toEqual({});
  });
});

// ── buildEpicProgress: direct children ───────────────────────────────────────

describe("buildEpicProgress — direct children", () => {
  it("counts direct work children", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic", title: "Epic" }),
      issue({ id: "t1", issue_type: "task", status: "open", parent: "epic-1" }),
      issue({ id: "t2", issue_type: "task", status: "in_progress", parent: "epic-1" }),
      issue({ id: "t3", issue_type: "task", status: "closed", parent: "epic-1" }),
    ];
    const result = buildEpicProgress(issues);
    expect(result).toHaveLength(1);
    const ep = result[0];
    expect(ep.total).toBe(3);
    expect(ep.completed).toBe(1);
    expect(ep.percentage).toBe(33); // round(1/3 * 100) = 33
    expect(ep.statusCounts).toEqual({ open: 1, in_progress: 1, closed: 1 });
  });

  it("handles missing parent reference gracefully", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic", title: "Epic" }),
      // parent points to a non-existent issue — orphan child, not counted
      issue({ id: "t1", issue_type: "task", status: "open", parent: "nonexistent" }),
    ];
    const result = buildEpicProgress(issues);
    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(0);
  });

  it("ignores container children in total count", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic" }),
      // Nested container — not a work issue, should not be counted as total
      issue({ id: "sub", issue_type: "milestone", parent: "epic-1" }),
    ];
    const result = buildEpicProgress(issues);
    // Both epic and milestone are containers, each gets an entry
    expect(result).toHaveLength(2);
    const epic = result.find((e) => e.container.id === "epic-1")!;
    const sub = result.find((e) => e.container.id === "sub")!;
    expect(epic.total).toBe(0);
    expect(sub.total).toBe(0);
  });
});

// ── buildEpicProgress: nested descendants ────────────────────────────────────

describe("buildEpicProgress — nested descendants", () => {
  it("counts work issues through nested containers", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic" }),
      issue({ id: "sub-1", issue_type: "milestone", parent: "epic-1" }),
      issue({ id: "t1", issue_type: "task", status: "open", parent: "sub-1" }),
      issue({ id: "t2", issue_type: "task", status: "closed", parent: "sub-1" }),
      // Direct child of epic
      issue({ id: "t3", issue_type: "task", status: "blocked", parent: "epic-1" }),
    ];
    const result = buildEpicProgress(issues);
    // Both epic and milestone are containers
    expect(result).toHaveLength(2);

    const epic = result.find((e) => e.container.id === "epic-1")!;
    // Epic sees all 3 work descendants (through sub-1 and direct)
    expect(epic.total).toBe(3);
    expect(epic.completed).toBe(1);
    expect(epic.percentage).toBe(33);
    expect(epic.statusCounts).toEqual({ open: 1, closed: 1, blocked: 1 });

    const sub = result.find((e) => e.container.id === "sub-1")!;
    // Milestone only sees its 2 direct work children
    expect(sub.total).toBe(2);
    expect(sub.completed).toBe(1);
    expect(sub.percentage).toBe(50);
  });

  it("handles deeply nested containers (3 levels)", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic" }),
      issue({ id: "sub-1", issue_type: "milestone", parent: "epic-1" }),
      issue({ id: "sub-2", issue_type: "milestone", parent: "sub-1" }),
      issue({ id: "t1", issue_type: "task", status: "closed", parent: "sub-2" }),
    ];
    const result = buildEpicProgress(issues);
    // All three containers get entries
    expect(result).toHaveLength(3);

    const epic = result.find((e) => e.container.id === "epic-1")!;
    expect(epic.total).toBe(1);
    expect(epic.completed).toBe(1);
    expect(epic.percentage).toBe(100);

    const sub1 = result.find((e) => e.container.id === "sub-1")!;
    expect(sub1.total).toBe(1);
    expect(sub1.completed).toBe(1);

    const sub2 = result.find((e) => e.container.id === "sub-2")!;
    expect(sub2.total).toBe(1);
    expect(sub2.completed).toBe(1);
  });

  it("handles multiple epics independently", () => {
    const issues: Issue[] = [
      issue({ id: "epic-a", issue_type: "epic" }),
      issue({ id: "t1", issue_type: "task", status: "open", parent: "epic-a" }),
      issue({ id: "epic-b", issue_type: "epic" }),
      issue({ id: "t2", issue_type: "task", status: "closed", parent: "epic-b" }),
      issue({ id: "t3", issue_type: "task", status: "closed", parent: "epic-b" }),
    ];
    const result = buildEpicProgress(issues);
    expect(result).toHaveLength(2);

    const epicA = result.find((e) => e.container.id === "epic-a")!;
    expect(epicA.total).toBe(1);
    expect(epicA.completed).toBe(0);
    expect(epicA.percentage).toBe(0);

    const epicB = result.find((e) => e.container.id === "epic-b")!;
    expect(epicB.total).toBe(2);
    expect(epicB.completed).toBe(2);
    expect(epicB.percentage).toBe(100);
  });
});

// ── buildEpicProgress: closed percentage ─────────────────────────────────────

describe("buildEpicProgress — closed percentage", () => {
  it("calculates 0% when nothing is closed", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic" }),
      issue({ id: "t1", issue_type: "task", status: "open", parent: "epic-1" }),
      issue({ id: "t2", issue_type: "task", status: "in_progress", parent: "epic-1" }),
    ];
    const result = buildEpicProgress(issues);
    expect(result[0].percentage).toBe(0);
  });

  it("calculates 100% when all are closed", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic" }),
      issue({ id: "t1", issue_type: "task", status: "closed", parent: "epic-1" }),
      issue({ id: "t2", issue_type: "task", status: "closed", parent: "epic-1" }),
    ];
    const result = buildEpicProgress(issues);
    expect(result[0].percentage).toBe(100);
  });

  it("rounds percentage correctly (2 out of 3 = 67%)", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic" }),
      issue({ id: "t1", issue_type: "task", status: "closed", parent: "epic-1" }),
      issue({ id: "t2", issue_type: "task", status: "closed", parent: "epic-1" }),
      issue({ id: "t3", issue_type: "task", status: "open", parent: "epic-1" }),
    ];
    const result = buildEpicProgress(issues);
    expect(result[0].percentage).toBe(67);
  });

  it("treats issues without status as open", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic" }),
      issue({ id: "t1", issue_type: "task", parent: "epic-1" }), // no status
    ];
    const result = buildEpicProgress(issues);
    expect(result[0].statusCounts).toEqual({ open: 1 });
    expect(result[0].completed).toBe(0);
  });
});

// ── buildEpicProgress: status counts ─────────────────────────────────────────

describe("buildEpicProgress — status counts", () => {
  it("counts all status values including deferred", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic" }),
      issue({ id: "t1", issue_type: "task", status: "open", parent: "epic-1" }),
      issue({ id: "t2", issue_type: "task", status: "in_progress", parent: "epic-1" }),
      issue({ id: "t3", issue_type: "task", status: "blocked", parent: "epic-1" }),
      issue({ id: "t4", issue_type: "task", status: "deferred", parent: "epic-1" }),
      issue({ id: "t5", issue_type: "task", status: "closed", parent: "epic-1" }),
    ];
    const result = buildEpicProgress(issues);
    expect(result[0].statusCounts).toEqual({
      open: 1,
      in_progress: 1,
      blocked: 1,
      deferred: 1,
      closed: 1,
    });
  });
});

// ── getUnassignedWorkIssues ──────────────────────────────────────────────────

describe("getUnassignedWorkIssues — empty and basic", () => {
  it("returns empty array for empty input", () => {
    expect(getUnassignedWorkIssues([])).toEqual([]);
  });

  it("returns empty when all work issues have a container", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic" }),
      issue({ id: "t1", issue_type: "task", parent: "epic-1" }),
    ];
    expect(getUnassignedWorkIssues(issues)).toEqual([]);
  });

  it("identifies orphan work issues (no parent)", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic" }),
      issue({ id: "t1", issue_type: "task", status: "open" }), // no parent
    ];
    const result = getUnassignedWorkIssues(issues);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("identifies work issues with missing parent reference", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic" }),
      issue({ id: "t1", issue_type: "task", parent: "nonexistent" }),
    ];
    const result = getUnassignedWorkIssues(issues);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("excludes containers from unassigned list", () => {
    const issues: Issue[] = [
      issue({ id: "epic-1", issue_type: "epic" }), // no parent, but is a container
      issue({ id: "ms-1", issue_type: "milestone" }), // no parent, but is a container
      issue({ id: "t1", issue_type: "task" }), // no parent, is work
    ];
    const result = getUnassignedWorkIssues(issues);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("identifies work issues whose parent chain has no container", () => {
    const issues: Issue[] = [
      // Parent is a task, not a container — chain has no container
      issue({ id: "t-parent", issue_type: "task" }),
      issue({ id: "t1", issue_type: "task", parent: "t-parent" }),
    ];
    const result = getUnassignedWorkIssues(issues);
    expect(result).toHaveLength(2); // Both are unassigned work issues
    expect(result.map((i) => i.id)).toContain("t-parent");
    expect(result.map((i) => i.id)).toContain("t1");
  });

  it("recognizes milestone as valid container ancestor", () => {
    const issues: Issue[] = [
      issue({ id: "ms-1", issue_type: "milestone" }),
      issue({ id: "t1", issue_type: "task", parent: "ms-1" }),
    ];
    const result = getUnassignedWorkIssues(issues);
    expect(result).toHaveLength(0);
  });
});
