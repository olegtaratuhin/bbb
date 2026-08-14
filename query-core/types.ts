/** Public, framework-neutral contracts for the Beads query editor. */

export interface Span {
  /** UTF-16 offset, inclusive. */
  from: number;
  /** UTF-16 offset, exclusive. */
  to: number;
}

export type TokenKind =
  | "identifier"
  | "string"
  | "number"
  | "duration"
  | "equals"
  | "not-equals"
  | "less"
  | "less-equals"
  | "greater"
  | "greater-equals"
  | "and"
  | "or"
  | "not"
  | "left-paren"
  | "right-paren"
  | "comma"
  | "unknown"
  | "eof";

export interface Token extends Span {
  kind: TokenKind;
  raw: string;
  /** Decoded string contents for strings; raw text otherwise. */
  value: string;
  closed?: boolean;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic extends Span {
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  /** Useful next-token hints for completion and accessible UI. */
  expected?: readonly string[];
}

export type ComparisonOperator = "=" | "!=" | "<" | "<=" | ">" | ">=";

export type ValueKind =
  | "text"
  | "identifier"
  | "number"
  | "duration"
  | "date"
  | "boolean"
  | "enum";

export interface ComparisonNode extends Span {
  type: "comparison";
  field: string;
  fieldSpan: Span;
  operator: ComparisonOperator;
  operatorSpan: Span;
  value: string;
  valueKind: TokenKind;
  valueSpan: Span;
}

export interface BinaryNode extends Span {
  type: "and" | "or";
  left: QueryNode;
  right: QueryNode;
  operatorSpan: Span;
}

export interface UnaryNode extends Span {
  type: "not";
  operand: QueryNode;
  operatorSpan: Span;
}

export interface GroupNode extends Span {
  type: "group";
  expression: QueryNode;
  openSpan: Span;
  closeSpan?: Span;
}

export interface ErrorNode extends Span {
  type: "error";
}

export type QueryNode =
  | ComparisonNode
  | BinaryNode
  | UnaryNode
  | GroupNode
  | ErrorNode;

export interface LexResult {
  tokens: readonly Token[];
  diagnostics: readonly Diagnostic[];
}

export interface ParseResult {
  ast: QueryNode | null;
  diagnostics: readonly Diagnostic[];
}

export interface QueryAnalysis extends LexResult, ParseResult {
  source: string;
}

export interface FieldDefinition {
  name: string;
  label: string;
  description: string;
  aliases?: readonly string[];
  valueKind: ValueKind;
  operators: readonly ComparisonOperator[];
  values?: readonly string[];
}

export interface CompletionItem {
  label: string;
  insertText: string;
  kind: "field" | "operator" | "keyword" | "value" | "snippet";
  detail?: string;
  documentation?: string;
  replacement: Span;
  sortText?: string;
}

export type HighlightKind =
  | "field"
  | "operator"
  | "keyword"
  | "string"
  | "number"
  | "duration"
  | "date"
  | "identifier"
  | "punctuation"
  | "invalid";

export interface HighlightSpan extends Span {
  kind: HighlightKind;
}
