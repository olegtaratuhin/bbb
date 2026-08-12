import { describe, expect, it } from "vitest";
import { chooseDefaultBeadsProject } from "./project-selection";

const projects = [{ id: "project-a" }, { id: "project-b" }];

describe("chooseDefaultBeadsProject", () => {
  it("prefers the currently open Beads-backed project", () => {
    expect(
      chooseDefaultBeadsProject({
        currentProjectId: "project-b",
        projects,
        threads: [{ projectId: "project-a", updatedAt: 20, isArchived: false }],
      }),
    ).toBe("project-b");
  });

  it("uses the latest non-archived thread when the current project is not Beads-backed", () => {
    expect(
      chooseDefaultBeadsProject({
        currentProjectId: "ordinary-project",
        projects,
        threads: [
          { projectId: "project-a", updatedAt: 20, isArchived: false },
          { projectId: "project-b", updatedAt: 30, isArchived: false },
          { projectId: "project-a", updatedAt: 40, isArchived: true },
        ],
      }),
    ).toBe("project-b");
  });

  it("falls back to the first Beads project without thread context", () => {
    expect(
      chooseDefaultBeadsProject({
        currentProjectId: null,
        projects,
        threads: [{ projectId: "ordinary-project", updatedAt: 50, isArchived: false }],
      }),
    ).toBe("project-a");
  });
});
