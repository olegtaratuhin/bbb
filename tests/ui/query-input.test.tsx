// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as React from "react";
import { QueryInput } from "../../ui/query-input";

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
    expect(screen.getAllByTestId("beads-query-completion-surface")).toHaveLength(1);
    expect(listbox.getAttribute("aria-orientation")).toBe("vertical");
    expect(listbox.className).toContain("fixed");
    expect(within(listbox).getByRole("option", { name: "open" }).classList.contains("min-h-11")).toBe(true);
    expect(within(listbox).getByRole("option", { name: "open" }).className).toContain("max-md:pointer-coarse:min-h-12");
    expect(within(listbox).getByRole("option", { name: "open" })).toBeTruthy();
    fireEvent.click(within(listbox).getByRole("option", { name: "open" }));

    expect((input as HTMLInputElement).value).toBe("status=open");
  });

  it("keeps query highlighting aligned with the input when value completion opens", () => {
    renderInput("status=");
    const input = screen.getByRole("textbox", { name: "Search Beads issues" });
    fireEvent.focus(input);

    const highlight = screen.getByTestId("beads-query-highlight");
    const listbox = screen.getByRole("listbox", { name: "Beads query completions" });

    expect(highlight.textContent).toBe("status=");
    expect(highlight.className).toContain("inset-x-px");
    expect(highlight.className).toContain("inset-y-px");
    expect(highlight.className).toContain("font-[inherit]");
    expect(input.className).toContain("font-[inherit]");
    expect(input.className).toContain("leading-5");
    expect(listbox.className).toContain("fixed");
    expect(listbox.className).toContain("z-50");
    expect(listbox.className).toContain("top-[var(--beads-query-completion-top)]");
    expect(listbox.parentElement).toBe(document.body);
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

  it("dismisses the single completion surface with Escape", () => {
    renderInput("status=op");
    const input = screen.getByRole("textbox", { name: "Search Beads issues" });
    (input as HTMLInputElement).focus();
    fireEvent.focus(input);
    expect(screen.getAllByTestId("beads-query-completion-surface")).toHaveLength(1);

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByTestId("beads-query-completion-surface")).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("routes an applied mobile preset through the controlled query value", () => {
    renderInput();
    const input = screen.getByRole("textbox", { name: "Search Beads issues" });
    fireEvent.click(screen.getByRole("button", { name: "Open quick filters" }));
    fireEvent.click(screen.getByRole("button", { name: /Open Issues/ }));

    expect((input as HTMLInputElement).value).toBe("status=open");
  });

  it("renders syntax highlighting and an accessible diagnostic for invalid queries", () => {
    renderInput("priority=9");
    const input = screen.getByRole("textbox", { name: "Search Beads issues" });
    fireEvent.focus(input);

    expect(screen.getByTestId("beads-query-highlight").textContent).toBe("priority=9");
    const diagnostic = screen.getByRole("alert");
    expect(diagnostic.textContent).toContain("from 0 to 4");
    expect(diagnostic.className).toContain("fixed");
    expect(diagnostic.parentElement).toBe(document.body);
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
