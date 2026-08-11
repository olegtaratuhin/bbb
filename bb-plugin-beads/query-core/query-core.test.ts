import { describe, expect, it } from "vitest";
import {
  analyze,
  complete,
  completions,
  highlights,
  lex,
  parse,
} from "./index";

describe("Beads query lexer", () => {
  it("tokenizes operators, keywords, values, and UTF-16 spans", () => {
    const result = lex("title=fix AND priority>=2");
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map((token) => token.kind)).toEqual([
      "identifier",
      "equals",
      "identifier",
      "and",
      "identifier",
      "greater-equals",
      "number",
      "eof",
    ]);
    expect(result.tokens[0]).toMatchObject({ raw: "title", from: 0, to: 5 });
    expect(lex("é=status").tokens[0]).toMatchObject({ from: 0, to: 1 });
  });

  it("supports quoted strings, escapes, durations, and date-shaped identifiers", () => {
    const result = lex(String.raw`title="line\nvalue" AND updated>7d AND created>2025-01-15`);
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map((token) => token.kind)).toEqual([
      "identifier",
      "equals",
      "string",
      "and",
      "identifier",
      "greater",
      "duration",
      "and",
      "identifier",
      "greater",
      "identifier",
      "eof",
    ]);
    expect(result.tokens[2]?.value).toBe("line\nvalue");
  });

  it("returns diagnostics for incomplete strings and invalid punctuation", () => {
    const result = lex(`title="unfinished!`);
    expect(result.tokens.at(-2)).toMatchObject({ kind: "string", closed: false });
    expect(result.diagnostics[0]).toMatchObject({ code: "unterminated-string", from: 6 });
    expect(lex("status!open").diagnostics[0]).toMatchObject({ code: "unexpected-character" });
  });
});

describe("Beads query parser and validation", () => {
  it("preserves boolean precedence and grouping", () => {
    const result = parse("status=open OR priority=0 AND type=bug");
    expect(result.diagnostics).toEqual([]);
    expect(result.ast?.type).toBe("or");
    expect(result.ast?.type === "or" ? result.ast.right.type : null).toBe("and");
    expect(parse("NOT (status=closed)").diagnostics).toEqual([]);
  });

  it("recovers from partial expressions with actionable diagnostics", () => {
    expect(parse("").ast).toBeNull();
    expect(parse("status=").diagnostics).toEqual([
      expect.objectContaining({ code: "expected-value", message: "Enter a value" }),
    ]);
    expect(parse("(status=open").diagnostics).toEqual([
      expect.objectContaining({ code: "unmatched-parenthesis" }),
    ]);
    expect(parse("status=open AND").diagnostics).toEqual([
      expect.objectContaining({ code: "expected-field" }),
    ]);
  });

  it("validates fields, operators, enums, numbers, booleans, and dates", () => {
    expect(analyze("status=not-a-status").diagnostics).toEqual([
      expect.objectContaining({ code: "invalid-value" }),
    ]);
    expect(analyze("pinned>maybe").diagnostics).toEqual([
      expect.objectContaining({ code: "invalid-operator" }),
      expect.objectContaining({ code: "invalid-value" }),
      expect.objectContaining({ code: "invalid-boolean" }),
    ]);
    expect(analyze("priority=9").diagnostics).toEqual([
      expect.objectContaining({ code: "invalid-number" }),
    ]);
    expect(analyze("updated=not-a-date").diagnostics).toEqual([
      expect.objectContaining({ code: "invalid-date" }),
    ]);
    expect(analyze("metadata.Release=stable").diagnostics).toEqual([]);
    expect(analyze("unknown=value").diagnostics).toEqual([
      expect.objectContaining({ code: "unknown-field" }),
    ]);
  });
});

describe("Beads query editor projections", () => {
  it("highlights fields, operators, keywords, literals, and invalid tokens", () => {
    expect(highlights("status=open AND updated>7d").map((span) => span.kind)).toEqual([
      "field",
      "operator",
      "identifier",
      "keyword",
      "field",
      "operator",
      "duration",
    ]);
    expect(highlights("status=!open").some((span) => span.kind === "invalid")).toBe(true);
  });

  it("completes fields, operators, enum values, and date templates", () => {
    expect(completions("sta").map((item) => item.label)).toContain("status");
    expect(completions("status ").map((item) => item.label)).toEqual([
      "=",
      "!=",
      "<",
      "<=",
      ">",
      ">=",
    ]);
    expect(completions("status=").map((item) => item.label)).toContain("open");
    expect(completions("updated=").map((item) => item.label)).toContain("tomorrow");
  });

  it("returns replacement ranges for partial tokens", () => {
    const items = complete(lex("prio").tokens, "prio", 4);
    expect(items[0]).toMatchObject({ label: "priority", replacement: { from: 0, to: 4 } });
  });
});
