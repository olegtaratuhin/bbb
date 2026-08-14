import { analyze } from "./index";
import type { Diagnostic } from "./index";

export const QUERY_EXECUTION_DEBOUNCE_MS = 180;

export type QueryExecutionMode = "empty" | "text" | "query" | "invalid";

export interface QueryExecutionState {
  mode: QueryExecutionMode;
  query: string;
  diagnostics: readonly Diagnostic[];
}

function hasQuerySyntax(source: string): boolean {
  return analyze(source).tokens.some((token) =>
    [
      "equals",
      "not-equals",
      "less",
      "less-equals",
      "greater",
      "greater-equals",
      "and",
      "or",
      "not",
      "left-paren",
      "right-paren",
    ].includes(token.kind),
  );
}

/** Define when text is safe to execute and when it must stay local-only. */
export function describeQueryExecution(source: string): QueryExecutionState {
  const query = source.trim();
  if (!query) return { mode: "empty", query: "", diagnostics: [] };
  if (!hasQuerySyntax(query)) return { mode: "text", query: "", diagnostics: [] };
  const diagnostics = analyze(query).diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  return {
    mode: diagnostics.length > 0 ? "invalid" : "query",
    query: diagnostics.length > 0 ? "" : query,
    diagnostics,
  };
}
