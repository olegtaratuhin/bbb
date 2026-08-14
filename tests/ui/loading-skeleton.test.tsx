// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IssueViewSkeleton } from "../../loading-skeleton";

afterEach(cleanup);

describe("IssueViewSkeleton", () => {
  it.each([
    ["kanban", "beads-skeleton-kanban"],
    ["list", "beads-skeleton-list"],
    ["graph", "beads-skeleton-graph"],
    ["epics", "beads-skeleton-epics"],
  ] as const)("renders a shape for the %s view", (viewMode, testId) => {
    render(<IssueViewSkeleton viewMode={viewMode} />);
    expect(screen.getByTestId(testId)).toBeTruthy();
  });
});
