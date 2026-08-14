// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BeadsToolbarFrame } from "./responsive-toolbar";

afterEach(cleanup);

function renderToolbar() {
  return render(
    <BeadsToolbarFrame>
      <div data-testid="primary-row">
        <label>
          Project
          <select aria-label="Beads project"><option>Project</option></select>
        </label>
        <label>
          Scope
          <select aria-label="Issue scope"><option>All issues</option></select>
        </label>
        <div role="group" aria-label="Issue view">
          <button type="button" aria-label="Kanban board view">Kanban</button>
          <button type="button" aria-label="List view">List</button>
          <button type="button" aria-label="Dependency graph view">Graph</button>
        </div>
        <button type="button" aria-label="Refresh issues">Refresh</button>
        <button type="button">New task</button>
        <button type="button" aria-label="Show epic sidebar">Epics</button>
      </div>
      <div data-testid="secondary-row">
        <input aria-label="Search Beads issues" />
        <button type="button" aria-label="Open quick filters">Quick filters</button>
        <span aria-label="Issue count">12 issues</span>
        <button type="button" aria-label="Sort filter">Sort</button>
      </div>
    </BeadsToolbarFrame>,
  );
}

describe("Beads toolbar layout contract", () => {
  it("keeps every required control in one reachable DOM surface", () => {
    renderToolbar();
    const toolbar = screen.getByTestId("beads-toolbar");
    expect(within(toolbar).getByRole("combobox", { name: "Beads project" })).toBeTruthy();
    expect(within(toolbar).getByRole("combobox", { name: "Issue scope" })).toBeTruthy();
    expect(within(toolbar).getAllByRole("button")).toHaveLength(8);
    expect(within(toolbar).getByRole("textbox", { name: "Search Beads issues" })).toBeTruthy();
    expect(within(toolbar).getByLabelText("Issue count").textContent).toContain("12 issues");
  });

  it("keeps count and sort outside the filter controls", () => {
    renderToolbar();
    const secondary = screen.getByTestId("secondary-row");
    expect(secondary.contains(screen.getByLabelText("Issue count"))).toBe(true);
    expect(secondary.contains(screen.getByRole("button", { name: "Sort filter" }))).toBe(true);
    expect(screen.getByTestId("beads-toolbar").className).toContain("shrink-0");
  });
});
