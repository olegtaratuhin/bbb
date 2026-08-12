// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as React from "react";
import { QueryAssist } from "./query-assist";

afterEach(() => {
  cleanup();
  if (window.localStorage) window.localStorage.clear();
});

function renderAssist(initialQuery = "") {
  function Harness() {
    const [query, setQuery] = React.useState(initialQuery);
    return (
      <>
        <QueryAssist query={query} onQueryChange={setQuery} />
        <output data-testid="query-output">{query}</output>
      </>
    );
  }

  return render(<Harness />);
}

function openAssist() {
  fireEvent.click(screen.getByRole("button", { name: "Open quick filters" }));
  return screen.getByRole("dialog");
}

describe("QueryAssist", () => {
  it("applies a schema-backed quick preset and closes", () => {
    renderAssist();
    const dialog = openAssist();

    fireEvent.click(within(dialog).getByRole("button", { name: /Open Issues/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("query-output").textContent).toBe("status=open");
  });

  it("builds and applies a compound query with schema-constrained values", () => {
    renderAssist();
    const dialog = openAssist();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Build a query" }));

    fireEvent.change(within(dialog).getByRole("combobox", { name: "Filter 1 field" }), {
      target: { value: "status" },
    });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Filter 1 value" }), {
      target: { value: "open" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add filter" }));
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Filter 2 field" }), {
      target: { value: "priority" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Filter 2 value" }), {
      target: { value: "0" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply filters" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("query-output").textContent).toBe("status=open AND priority=0");
  });

  it("reports incomplete builder rows instead of emitting a query", () => {
    renderAssist();
    const dialog = openAssist();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Build a query" }));
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Filter 1 field" }), {
      target: { value: "status" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply filters" }));

    expect(within(dialog).getByRole("alert").textContent).toContain("Enter a value");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("keeps the raw query unchanged when assistance is dismissed", () => {
    renderAssist("status=open");
    const dialog = openAssist();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Build a query" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.getByTestId("query-output").textContent).toBe("status=open");
  });

  it("can compose a preset with an existing valid query", () => {
    renderAssist("type=bug");
    const dialog = openAssist();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add with AND" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Open Issues/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("query-output").textContent).toBe("(type=bug) AND (status=open)");
  });

  it("offers valid examples and records applied queries locally", () => {
    renderAssist();
    let dialog = openAssist();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Examples" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Bugs or features/ }));

    expect(screen.getByTestId("query-output").textContent).toBe("type=bug OR type=feature");

    dialog = openAssist();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Examples" }));
    expect(within(dialog).getAllByText("type=bug OR type=feature").length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole("button", { name: /Remove recent query/ }));
    expect(within(dialog).getByText("Queries you apply are kept only on this device.")).toBeTruthy();
  });
});
