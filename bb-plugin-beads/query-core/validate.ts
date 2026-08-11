import { fieldDefinition } from "./schema";
import type { Diagnostic, QueryNode, ComparisonNode } from "./types";

function diagnostic(
  code: string,
  message: string,
  from: number,
  to: number,
): Diagnostic {
  return { code, message, severity: "error", from, to };
}

const isoDate = /^\d{4}-\d{2}-\d{2}(?:t[^\s]+)?$/i;
const relativeWords = new Set([
  "now",
  "today",
  "yesterday",
  "tomorrow",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

function validateDate(node: ComparisonNode): Diagnostic | undefined {
  if (node.valueKind === "duration") return undefined;
  const value = node.value.trim().toLowerCase();
  if (isoDate.test(value) || relativeWords.has(value) || value.startsWith("next ") || value.startsWith("last ") || value.startsWith("in ")) {
    return undefined;
  }
  return diagnostic(
    "invalid-date",
    "Use a date, relative duration such as 7d, or a natural-language date such as tomorrow",
    node.valueSpan?.from ?? node.to,
    node.valueSpan?.to ?? node.to,
  );
}

function validateComparison(node: ComparisonNode): Diagnostic[] {
  const definition = fieldDefinition(node.field);
  if (!definition) {
    return [diagnostic(
      "unknown-field",
      `Unknown field “${node.field}”. Choose a Beads query field`,
      node.fieldSpan.from,
      node.fieldSpan.to,
    )];
  }
  const diagnostics: Diagnostic[] = [];
  if (!definition.operators.includes(node.operator)) {
    diagnostics.push(diagnostic(
      "invalid-operator",
      `${definition.name} does not support the ${node.operator} operator`,
      node.operatorSpan.from,
      node.operatorSpan.to,
    ));
  }
  if (!node.value) return diagnostics;

  const valueFrom = node.valueSpan?.from ?? node.to;
  const valueTo = node.valueSpan?.to ?? node.to;
  if (definition.values && !definition.values.includes(node.value.toLowerCase())) {
    diagnostics.push(diagnostic(
      "invalid-value",
      `Choose one of: ${definition.values.join(", ")}`,
      valueFrom,
      valueTo,
    ));
  }
  if (definition.valueKind === "number" && (!/^\d+$/.test(node.value) || Number(node.value) < 0 || Number(node.value) > 4)) {
    diagnostics.push(diagnostic("invalid-number", "Priority must be an integer from 0 to 4", valueFrom, valueTo));
  }
  if (definition.valueKind === "boolean" && !/^(?:true|false|yes|no|1|0)$/i.test(node.value)) {
    diagnostics.push(diagnostic("invalid-boolean", "Use true, false, yes, no, 1, or 0", valueFrom, valueTo));
  }
  if (definition.valueKind === "date") {
    const dateDiagnostic = validateDate(node);
    if (dateDiagnostic) diagnostics.push(dateDiagnostic);
  }
  if (definition.name === "has_metadata_key" && !/^[\p{L}\p{N}_\-./:]+$/u.test(node.value)) {
    diagnostics.push(diagnostic("invalid-metadata-key", "Use a non-empty metadata key without spaces", valueFrom, valueTo));
  }
  return diagnostics;
}

function visit(node: QueryNode, output: Diagnostic[]): void {
  switch (node.type) {
    case "comparison":
      output.push(...validateComparison(node));
      return;
    case "and":
    case "or":
      visit(node.left, output);
      visit(node.right, output);
      return;
    case "not":
      visit(node.operand, output);
      return;
    case "group":
      visit(node.expression, output);
      return;
    case "error":
      return;
  }
}

export function validate(ast: QueryNode | null): readonly Diagnostic[] {
  if (!ast) return [];
  const diagnostics: Diagnostic[] = [];
  visit(ast, diagnostics);
  return diagnostics;
}
