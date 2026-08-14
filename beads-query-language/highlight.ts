import { fieldDefinition } from "./schema";
import type { HighlightKind, HighlightSpan, QueryNode, Token } from "./types";

function tokenKind(token: Token): HighlightKind {
  switch (token.kind) {
    case "and":
    case "or":
    case "not":
      return "keyword";
    case "equals":
    case "not-equals":
    case "less":
    case "less-equals":
    case "greater":
    case "greater-equals":
      return "operator";
    case "left-paren":
    case "right-paren":
    case "comma":
      return "punctuation";
    case "string":
      return "string";
    case "number":
      return "number";
    case "duration":
      return "duration";
    case "unknown":
      return "invalid";
    default:
      return "identifier";
  }
}

function collectComparisons(node: QueryNode | null, output: QueryNode[] = []): QueryNode[] {
  if (!node) return output;
  if (node.type === "comparison") output.push(node);
  if (node.type === "and" || node.type === "or") {
    collectComparisons(node.left, output);
    collectComparisons(node.right, output);
  } else if (node.type === "not") {
    collectComparisons(node.operand, output);
  } else if (node.type === "group") {
    collectComparisons(node.expression, output);
  }
  return output;
}

function sameSpan(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
  return a.from === b.from && a.to === b.to;
}

export function highlight(tokens: readonly Token[], ast: QueryNode | null): readonly HighlightSpan[] {
  const comparisons = collectComparisons(ast);
  return tokens
    .filter((token) => token.kind !== "eof")
    .map((token) => {
      let kind = tokenKind(token);
      const comparison = comparisons.find((candidate) => candidate.type === "comparison" && sameSpan(candidate.fieldSpan, token));
      if (comparison?.type === "comparison") {
        kind = "field";
      } else {
        const value = comparisons.find((candidate) => candidate.type === "comparison" && sameSpan(candidate.valueSpan, token));
        if (value?.type === "comparison") {
          const definition = fieldDefinition(value.field);
          if (definition?.valueKind === "date" && token.kind === "identifier") kind = "date";
          else if (definition?.valueKind === "text" && token.kind === "identifier") kind = "identifier";
        }
      }
      return { from: token.from, to: token.to, kind };
    });
}
