import { describe, expect, it } from "vitest";
import type { Issue } from "../../beads/bd-client";
import {
  applyIssueStatus,
  kanbanDropStatus,
  kanbanStatus,
} from "../../ui/kanban-board";

function issue(id: string, status?: string): Issue {
  return { id, title: id, status, labels: [], dependencies: [], dependents: [] };
}

describe("kanbanStatus", () => {
  it("keeps supported statuses in their own columns", () => {
    expect(kanbanStatus("in_progress")).toBe("in_progress");
  });

  it("keeps unknown statuses visible in the Other column", () => {
    expect(kanbanStatus("custom_state")).toBe("__other");
    expect(kanbanStatus(undefined)).toBe("__other");
  });
});

describe("kanbanDropStatus", () => {
  const targets = [
    { status: "open" as const, left: 0, right: 100, top: 0, bottom: 400 },
    { status: "closed" as const, left: 110, right: 210, top: 0, bottom: 400 },
  ];

  it("finds the column under the pointer", () => {
    expect(kanbanDropStatus(targets, 140, 280)).toBe("closed");
  });

  it("rejects pointers outside the column bounds", () => {
    expect(kanbanDropStatus(targets, 220, 280)).toBeNull();
    expect(kanbanDropStatus(targets, 140, 440)).toBeNull();
  });
});

describe("applyIssueStatus", () => {
  it("updates only the dragged issue and preserves ordering", () => {
    const result = applyIssueStatus(
      [issue("a", "open"), issue("b", "closed")],
      "a",
      "closed",
    );
    expect(result.map((item) => [item.id, item.status])).toEqual([
      ["a", "closed"],
      ["b", "closed"],
    ]);
  });
});
