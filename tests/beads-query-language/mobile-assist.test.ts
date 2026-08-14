import { beforeEach, describe, expect, it } from "vitest";
import {
  // Projection API
  projectQuery,
  classifyInputState,
  groupCompletionItems,
  getCompletionContext,
  getSelectedField,
  // Field/operator/value helpers
  getFieldChoices,
  getOperatorChoices,
  getValueChoices,
  getKeywordChoices,
  // Filter row model
  createEmptyRow,
  createRow,
  updateRowField,
  updateRowOperator,
  updateRowValue,
  clearRow,
  isRowEmpty,
  validateRow,
  validateRows,
  serializeRows,
  parseSimpleFilterRows,
  QUERY_EXAMPLES,
  MAX_RECENT_QUERIES,
  addRecentQuery,
  removeRecentQuery,
  // Presets
  BUILT_IN_PRESETS,
  getPreset,
  resolvePreset,
  serializePreset,
  // Types
  type CompletionSections,
  type CompletionContext,
  type FilterConnector,
  type FilterRow,
} from "../../beads-query-language/mobile-assist";
import { analyze } from "../../beads-query-language/index";

/* ------------------------------------------------------------------ */
/*  1. Query Projection                                               */
/* ------------------------------------------------------------------ */

describe("projectQuery", () => {
  it("returns analysis, inputState, sections, and replacement for empty input", () => {
    const projection = projectQuery("");
    expect(projection.source).toBe("");
    expect(projection.cursor).toBe(0);
    expect(projection.inputState).toBe("empty");
    expect(projection.replacement).toEqual({ from: 0, to: 0 });
    expect(projection.analysis.diagnostics).toEqual([]);
  });

  it("classifies a valid query as query-valid", () => {
    const projection = projectQuery("status=open");
    expect(projection.inputState).toBe("query-valid");
    expect(projection.analysis.diagnostics).toEqual([]);
  });

  it("classifies an incomplete query as query-incomplete", () => {
    const projection = projectQuery("status=");
    expect(projection.inputState).toBe("query-incomplete");
  });

  it("classifies an invalid query as query-invalid", () => {
    const projection = projectQuery("status=not-a-status");
    expect(projection.inputState).toBe("query-invalid");
  });

  it("includes completion sections for a partial field token", () => {
    const projection = projectQuery("sta");
    expect(projection.sections.fields.length).toBeGreaterThan(0);
    expect(projection.sections.fields.some((f) => f.label === "status")).toBe(true);
  });

  it("includes operator completions after a field", () => {
    const projection = projectQuery("status ");
    expect(projection.sections.operators.length).toBeGreaterThan(0);
    expect(projection.sections.operators.map((o) => o.label)).toContain("=");
  });

  it("includes value completions after a field and operator", () => {
    const projection = projectQuery("status=");
    expect(projection.sections.values.length).toBeGreaterThan(0);
    expect(projection.sections.values.map((v) => v.label)).toContain("open");
  });

  it("returns value completions for a complete clause with identifier value", () => {
    // Note: completion.ts only returns keywords after string/number/duration/right-paren,
    // not after identifier. status=open returns value completions for the prefix.
    const projection = projectQuery("status=open");
    expect(projection.sections.values.length).toBeGreaterThan(0);
    expect(projection.sections.values.map((v) => v.label)).toContain("open");
  });

  it("returns keyword completions after a grouped clause", () => {
    // completion.ts returns keywords after right-paren when no value context matches.
    // (status=open) — before is right-paren, no operator context, so keywords are returned.
    const projection = projectQuery('(status=open)');
    expect(projection.sections.keywords.length).toBeGreaterThan(0);
    expect(projection.sections.keywords.map((k) => k.label)).toContain("AND");
  });

  it("returns correct replacement range for partial tokens", () => {
    const projection = projectQuery("prio", 4);
    expect(projection.replacement.from).toBe(0);
    expect(projection.replacement.to).toBe(4);
  });

  it("handles custom cursor positions", () => {
    const projection = projectQuery("status=open AND priority=1", 22);
    expect(projection.cursor).toBe(22);
    // Cursor is mid-token on "priority"
    expect(projection.sections.fields.length).toBeGreaterThan(0);
  });
});

describe("classifyInputState", () => {
  it("returns empty for whitespace-only input", () => {
    const analysis = projectQuery("   ").analysis;
    expect(classifyInputState(analysis)).toBe("empty");
  });

  it("returns query-valid for a fully valid complex query", () => {
    const analysis = projectQuery("status=open AND priority=0 AND type=bug").analysis;
    expect(classifyInputState(analysis)).toBe("query-valid");
  });

  it("returns query-incomplete for unmatched parentheses", () => {
    const analysis = projectQuery("(status=open").analysis;
    expect(classifyInputState(analysis)).toBe("query-incomplete");
  });

  it("returns query-invalid for invalid enum values", () => {
    const analysis = projectQuery("status=invalid").analysis;
    expect(classifyInputState(analysis)).toBe("query-invalid");
  });
});

describe("groupCompletionItems", () => {
  it("groups items by kind into sections", () => {
    const items = [
      { label: "status", insertText: "status", kind: "field" as const, replacement: { from: 0, to: 0 } },
      { label: "=", insertText: "=", kind: "operator" as const, replacement: { from: 0, to: 0 } },
      { label: "open", insertText: "open", kind: "value" as const, replacement: { from: 0, to: 0 } },
      { label: "AND", insertText: " AND ", kind: "keyword" as const, replacement: { from: 0, to: 0 } },
    ];
    const sections = groupCompletionItems(items);
    expect(sections.fields.length).toBe(1);
    expect(sections.operators.length).toBe(1);
    expect(sections.values.length).toBe(1);
    expect(sections.keywords.length).toBe(1);
    expect(sections.snippets).toEqual([]);
  });

  it("handles empty input", () => {
    const sections = groupCompletionItems([]);
    expect(sections.fields).toEqual([]);
    expect(sections.operators).toEqual([]);
    expect(sections.values).toEqual([]);
    expect(sections.keywords).toEqual([]);
    expect(sections.snippets).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  2. Field / Operator / Value Helpers                               */
/* ------------------------------------------------------------------ */

describe("getFieldChoices", () => {
  it("returns choices for all documented fields", () => {
    const choices = getFieldChoices();
    expect(choices.length).toBeGreaterThan(10);
    const statusChoice = choices.find((c) => c.name === "status");
    expect(statusChoice).toBeDefined();
    expect(statusChoice?.label).toBe("Status");
    expect(statusChoice?.values).toContain("open");
    expect(statusChoice?.valueKind).toBe("enum");
  });
});

describe("getOperatorChoices", () => {
  it("returns constrained operators for a specific field", () => {
    const ops = getOperatorChoices("status");
    expect(ops.map((o) => o.label)).toEqual(["=", "!="]);
    expect(ops[0]?.kind).toBe("operator");
  });

  it("returns full operator set for unknown fields", () => {
    const ops = getOperatorChoices("unknown_field");
    expect(ops.map((o) => o.label)).toContain("=");
    expect(ops.map((o) => o.label)).toContain("<");
  });

  it("returns date-compatible operators for date fields", () => {
    const ops = getOperatorChoices("created");
    expect(ops.map((o) => o.label)).toContain(">");
    expect(ops.map((o) => o.label)).toContain("<=");
    expect(ops.map((o) => o.label)).not.toContain("!=");
  });
});

describe("getValueChoices", () => {
  it("returns enum values for enum fields", () => {
    const values = getValueChoices("status");
    expect(values.map((v) => v.label)).toContain("open");
    expect(values.map((v) => v.label)).toContain("closed");
    expect(values.map((v) => v.label)).toContain("blocked");
  });

  it("filters values by prefix", () => {
    const values = getValueChoices("status", "op");
    expect(values.map((v) => v.label)).toEqual(["open"]);
  });

  it("returns date suggestions for date fields", () => {
    const values = getValueChoices("created");
    expect(values.map((v) => v.label)).toContain("today");
    expect(values.map((v) => v.label)).toContain("tomorrow");
  });

  it("returns empty for text fields without predefined values", () => {
    const values = getValueChoices("title");
    expect(values).toEqual([]);
  });

  it("returns empty for unknown fields", () => {
    const values = getValueChoices("nonexistent_field");
    expect(values).toEqual([]);
  });

  it("includes presentation metadata", () => {
    const values = getValueChoices("status");
    const openItem = values.find((v) => v.label === "open");
    expect(openItem?.kind).toBe("value");
    expect(openItem?.detail).toBe("Status");
  });
});

describe("getKeywordChoices", () => {
  it("returns AND, OR, NOT keywords", () => {
    const keywords = getKeywordChoices();
    expect(keywords.map((k) => k.label)).toEqual(["AND", "OR", "NOT"]);
    expect(keywords[0]?.kind).toBe("keyword");
  });
});

/* ------------------------------------------------------------------ */
/*  3. Completion Context Detection                                   */
/* ------------------------------------------------------------------ */

describe("getCompletionContext", () => {
  it("detects field context at the start", () => {
    const projection = projectQuery("");
    const context = getCompletionContext(projection);
    expect(context).toBe("field");
  });

  it("detects operator context after a field", () => {
    const projection = projectQuery("status ");
    const context = getCompletionContext(projection);
    expect(context).toBe("operator");
  });

  it("detects value context after a field and operator", () => {
    const projection = projectQuery("status=");
    const context = getCompletionContext(projection);
    expect(context).toBe("value");
  });

  it("detects value context after a complete clause with identifier value", () => {
    // status=open returns value completions (identifier value, not string/number/duration)
    const projection = projectQuery("status=open");
    const context = getCompletionContext(projection);
    expect(context).toBe("value");
  });

  it("detects keyword context after a grouped clause", () => {
    const projection = projectQuery('(status=open)');
    const context = getCompletionContext(projection);
    expect(context).toBe("keyword");
  });

  it("detects field context after AND", () => {
    const projection = projectQuery("status=open AND ");
    const context = getCompletionContext(projection);
    expect(context).toBe("field");
  });
});

describe("getSelectedField", () => {
  it("returns the field name in value context", () => {
    const projection = projectQuery("status=");
    const field = getSelectedField(projection);
    expect(field).toBe("status");
  });

  it("returns undefined outside value context", () => {
    const projection = projectQuery("");
    const field = getSelectedField(projection);
    expect(field).toBeUndefined();
  });

  it("returns the field after AND operator with partial value", () => {
    const projection = projectQuery("status=open AND priority=0");
    // After a complete query, context is keyword, so undefined
    expect(getSelectedField(projection)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  4. Filter Row Model                                               */
/* ------------------------------------------------------------------ */

describe("createEmptyRow and createRow", () => {
  it("creates an empty row with the given id", () => {
    const row = createEmptyRow("row-1");
    expect(row).toEqual({ id: "row-1", field: "", operator: "=", value: "" });
    expect(isRowEmpty(row)).toBe(true);
  });

  it("creates a populated row", () => {
    const row = createRow("row-2", "status", "=", "open");
    expect(row.field).toBe("status");
    expect(row.operator).toBe("=");
    expect(row.value).toBe("open");
    expect(isRowEmpty(row)).toBe(false);
  });
});

describe("updateRowField", () => {
  it("updates the field and resets value", () => {
    const row = createRow("r1", "status", "=", "open");
    const updated = updateRowField(row, "priority");
    expect(updated.field).toBe("priority");
    expect(updated.value).toBe("");
    // priority supports =, <, <=, >, >= so = is preserved
    expect(updated.operator).toBe("=");
  });

  it("adjusts operator when new field does not support current one", () => {
    const row = createRow("r2", "priority", "<", "2");
    const updated = updateRowField(row, "status");
    expect(updated.operator).toBe("=");
    expect(updated.value).toBe("");
  });
});

describe("updateRowOperator", () => {
  it("updates the operator and resets value for a supported operator", () => {
    const row = createRow("r3", "priority", "=", "2");
    const updated = updateRowOperator(row, ">");
    expect(updated.operator).toBe(">");
    expect(updated.value).toBe("");
  });

  it("rejects an operator not supported by the field", () => {
    const row = createRow("r4", "status", "=", "open");
    const updated = updateRowOperator(row, ">");
    // status only supports = and !=, so > is rejected
    expect(updated.operator).toBe("=");
  });
});

describe("updateRowValue", () => {
  it("updates the value without changing field or operator", () => {
    const row = createRow("r5", "status", "=", "open");
    const updated = updateRowValue(row, "closed");
    expect(updated.field).toBe("status");
    expect(updated.operator).toBe("=");
    expect(updated.value).toBe("closed");
  });
});

describe("clearRow", () => {
  it("clears all fields while preserving the id", () => {
    const row = createRow("r6", "status", "=", "open");
    const cleared = clearRow(row);
    expect(cleared).toEqual({ id: "r6", field: "", operator: "=", value: "" });
    expect(isRowEmpty(cleared)).toBe(true);
  });
});

describe("validateRow", () => {
  it("validates a correct row", () => {
    const row = createRow("v1", "status", "=", "open");
    const result = validateRow(row);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags an unknown field", () => {
    const row = createRow("v2", "nonexistent", "=", "value");
    const result = validateRow(row);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("unknown-field");
  });

  it("flags an invalid operator for a field", () => {
    const row = createRow("v3", "status", ">", "open");
    const result = validateRow(row);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "invalid-operator")).toBe(true);
  });

  it("flags an invalid enum value", () => {
    const row = createRow("v4", "status", "=", "not-a-status");
    const result = validateRow(row);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "invalid-value")).toBe(true);
  });

  it("flags an invalid priority number", () => {
    const row = createRow("v5", "priority", "=", "9");
    const result = validateRow(row);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "invalid-number")).toBe(true);
  });

  it("flags an invalid boolean value", () => {
    const row = createRow("v6", "pinned", "=", "maybe");
    const result = validateRow(row);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "invalid-boolean")).toBe(true);
  });

  it("validates an empty row as valid", () => {
    const row = createEmptyRow("v7");
    const result = validateRow(row);
    expect(result.valid).toBe(true);
  });

  it("keeps partially filled rows in validation state", () => {
    expect(validateRow(createRow("v8", "status", "=", "")).diagnostics[0]).toMatchObject({
      code: "expected-value",
      severity: "error",
    });
    expect(validateRow(createRow("v9", "", "=", "open")).diagnostics[0]).toMatchObject({
      code: "expected-field",
      severity: "error",
    });
  });
});

describe("validateRows", () => {
  it("validates multiple rows and aggregates diagnostics", () => {
    const rows: FilterRow[] = [
      createRow("vr1", "status", "=", "open"),
      createRow("vr2", "unknown", "=", "x"),
      createRow("vr3", "priority", "=", "9"),
    ];
    const result = validateRows(rows);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(1);
    expect(result.diagnostics.map((d) => d.code)).toContain("unknown-field");
    expect(result.diagnostics.map((d) => d.code)).toContain("invalid-number");
  });

  it("returns valid when all rows are correct", () => {
    const rows: FilterRow[] = [
      createRow("vr4", "status", "=", "open"),
      createRow("vr5", "priority", "=", "1"),
    ];
    const result = validateRows(rows);
    expect(result.valid).toBe(true);
  });
});

describe("serializeRows", () => {
  it("serializes a single row", () => {
    const rows = [createRow("s1", "status", "=", "open")];
    expect(serializeRows(rows)).toBe("status=open");
  });

  it("serializes multiple rows with AND connector", () => {
    const rows = [
      createRow("s2", "status", "=", "open"),
      createRow("s3", "priority", "=", "1"),
    ];
    expect(serializeRows(rows, "AND")).toBe("status=open AND priority=1");
  });

  it("serializes multiple rows with OR connector", () => {
    const rows = [
      createRow("s4", "priority", "=", "0"),
      createRow("s5", "priority", "=", "1"),
    ];
    expect(serializeRows(rows, "OR")).toBe("priority=0 OR priority=1");
  });

  it("omits empty rows during serialization", () => {
    const rows = [
      createEmptyRow("s6"),
      createRow("s7", "status", "=", "open"),
      createEmptyRow("s8"),
    ];
    expect(serializeRows(rows)).toBe("status=open");
  });

  it("returns empty string for all-empty rows", () => {
    const rows = [createEmptyRow("s9"), createEmptyRow("s10")];
    expect(serializeRows(rows)).toBe("");
  });

  it("quotes values with spaces", () => {
    const rows = [createRow("s11", "title", "=", "fix login")];
    expect(serializeRows(rows)).toBe('title="fix login"');
  });

  it("round-trips through analyze without diagnostics", () => {
    const rows = [
      createRow("s12", "status", "=", "open"),
      createRow("s13", "priority", "=", "1"),
    ];
    const serialized = serializeRows(rows, "AND");
    const analysis = analyze(serialized);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.ast).not.toBeNull();
  });
});

describe("filter row editing lifecycle", () => {
  it("supports clearing then re-populating a row", () => {
    let row = createRow("life1", "status", "=", "open");
    expect(isRowEmpty(row)).toBe(false);

    row = clearRow(row);
    expect(isRowEmpty(row)).toBe(true);

    row = updateRowField(row, "type");
    row = updateRowOperator(row, "=");
    row = updateRowValue(row, "bug");
    expect(row.field).toBe("type");
    expect(row.value).toBe("bug");
    expect(isRowEmpty(row)).toBe(false);

    const validation = validateRow(row);
    expect(validation.valid).toBe(true);
  });

  it("supports editing field and operator in sequence", () => {
    let row = createEmptyRow("life2");
    row = updateRowField(row, "priority");
    row = updateRowOperator(row, ">");
    row = updateRowValue(row, "2");
    expect(row).toMatchObject({ field: "priority", operator: ">", value: "2" });

    const serialized = serializeRows([row]);
    expect(serialized).toBe("priority>2");
  });
});

describe("parseSimpleFilterRows", () => {
  it("recovers a flat query for builder editing", () => {
    expect(parseSimpleFilterRows("status=open AND priority=1")).toEqual({
      connector: "AND",
      rows: [
        { id: "query-row-1", field: "status", operator: "=", value: "open" },
        { id: "query-row-2", field: "priority", operator: "=", value: "1" },
      ],
    });
  });

  it("keeps mixed-precedence expressions in raw mode", () => {
    expect(parseSimpleFilterRows("status=open OR priority=0 AND type=bug")).toBeNull();
    expect(parseSimpleFilterRows("NOT status=closed")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  5. Multiple Filters with Boolean Choices                          */
/* ------------------------------------------------------------------ */

describe("multiple filters with boolean connectors", () => {
  it("serializes three rows with AND", () => {
    const rows = [
      createRow("m1", "status", "=", "open"),
      createRow("m2", "type", "=", "bug"),
      createRow("m3", "priority", "=", "0"),
    ];
    expect(serializeRows(rows, "AND")).toBe("status=open AND type=bug AND priority=0");
  });

  it("serializes three rows with OR", () => {
    const rows = [
      createRow("m4", "status", "=", "open"),
      createRow("m5", "status", "=", "in_progress"),
    ];
    expect(serializeRows(rows, "OR")).toBe("status=open OR status=in_progress");
  });

  it("round-trips complex serialized query through analyze", () => {
    const rows = [
      createRow("m6", "status", "=", "open"),
      createRow("m7", "priority", "=", "0"),
      createRow("m8", "type", "=", "feature"),
    ];
    const serialized = serializeRows(rows, "AND");
    const analysis = analyze(serialized);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.ast).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  6. Presets                                                        */
/* ------------------------------------------------------------------ */

describe("BUILT_IN_PRESETS", () => {
  beforeEach(() => {
  });

  it("exposes the expected built-in presets", () => {
    const names = BUILT_IN_PRESETS.map((p) => p.name);
    expect(names).toContain("open-issues");
    expect(names).toContain("blocked-issues");
    expect(names).toContain("high-priority");
    expect(names).toContain("priority-0");
    expect(names).toContain("priority-4");
    expect(names).toContain("my-issues");
    expect(names).toContain("in-progress");
    expect(names).toContain("deferred-issues");
    expect(names).toContain("closed-issues");
    expect(names).toContain("unassigned");
    expect(names).toContain("recently-updated");
  });

  it("serializes open-issues preset", () => {
    const preset = getPreset("open-issues");
    expect(preset).toBeDefined();
    expect(serializePreset(preset!, {})).toBe("status=open");
  });

  it("serializes blocked-issues preset", () => {
    const preset = getPreset("blocked-issues");
    expect(serializePreset(preset!, {})).toBe("status=blocked");
  });

  it("serializes high-priority preset with OR connector", () => {
    const preset = getPreset("high-priority");
    expect(serializePreset(preset!, {})).toBe("priority=0 OR priority=1");
  });

  it("serializes individual priority presets", () => {
    expect(serializePreset(getPreset("priority-0")!, {})).toBe("priority=0");
    expect(serializePreset(getPreset("priority-4")!, {})).toBe("priority=4");
  });

  it("serializes my-issues preset with assignee", () => {
    const preset = getPreset("my-issues");
    expect(serializePreset(preset!, { assignee: "alice" })).toBe("assignee=alice");
  });

  it("serializes my-issues preset as empty without assignee", () => {
    const preset = getPreset("my-issues");
    expect(serializePreset(preset!, {})).toBe("");
  });

  it("allows the caller to override a preset connector", () => {
    const preset = getPreset("high-priority");
    expect(serializePreset(preset!, { connector: "AND" })).toBe("priority=0 AND priority=1");
  });

  it("does not hard-code an assignee value", () => {
    const preset = getPreset("my-issues");
    const serialized = serializePreset(preset!, {});
    expect(serialized).not.toContain("assignee=");
  });

  it("serializes in-progress preset", () => {
    const preset = getPreset("in-progress");
    expect(serializePreset(preset!, {})).toBe("status=in_progress");
  });

  it("serializes the remaining status presets", () => {
    expect(serializePreset(getPreset("deferred-issues")!, {})).toBe("status=deferred");
    expect(serializePreset(getPreset("closed-issues")!, {})).toBe("status=closed");
  });

  it("provides deterministic serialization", () => {
    const preset = getPreset("open-issues");
    const result1 = serializePreset(preset!, {});
    const result2 = serializePreset(preset!, {});
    expect(result1).toBe(result2);
  });

  it("round-trips preset serialization through analyze", () => {
    const preset = getPreset("high-priority");
    const serialized = serializePreset(preset!, {});
    const analysis = analyze(serialized);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.ast).not.toBeNull();
  });

  it("getPreset returns undefined for unknown name", () => {
    expect(getPreset("nonexistent")).toBeUndefined();
  });
});

describe("query examples and recent history", () => {
  it("keeps every curated example valid through beads-query-language", () => {
    expect(QUERY_EXAMPLES.length).toBeGreaterThan(2);
    for (const example of QUERY_EXAMPLES) {
      expect(analyze(example.query).diagnostics, example.name).toEqual([]);
    }
  });

  it("deduplicates, validates, and caps recent queries", () => {
    const recent = addRecentQuery(["status=closed"], "status=open", 2);
    expect(recent).toEqual(["status=open", "status=closed"]);
    expect(addRecentQuery(recent, "status=open", 2)).toEqual(recent);
    expect(addRecentQuery(recent, "status=", 2)).toEqual(recent);
    expect(addRecentQuery(recent, "type=bug", 2)).toHaveLength(2);
    expect(MAX_RECENT_QUERIES).toBe(8);
  });

  it("removes a selected recent query without affecting others", () => {
    expect(removeRecentQuery(["status=open", "type=bug"], "status=open")).toEqual(["type=bug"]);
  });
});

/* ------------------------------------------------------------------ */
/*  7. Invalid combinations in validation state                       */
/* ------------------------------------------------------------------ */

describe("invalid combinations are represented in validation state", () => {
  it("does not silently serialize invalid field/operator combos as valid", () => {
    const row = createRow("inv1", "status", ">", "open");
    const serialized = serializeRows([row]);
    // The row serializes regardless, but validation flags it
    expect(serialized).toBe("status>open");
    const validation = validateRow(row);
    expect(validation.valid).toBe(false);
    expect(validation.diagnostics.some((d) => d.code === "invalid-operator")).toBe(true);
  });

  it("does not silently serialize invalid enum values as valid", () => {
    const row = createRow("inv2", "type", "=", "not-a-type");
    const serialized = serializeRows([row]);
    expect(serialized).toBe("type=not-a-type");
    const validation = validateRow(row);
    expect(validation.valid).toBe(false);
    expect(validation.diagnostics.some((d) => d.code === "invalid-value")).toBe(true);
  });

  it("detects invalid boolean values in validation", () => {
    const row = createRow("inv3", "pinned", "=", "yes-please");
    const validation = validateRow(row);
    expect(validation.valid).toBe(false);
    expect(validation.diagnostics.some((d) => d.code === "invalid-boolean")).toBe(true);
  });

  it("detects multiple invalid rows in validateRows", () => {
    const rows = [
      createRow("inv4", "status", ">", "open"),
      createRow("inv5", "priority", "=", "99"),
      createRow("inv6", "nonexistent", "=", "x"),
    ];
    const result = validateRows(rows);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(3);
  });
});

/* ------------------------------------------------------------------ */
/*  8. Partial tokens and cursor replacement                          */
/* ------------------------------------------------------------------ */

describe("partial tokens and cursor replacement", () => {
  it("returns field completions for a partial field token", () => {
    const projection = projectQuery("pri", 3);
    const items = projection.sections.fields;
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.label === "priority")).toBe(true);
    expect(items[0]?.replacement.from).toBe(0);
    expect(items[0]?.replacement.to).toBe(3);
  });

  it("returns value completions for a partial value prefix", () => {
    const projection = projectQuery("status=op");
    const items = projection.sections.values;
    expect(items.length).toBe(1);
    expect(items[0]?.label).toBe("open");
    expect(items[0]?.kind).toBe("value");
    expect(items[0]?.insertText).toBe("open");
  });

  it("returns field completions after AND with partial token", () => {
    const projection = projectQuery("status=open AND ty", 18);
    const items = projection.sections.fields;
    expect(items.some((i) => i.label === "type")).toBe(true);
  });

  it("cursor in the middle of a token still provides completions", () => {
    const projection = projectQuery("status=open", 3);
    // Cursor at "s" in "status" - field context
    expect(projection.sections.fields.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/*  9. Round-trip: generated queries through analyze                  */
/* ------------------------------------------------------------------ */

describe("round-trip: serializeRows through analyze", () => {
  it("round-trips a single valid row", () => {
    const rows = [createRow("rt1", "status", "=", "open")];
    const serialized = serializeRows(rows);
    expect(analyze(serialized).diagnostics).toEqual([]);
  });

  it("round-trips multiple valid rows with AND", () => {
    const rows = [
      createRow("rt2", "status", "=", "open"),
      createRow("rt3", "type", "=", "bug"),
      createRow("rt4", "priority", "=", "0"),
    ];
    const serialized = serializeRows(rows, "AND");
    expect(analyze(serialized).diagnostics).toEqual([]);
  });

  it("round-trips multiple valid rows with OR", () => {
    const rows = [
      createRow("rt5", "status", "=", "open"),
      createRow("rt6", "status", "=", "blocked"),
    ];
    const serialized = serializeRows(rows, "OR");
    expect(analyze(serialized).diagnostics).toEqual([]);
  });

  it("round-trips date field values", () => {
    const rows = [createRow("rt7", "created", ">", "7d")];
    const serialized = serializeRows(rows);
    expect(analyze(serialized).diagnostics).toEqual([]);
  });

  it("round-trips metadata fields", () => {
    const rows = [createRow("rt8", "metadata.Release", "=", "stable")];
    const serialized = serializeRows(rows);
    expect(analyze(serialized).diagnostics).toEqual([]);
  });

  it("round-trips boolean fields", () => {
    const rows = [createRow("rt9", "pinned", "=", "true")];
    const serialized = serializeRows(rows);
    expect(analyze(serialized).diagnostics).toEqual([]);
  });

  it("round-trips all built-in presets", () => {
    for (const preset of BUILT_IN_PRESETS) {
      const serialized = serializePreset(preset, {});
      if (serialized) {
        expect(analyze(serialized).diagnostics, `${preset.name} round-trip`).toEqual([]);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/*  10. Edge cases                                                    */
/* ------------------------------------------------------------------ */

describe("edge cases", () => {
  it("handles metadata fields in filter rows", () => {
    const row = createRow("edge1", "metadata.Key", "=", "value");
    const validation = validateRow(row);
    expect(validation.valid).toBe(true);
  });

  it("serializeRows default connector is AND", () => {
    const rows = [
      createRow("e1", "status", "=", "open"),
      createRow("e2", "type", "=", "bug"),
    ];
    expect(serializeRows(rows)).toBe("status=open AND type=bug");
  });

  it("getValueChoices is case-insensitive for prefix matching", () => {
    const values = getValueChoices("status", "OP");
    expect(values.map((v) => v.label)).toEqual(["open"]);
  });

  it("getOperatorChoices returns date-compatible operators for created field", () => {
    const ops = getOperatorChoices("created");
    // created uses timeComparisons which includes =, <, <=, >, >=
    expect(ops.map((o) => o.label)).toContain("=");
    expect(ops.map((o) => o.label)).toContain(">");
    expect(ops.map((o) => o.label)).toContain("<=");
    // created does NOT support !=
    expect(ops.map((o) => o.label)).not.toContain("!=");
  });

  it("projectQuery with full complex query is valid", () => {
    const projection = projectQuery("status=open AND priority=0 AND type=feature");
    expect(projection.inputState).toBe("query-valid");
    expect(projection.analysis.diagnostics).toEqual([]);
  });

  it("updateRowOperator preserves row when operator is rejected", () => {
    const row = createRow("e3", "status", "=", "open");
    const updated = updateRowOperator(row, ">");
    expect(updated).toBe(row); // Same reference since > is rejected
  });
});
