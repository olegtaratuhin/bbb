import { describe, expect, it } from "vitest";
import { applyCompletion, createQueryEditorModel } from "../../query-core/editor-model";
import {
  describeQueryExecution,
  QUERY_EXECUTION_DEBOUNCE_MS,
} from "../../query-core/execution";

describe("query editor model", () => {
  it("projects syntax, diagnostics, and completions without UI dependencies", () => {
    const model = createQueryEditorModel("status=", 7);
    expect(model.queryMode).toBe(true);
    expect(model.diagnostics[0]).toMatchObject({ code: "expected-value" });
    expect(model.completions.map((item) => item.label)).toContain("open");
    expect(model.highlights.map((span) => span.kind)).toEqual(["field", "operator"]);
  });

  it("applies a completion and returns the next cursor position", () => {
    const model = createQueryEditorModel("prio", 4);
    const result = applyCompletion(model.source, model.completions[0]!);
    expect(result).toEqual({ source: "priority", cursor: 8 });
  });
});

describe("query execution policy", () => {
  it("distinguishes ordinary text, valid queries, and invalid queries", () => {
    expect(describeQueryExecution("").mode).toBe("empty");
    expect(describeQueryExecution("authentication bug").mode).toBe("text");
    expect(describeQueryExecution("status=open").mode).toBe("query");
    expect(describeQueryExecution("status=").mode).toBe("invalid");
  });

  it("keeps invalid queries out of the backend payload", () => {
    const state = describeQueryExecution("priority=9");
    expect(state.query).toBe("");
    expect(state.diagnostics[0]?.code).toBe("invalid-number");
    expect(QUERY_EXECUTION_DEBOUNCE_MS).toBeGreaterThan(0);
  });
});
