// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as React from "react";
import { QueryInput } from "./query-input";

afterEach(cleanup);

function renderInput(initialValue = "") {
  function Harness() {
    const [value, setValue] = React.useState(initialValue);
    return <QueryInput value={value} onChange={setValue} />;
  }

  return render(<Harness />);
}

describe("QueryInput", () => {
  it("shows completion choices and applies a clicked value", () => {
    renderInput("status=op");
    const input = screen.getByRole("textbox", { name: "Search Beads issues" });
    fireEvent.focus(input);

    const listbox = screen.getByRole("listbox", { name: "Beads query completions" });
    expect(within(listbox).getByRole("option", { name: "open" })).toBeTruthy();
    fireEvent.click(within(listbox).getByRole("option", { name: "open" }));

    expect((input as HTMLInputElement).value).toBe("status=open");
  });

  it("supports keyboard navigation and completion acceptance", () => {
    renderInput("prio");
    const input = screen.getByRole("textbox", { name: "Search Beads issues" });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect((input as HTMLInputElement).value).toBe("priority");
  });

  it("renders syntax highlighting and an accessible diagnostic for invalid queries", () => {
    renderInput("priority=9");
    const input = screen.getByRole("textbox", { name: "Search Beads issues" });
    fireEvent.focus(input);

    expect(screen.getByTestId("beads-query-highlight").textContent).toBe("priority=9");
    const diagnostic = screen.getByRole("alert");
    expect(diagnostic.textContent).toContain("from 0 to 4");
    expect(input.getAttribute("aria-describedby")).toBe("beads-query-diagnostics");
  });

  it("keeps ordinary text search visually plain and without query diagnostics", () => {
    renderInput("authentication bug");
    const input = screen.getByRole("textbox", { name: "Search Beads issues" });
    fireEvent.focus(input);

    expect(screen.queryByTestId("beads-query-highlight")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });
});
