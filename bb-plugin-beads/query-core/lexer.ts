import type { Diagnostic, LexResult, Token, TokenKind } from "./types";

function diagnostic(
  code: string,
  message: string,
  from: number,
  to: number,
): Diagnostic {
  return { code, message, severity: "error", from, to };
}

function isIdentifierStart(char: string): boolean {
  return /[\p{L}_]/u.test(char);
}

function isIdentifierChar(char: string): boolean {
  return /[\p{L}\p{N}_\-.:/]/u.test(char);
}

function widthAt(source: string, offset: number): number {
  const codePoint = source.codePointAt(offset);
  return codePoint === undefined ? 0 : String.fromCodePoint(codePoint).length;
}

function isDigit(char: string): boolean {
  return /^[0-9]$/.test(char);
}

function classifyWord(raw: string): TokenKind {
  switch (raw.toUpperCase()) {
    case "AND":
      return "and";
    case "OR":
      return "or";
    case "NOT":
      return "not";
    default:
      if (/^[+-]?\d+$/.test(raw)) return "number";
      if (/^[+-]?\d+[hdwmy]$/i.test(raw)) return "duration";
      return "identifier";
  }
}

function token(
  kind: TokenKind,
  source: string,
  from: number,
  to: number,
  value = source.slice(from, to),
  extra: Pick<Token, "closed"> | undefined = undefined,
): Token {
  return { kind, raw: source.slice(from, to), value, from, to, ...extra };
}

/** Tokenize Beads query text without throwing on incomplete editor input. */
export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let offset = 0;

  while (offset < source.length) {
    const char = source[offset] ?? "";
    if (/\s/u.test(char)) {
      offset += widthAt(source, offset);
      continue;
    }

    const from = offset;
    const next = source[offset + 1] ?? "";
    if (char === "(" || char === ")" || char === ",") {
      const kind = char === "(" ? "left-paren" : char === ")" ? "right-paren" : "comma";
      tokens.push(token(kind, source, from, from + 1));
      offset++;
      continue;
    }
    if (char === "=" || char === "!" || char === "<" || char === ">") {
      const isTwo = (char === "!" && next === "=") ||
        ((char === "<" || char === ">") && next === "=");
      if (char === "!" && !isTwo) {
        tokens.push(token("unknown", source, from, from + 1));
        diagnostics.push(diagnostic("unexpected-character", "Expected != after !", from, from + 1));
        offset++;
        continue;
      }
      const raw = isTwo ? source.slice(from, from + 2) : char;
      const kind: TokenKind = raw === "=" ? "equals" : raw === "!=" ? "not-equals" : raw === "<" ? "less" : raw === "<=" ? "less-equals" : raw === ">" ? "greater" : "greater-equals";
      tokens.push(token(kind, source, from, from + raw.length));
      offset += raw.length;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      offset++;
      let value = "";
      let closed = false;
      while (offset < source.length) {
        const current = source[offset] ?? "";
        if (current === quote) {
          offset++;
          closed = true;
          break;
        }
        if (current === "\\") {
          const escaped = source[offset + 1];
          if (escaped === undefined) {
            offset++;
            break;
          }
          value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
          offset += 2;
          continue;
        }
        const width = widthAt(source, offset);
        value += source.slice(offset, offset + width);
        offset += width;
      }
      tokens.push(token("string", source, from, offset, value, { closed }));
      if (!closed) {
        diagnostics.push(diagnostic("unterminated-string", "Close the quoted value", from, offset));
      }
      continue;
    }

    if (isIdentifierStart(char) || isDigit(char) || char === "+" || char === "-") {
      if ((char === "+" || char === "-") && !isDigit(next)) {
        tokens.push(token("unknown", source, from, from + 1));
        diagnostics.push(diagnostic("unexpected-character", "Expected a number after the sign", from, from + 1));
        offset++;
        continue;
      }
      offset += widthAt(source, offset);
      while (offset < source.length && isIdentifierChar(source[offset] ?? "")) {
        offset += widthAt(source, offset);
      }
      const raw = source.slice(from, offset);
      tokens.push(token(classifyWord(raw), source, from, offset));
      continue;
    }

    const width = widthAt(source, offset) || 1;
    tokens.push(token("unknown", source, from, from + width));
    diagnostics.push(diagnostic("unexpected-character", `Unexpected character ${JSON.stringify(source.slice(from, from + width))}`, from, from + width));
    offset += width;
  }

  tokens.push(token("eof", source, source.length, source.length, ""));
  return { tokens, diagnostics };
}
