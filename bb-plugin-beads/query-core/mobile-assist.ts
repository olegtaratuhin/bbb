/**
 * Portable mobile Beads query-assist model.
 *
 * Framework-neutral, pure TypeScript. Usable by React, native, or remote BB
 * clients. Reuses query-core APIs (analyze, complete, fieldDefinition,
 * FIELD_DEFINITIONS) rather than duplicating grammar or validation.
 */

import { fieldDefinition, FIELD_DEFINITIONS } from "./schema";
import { analyze, completions } from "./index";
import type {
  CompletionItem,
  Diagnostic,
  QueryAnalysis,
  FieldDefinition,
  ComparisonNode,
  QueryNode,
  Span,
  ComparisonOperator,
} from "./types";
import type { MobileQueryInputState } from "./mobile-contract";

/* ------------------------------------------------------------------ */
/*  1. Query projection — single function for source + cursor         */
/* ------------------------------------------------------------------ */

/** Grouped completion items for structured UI pickers. */
export interface CompletionSections {
  fields: CompletionItem[];
  operators: CompletionItem[];
  values: CompletionItem[];
  keywords: CompletionItem[];
  /** Snippets (multi-part inserts like "status=open"). */
  snippets: CompletionItem[];
}

/** Full projection result for a given source/cursor pair. */
export interface QueryProjection {
  /** Source text being edited. */
  source: string;
  /** Cursor position. */
  cursor: number;
  /** Query analysis (tokens, AST, diagnostics). */
  analysis: QueryAnalysis;
  /** High-level input state derived from diagnostics. */
  inputState: MobileQueryInputState;
  /** Completion items grouped by kind. */
  sections: CompletionSections;
  /** Primary replacement span for the current partial token. */
  replacement: Span;
}

/** Classify input state from query diagnostics. */
export function classifyInputState(analysis: QueryAnalysis): MobileQueryInputState {
  const { source, diagnostics, ast } = analysis;
  if (!source.trim()) return "empty";
  if (!ast) {
    // Only whitespace or fully consumed tokens with no AST
    if (source.trim()) return "query-invalid";
    return "empty";
  }
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length === 0) return "query-valid";
  // Check if the query is incomplete (expected-value, expected-field, etc.)
  const incompletionCodes = new Set(["expected-value", "expected-field", "expected-operator", "unmatched-parenthesis"]);
  const allIncomplete = errors.every((d) => incompletionCodes.has(d.code));
  if (allIncomplete) return "query-incomplete";
  return "query-invalid";
}

/** Group flat completion items into sections. */
export function groupCompletionItems(items: readonly CompletionItem[]): CompletionSections {
  const sections: CompletionSections = {
    fields: [],
    operators: [],
    values: [],
    keywords: [],
    snippets: [],
  };
  for (const item of items) {
    switch (item.kind) {
      case "field":
        sections.fields.push(item);
        break;
      case "operator":
        sections.operators.push(item);
        break;
      case "value":
        sections.values.push(item);
        break;
      case "keyword":
        sections.keywords.push(item);
        break;
      case "snippet":
        sections.snippets.push(item);
        break;
    }
  }
  return sections;
}

/**
 * Project a source/cursor pair into a full QueryProjection.
 *
 * This is the primary framework-neutral API: given a source string and
 * cursor offset, it returns analysis, diagnostics, input state, completion
 * sections, and replacement ranges — all derived from existing query-core
 * primitives.
 */
export function projectQuery(source: string, cursor = source.length): QueryProjection {
  const analysis = analyze(source);
  const inputState = classifyInputState(analysis);
  const rawItems = completions(source, cursor);
  const sections = groupCompletionItems(rawItems);
  const replacement = rawItems.length > 0 ? rawItems[0].replacement : { from: cursor, to: cursor };
  return { source, cursor, analysis, inputState, sections, replacement };
}

/* ------------------------------------------------------------------ */
/*  2. Field / operator / value helpers (presentation metadata)       */
/* ------------------------------------------------------------------ */

/** Presentation metadata for a field choice. */
export interface FieldChoice {
  name: string;
  label: string;
  description: string;
  valueKind: FieldDefinition["valueKind"];
  operators: readonly ComparisonOperator[];
  values?: readonly string[];
}

/** Get all field choices with presentation metadata. */
export function getFieldChoices(): readonly FieldChoice[] {
  return FIELD_DEFINITIONS.map((def) => ({
    name: def.name,
    label: def.label,
    description: def.description,
    valueKind: def.valueKind,
    operators: def.operators,
    values: def.values,
  }));
}

/** Get operator choices constrained by the selected field. */
export function getOperatorChoices(
  fieldName: string,
  replacement: Span = { from: 0, to: 0 },
): readonly CompletionItem[] {
  const def = fieldDefinition(fieldName);
  const operators = def?.operators ?? ["=", "!=", "<", "<=", ">", ">="];
  return operators.map((op) => ({
    label: op,
    insertText: op,
    kind: "operator" as const,
    replacement,
  }));
}

/** Get value choices constrained by a field and optional prefix. */
export function getValueChoices(
  fieldName: string,
  prefix = "",
  replacement: Span = { from: 0, to: 0 },
): readonly CompletionItem[] {
  const def = fieldDefinition(fieldName);
  if (!def) return [];

  let values: readonly string[];
  if (def.values) {
    values = def.values;
  } else if (def.valueKind === "date") {
    values = ["today", "tomorrow", "yesterday", "7d", "24h", '"next monday"'];
  } else {
    values = [];
  }

  const lowerPrefix = prefix.toLowerCase();
  return values
    .filter((v) => v.toLowerCase().startsWith(lowerPrefix))
    .map((v) => ({
      label: v,
      insertText: v,
      kind: "value" as const,
      detail: def.label,
      documentation: def.description,
      replacement,
    }));
}

/** Get keyword completion items. */
export function getKeywordChoices(): readonly CompletionItem[] {
  return ["AND", "OR", "NOT"].map((kw) => ({
    label: kw,
    insertText: ` ${kw} `,
    kind: "keyword" as const,
    replacement: { from: 0, to: 0 },
  }));
}

/* ------------------------------------------------------------------ */
/*  3. Filter row model — structured, serializable, validated         */
/* ------------------------------------------------------------------ */

/** A single filter row in the structured builder. */
export interface FilterRow {
  id: string;
  field: string;
  operator: ComparisonOperator;
  value: string;
}

export interface SimpleFilterDraft {
  rows: FilterRow[];
  connector: FilterConnector;
}

/** Connector between filter rows. */
export type FilterConnector = "AND" | "OR";

function flattenSimpleQuery(
  node: QueryNode,
): { comparisons: ComparisonNode[]; connector: FilterConnector } | null {
  if (node.type === "comparison") {
    return { comparisons: [node], connector: "AND" };
  }
  if (node.type === "group") return flattenSimpleQuery(node.expression);
  if (node.type !== "and" && node.type !== "or") return null;

  const left = flattenSimpleQuery(node.left);
  const right = flattenSimpleQuery(node.right);
  const connector = node.type.toUpperCase() as FilterConnector;
  if (!left || !right) return null;
  if ((left.comparisons.length > 1 && left.connector !== connector) ||
      (right.comparisons.length > 1 && right.connector !== connector)) {
    return null;
  }
  return {
    comparisons: [...left.comparisons, ...right.comparisons],
    connector,
  };
}

/**
 * Recover the builder representation for a flat AND/OR comparison query.
 * Complex NOT/mixed-precedence expressions intentionally stay in raw mode so
 * the builder cannot lose semantics while round-tripping.
 */
export function parseSimpleFilterRows(source: string): SimpleFilterDraft | null {
  const analysis = analyze(source);
  if (analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error") || !analysis.ast) {
    return null;
  }
  const flattened = flattenSimpleQuery(analysis.ast);
  if (!flattened) return null;
  return {
    connector: flattened.connector,
    rows: flattened.comparisons.map((comparison, index) => createRow(
      `query-row-${index + 1}`,
      comparison.field,
      comparison.operator,
      comparison.value,
    )),
  };
}

/** Validation result for a filter row. */
export interface FilterRowValidation {
  /** True if the row has no validation errors. */
  valid: boolean;
  /** Diagnostic messages for invalid combinations. */
  diagnostics: readonly Diagnostic[];
}

/**
 * Create an empty filter row. Caller must supply a unique id.
 */
export function createEmptyRow(id: string): FilterRow {
  return { id, field: "", operator: "=", value: "" };
}

/**
 * Create a populated filter row.
 */
export function createRow(id: string, field: string, operator: ComparisonOperator, value: string): FilterRow {
  return { id, field, operator, value };
}

/**
 * Update a filter row's field. Adjusts the operator if the new field
 * does not support the current one.
 */
export function updateRowField(row: FilterRow, field: string): FilterRow {
  const def = fieldDefinition(field);
  const operator = def?.operators.includes(row.operator) ? row.operator : def?.operators[0] ?? "=";
  return { ...row, field, operator, value: "" };
}

/**
 * Update a filter row's operator. Only allows operators supported by
 * the selected field.
 */
export function updateRowOperator(row: FilterRow, operator: ComparisonOperator): FilterRow {
  const def = fieldDefinition(row.field);
  if (def && !def.operators.includes(operator)) {
    return row; // Reject unsupported operators silently; validation will flag it.
  }
  return { ...row, operator, value: "" };
}

/**
 * Update a filter row's value.
 */
export function updateRowValue(row: FilterRow, value: string): FilterRow {
  return { ...row, value };
}

/**
 * Clear a filter row back to empty state.
 */
export function clearRow(row: FilterRow): FilterRow {
  return { id: row.id, field: "", operator: "=", value: "" };
}

/** Check if a filter row is empty (no field selected). */
export function isRowEmpty(row: FilterRow): boolean {
  return !row.field && !row.value;
}

/**
 * Validate a filter row against the schema. Returns diagnostics for
 * invalid field/operator/value combinations.
 */
export function validateRow(row: FilterRow): FilterRowValidation {
  if (isRowEmpty(row)) return { valid: true, diagnostics: [] };

  if (!row.field) {
    return {
      valid: false,
      diagnostics: [{
        code: "expected-field",
        message: "Choose a field",
        severity: "error",
        from: 0,
        to: 0,
        expected: ["field"],
      }],
    };
  }

  const def = fieldDefinition(row.field);

  // Unknown field
  if (!def && !row.field.toLowerCase().startsWith("metadata.")) {
    return {
      valid: false,
      diagnostics: [
        {
          code: "unknown-field",
          message: `Unknown field "${row.field}". Choose a Beads query field`,
          severity: "error",
          from: 0,
          to: row.field.length,
        },
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];

  // Operator validation
  const allowedOps = def?.operators ?? ["="];
  if (!allowedOps.includes(row.operator)) {
    diagnostics.push({
      code: "invalid-operator",
      message: `${def?.name ?? row.field} does not support the ${row.operator} operator`,
      severity: "error",
      from: 0,
      to: 0,
    });
  }

  if (!row.value) {
    diagnostics.push({
      code: "expected-value",
      message: "Enter a value",
      severity: "error",
      from: 0,
      to: 0,
      expected: ["value"],
    });
  }

  // Value validation
  if (row.value) {
    if (def?.values && !def.values.includes(row.value.toLowerCase())) {
      diagnostics.push({
        code: "invalid-value",
        message: `Choose one of: ${def.values.join(", ")}`,
        severity: "error",
        from: 0,
        to: 0,
      });
    }
    if (def?.valueKind === "number" && (!/^[+-]?\d+$/.test(row.value) || Number(row.value) < 0 || Number(row.value) > 4)) {
      diagnostics.push({
        code: "invalid-number",
        message: "Priority must be an integer from 0 to 4",
        severity: "error",
        from: 0,
        to: 0,
      });
    }
    if (def?.valueKind === "boolean" && !/^(?:true|false|yes|no|1|0)$/i.test(row.value)) {
      diagnostics.push({
        code: "invalid-boolean",
        message: "Use true, false, yes, no, 1, or 0",
        severity: "error",
        from: 0,
        to: 0,
      });
    }
  }

  return { valid: diagnostics.length === 0, diagnostics };
}

/**
 * Serialize filter rows left-to-right with explicit AND/OR connectors.
 * Empty rows are omitted. All-empty rows serialize to empty string.
 */
export function serializeRows(rows: readonly FilterRow[], connector: FilterConnector = "AND"): string {
  const nonEmpty = rows.filter((row) => !isRowEmpty(row));
  if (nonEmpty.length === 0) return "";

  const parts = nonEmpty.map((row) => {
    const field = row.field;
    const op = row.operator;
    const value = row.value;
    // Quote text values that contain spaces or special chars
    const serializedValue = value.includes(" ") || value.includes('"')
      ? `"${value.replace(/"/g, '\\"')}"`
      : value;
    return `${field}${op}${serializedValue}`;
  });

  return parts.join(` ${connector} `);
}

/**
 * Validate all rows and return a combined validation result.
 */
export function validateRows(rows: readonly FilterRow[]): FilterRowValidation {
  const allDiagnostics: Diagnostic[] = [];
  for (const row of rows) {
    const result = validateRow(row);
    if (!result.valid) {
      allDiagnostics.push(...result.diagnostics);
    }
  }
  return {
    valid: allDiagnostics.length === 0,
    diagnostics: allDiagnostics,
  };
}

/* ------------------------------------------------------------------ */
/*  4. Presets — deterministic, reusable filter configurations       */
/* ------------------------------------------------------------------ */

/**
 * A preset is a named set of filter rows that serializes deterministically
 * through the same model. Presets may require caller-supplied values
 * (e.g., assignee) — they are never hard-coded unless the caller provides them.
 */
export interface QueryPreset {
  /** Unique preset identifier. */
  name: string;
  /** Human-readable label. */
  label: string;
  /** Description of what this preset filters. */
  description: string;
  /**
   * Factory function that produces filter rows. The caller supplies a
   * context object with optional values (e.g., assignee). If a required
   * value is missing, the factory may return an empty row array or
   * partial rows.
   */
  rows: (context: PresetContext) => FilterRow[];
  /** Default connector between preset rows. */
  connector?: FilterConnector;
}

/** Context values a caller may supply when resolving a preset. */
export interface PresetContext {
  /** Current user / assignee to use in presets like "my issues". */
  assignee?: string;
  /** Additional connector override. */
  connector?: FilterConnector;
}

/** Resolve a preset into filter rows. */
export function resolvePreset(preset: QueryPreset, context: PresetContext): FilterRow[] {
  return preset.rows(context);
}

/** Serialize a preset directly. */
export function serializePreset(preset: QueryPreset, context: PresetContext = {}): string {
  const rows = resolvePreset(preset, context);
  return serializeRows(rows, context.connector ?? preset.connector ?? "AND");
}

/** Built-in presets. */
export const BUILT_IN_PRESETS: readonly QueryPreset[] = [
  {
    name: "open-issues",
    label: "Open Issues",
    description: "All issues with status open",
    connector: "AND",
    rows: () => [
      createRow("open", "status", "=", "open"),
    ],
  },
  {
    name: "blocked-issues",
    label: "Blocked Issues",
    description: "All issues with status blocked",
    connector: "AND",
    rows: () => [
      createRow("blocked", "status", "=", "blocked"),
    ],
  },
  {
    name: "high-priority",
    label: "High Priority",
    description: "Issues with priority 0 or 1",
    connector: "OR",
    rows: () => [
      createRow("hp0", "priority", "=", "0"),
      createRow("hp1", "priority", "=", "1"),
    ],
  },
  {
    name: "my-issues",
    label: "My Assigned Issues",
    description: "Issues assigned to the current user; requires assignee context",
    connector: "AND",
    rows: (context) => {
      const rows: FilterRow[] = [];
      if (context.assignee) {
        rows.push(createRow("mine", "assignee", "=", context.assignee));
      }
      return rows;
    },
  },
  {
    name: "in-progress",
    label: "In Progress",
    description: "All issues with status in_progress",
    connector: "AND",
    rows: () => [
      createRow("ip", "status", "=", "in_progress"),
    ],
  },
  {
    name: "unassigned",
    label: "Unassigned",
    description: "Issues without an assignee",
    connector: "AND",
    rows: () => [
      createRow("unassigned", "assignee", "=", "none"),
    ],
  },
  {
    name: "recently-updated",
    label: "Recently Updated",
    description: "Issues updated within the last seven days",
    connector: "AND",
    rows: () => [
      createRow("recently-updated", "updated", ">", "7d"),
    ],
  },
];

/** Get a built-in preset by name. */
export function getPreset(name: string): QueryPreset | undefined {
  return BUILT_IN_PRESETS.find((p) => p.name === name);
}

/* ------------------------------------------------------------------ */
/*  5. Completion context detection                                   */
/* ------------------------------------------------------------------ */

/**
 * Detect the current completion context from a projection.
 * Returns the kind of picker surface a client should show.
 */
export type CompletionContext =
  | "field"
  | "operator"
  | "value"
  | "keyword"
  | "none";

/**
 * Determine the completion context for a given projection.
 */
export function getCompletionContext(projection: QueryProjection): CompletionContext {
  const { sections } = projection;
  if (sections.fields.length > 0) return "field";
  if (sections.operators.length > 0) return "operator";
  if (sections.values.length > 0) return "value";
  if (sections.keywords.length > 0) return "keyword";
  return "none";
}

/**
 * Get the selected field name from a projection's completion context.
 * Returns undefined if not in a value context or if the field is unknown.
 */
export function getSelectedField(projection: QueryProjection): string | undefined {
  if (getCompletionContext(projection) !== "value") return undefined;
  // Find the field from the value completion items' detail
  const valueItems = projection.sections.values;
  if (valueItems.length > 0) {
    // The value items don't directly carry the field name, so we derive it
    // from the source text before the cursor
  }
  // Fallback: parse the source to find the field before the last operator
  const { source, cursor } = projection;
  const beforeCursor = source.slice(0, cursor);
  const parts = beforeCursor.split(/\s+/);
  // Look for field= or field!= pattern
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    const eqIndex = part.search(/[=<>!]/);
    if (eqIndex > 0) {
      return part.slice(0, eqIndex);
    }
  }
  return undefined;
}
