import { canonicalFieldName } from "./schema";
import type {
  ComparisonOperator,
  Diagnostic,
  GroupNode,
  ParseResult,
  QueryNode,
  Span,
  Token,
} from "./types";
import { lex } from "./lexer";

function span(from: number, to: number): Span {
  return { from, to };
}

function errorNode(at: number): QueryNode {
  return { type: "error", from: at, to: at };
}

function expected(
  code: string,
  message: string,
  token: Token,
  expectedTokens: readonly string[],
): Diagnostic {
  return {
    code,
    message,
    severity: "error",
    from: token.from,
    to: Math.max(token.to, token.from + (token.kind === "eof" ? 0 : 1)),
    expected: expectedTokens,
  };
}

class Parser {
  private index = 0;
  readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly tokens: readonly Token[]) {}

  private current(): Token {
    return this.tokens[Math.min(this.index, this.tokens.length - 1)]!;
  }

  private advance(): Token {
    const current = this.current();
    if (current.kind !== "eof") this.index++;
    return current;
  }

  parse(): QueryNode | null {
    if (this.current().kind === "eof") return null;
    const node = this.parseOr();
    if (this.current().kind !== "eof" && this.current().kind !== "right-paren") {
      const token = this.current();
      this.diagnostics.push(expected(
        "unexpected-token",
        `Unexpected ${token.raw || token.kind}; expected AND, OR, or the end of the query`,
        token,
        ["AND", "OR"],
      ));
      this.advance();
    }
    return node;
  }

  private parseOr(): QueryNode {
    let left = this.parseAnd();
    while (this.current().kind === "or") {
      const operator = this.advance();
      const right = this.parseAnd();
      left = {
        type: "or",
        left,
        right,
        operatorSpan: operator,
        from: left.from,
        to: right.to,
      };
    }
    return left;
  }

  private parseAnd(): QueryNode {
    let left = this.parseNot();
    while (this.current().kind === "and") {
      const operator = this.advance();
      const right = this.parseNot();
      left = {
        type: "and",
        left,
        right,
        operatorSpan: operator,
        from: left.from,
        to: right.to,
      };
    }
    return left;
  }

  private parseNot(): QueryNode {
    if (this.current().kind !== "not") return this.parsePrimary();
    const operator = this.advance();
    const operand = this.parseNot();
    return {
      type: "not",
      operand,
      operatorSpan: operator,
      from: operator.from,
      to: operand.to,
    };
  }

  private parsePrimary(): QueryNode {
    if (this.current().kind === "left-paren") return this.parseGroup();
    return this.parseComparison();
  }

  private parseGroup(): GroupNode {
    const open = this.advance();
    const expression = this.current().kind === "right-paren" || this.current().kind === "eof"
      ? errorNode(this.current().from)
      : this.parseOr();
    let closeSpan: Span | undefined;
    if (this.current().kind === "right-paren") {
      closeSpan = this.advance();
    } else {
      const at = this.current();
      this.diagnostics.push({
        code: "unmatched-parenthesis",
        message: "Close this group with )",
        severity: "error",
        from: at.from,
        to: at.from,
        expected: [")"],
      });
    }
    return {
      type: "group",
      expression,
      openSpan: open,
      ...(closeSpan ? { closeSpan } : {}),
      from: open.from,
      to: closeSpan?.to ?? expression.to,
    };
  }

  private parseComparison(): QueryNode {
    const field = this.current();
    if (field.kind !== "identifier") {
      this.diagnostics.push(expected(
        "expected-field",
        field.kind === "eof" ? "Enter a field name" : "Expected a field name",
        field,
        ["field"],
      ));
      if (field.kind !== "eof" && field.kind !== "right-paren") this.advance();
      return errorNode(field.from);
    }
    this.advance();

    const operator = this.current();
    const operators: Record<string, ComparisonOperator> = {
      equals: "=",
      "not-equals": "!=",
      less: "<",
      "less-equals": "<=",
      greater: ">",
      "greater-equals": ">=",
    };
    const comparison = operators[operator.kind];
    if (!comparison) {
      this.diagnostics.push(expected(
        "expected-operator",
        "Expected a comparison operator such as = or !=",
        operator,
        ["=", "!=", "<", "<=", ">", ">="],
      ));
      return {
        type: "comparison",
        field: canonicalFieldName(field.value),
        fieldSpan: field,
        operator: "=",
        operatorSpan: span(operator.from, operator.from),
        value: "",
        valueKind: "unknown",
        valueSpan: span(operator.to, operator.to),
        from: field.from,
        to: field.to,
      };
    }
    this.advance();

    const value = this.current();
    if (!["identifier", "string", "number", "duration"].includes(value.kind)) {
      this.diagnostics.push(expected(
        "expected-value",
        value.kind === "eof" ? "Enter a value" : "Expected a value after the operator",
        value,
        ["value"],
      ));
      return {
        type: "comparison",
        field: canonicalFieldName(field.value),
        fieldSpan: field,
        operator: comparison,
        operatorSpan: operator,
        value: "",
        valueKind: "unknown",
        valueSpan: span(value.from, value.from),
        from: field.from,
        to: Math.max(operator.to, value.from),
      };
    }
    this.advance();
    return {
      type: "comparison",
      field: canonicalFieldName(field.value),
      fieldSpan: field,
      operator: comparison,
      operatorSpan: operator,
      value: value.value,
      valueKind: value.kind,
      valueSpan: value,
      from: field.from,
      to: value.to,
    };
  }
}

export function parse(source: string): ParseResult {
  const lexed = lex(source);
  const parser = new Parser(lexed.tokens);
  const ast = parser.parse();
  return {
    ast,
    diagnostics: [...lexed.diagnostics, ...parser.diagnostics],
  };
}
