import { allFieldNames, fieldDefinition } from "./schema";
import type { CompletionItem, Span, Token, TokenKind } from "./types";

const operatorItems = ["=", "!=", "<", "<=", ">", ">="];
const keywordItems = ["AND", "OR", "NOT"];

function replacementFor(token: Token | undefined, cursor: number): Span {
  if (token && token.kind !== "eof" && token.from <= cursor && cursor <= token.to) {
    return { from: token.from, to: token.to };
  }
  return { from: cursor, to: cursor };
}

function tokenBefore(tokens: readonly Token[], cursor: number): Token | undefined {
  return [...tokens].reverse().find((token) => token.kind !== "eof" && token.to <= cursor);
}

function tokenAt(tokens: readonly Token[], cursor: number): Token | undefined {
  return tokens.find((token) => token.kind !== "eof" && token.from <= cursor && cursor <= token.to);
}

function previousNonWhitespaceToken(tokens: readonly Token[], token: Token | undefined): Token | undefined {
  if (!token) return undefined;
  const index = tokens.indexOf(token);
  return index > 0 ? tokens[index - 1] : undefined;
}

function valueField(tokens: readonly Token[], operator: Token | undefined): string | undefined {
  if (!operator) return undefined;
  const index = tokens.indexOf(operator);
  const field = index > 0 ? tokens[index - 1] : undefined;
  return field?.kind === "identifier" ? field.value : undefined;
}

function itemsForValues(values: readonly string[], replacement: Span, kind: CompletionItem["kind"] = "value"): CompletionItem[] {
  return values.map((value, index) => ({
    label: value,
    insertText: value,
    kind,
    replacement,
    sortText: String(index).padStart(3, "0"),
  }));
}

/** Return completion items for the grammar position at `cursor`. */
export function complete(tokens: readonly Token[], source: string, cursor = source.length): readonly CompletionItem[] {
  const current = tokenAt(tokens, cursor);
  const before = tokenBefore(tokens, cursor);
  const previous = previousNonWhitespaceToken(tokens, current ?? before);
  const valueToken = current && ["identifier", "string", "number", "duration"].includes(current.kind)
    ? current
    : undefined;
  const replacement = replacementFor(valueToken, cursor);

  const fieldContext = !before || ["and", "or", "not", "left-paren"].includes(before.kind) ||
    (current?.kind === "identifier" && (!previous || ["and", "or", "not", "left-paren"].includes(previous.kind)));
  if (fieldContext) {
    const prefix = (current?.value ?? "").toLowerCase();
    return allFieldNames()
      .filter((name) => name.toLowerCase().startsWith(prefix))
      .map((name) => {
        const definition = fieldDefinition(name);
        return {
          label: name,
          insertText: name,
          kind: "field" as const,
          detail: definition?.label,
          documentation: definition?.description,
          replacement,
        };
      });
  }

  const operator = before && ["equals", "not-equals", "less", "less-equals", "greater", "greater-equals"].includes(before.kind)
    ? before
    : previous && ["equals", "not-equals", "less", "less-equals", "greater", "greater-equals"].includes(previous.kind)
      ? previous
      : undefined;
  const field = valueField(tokens, operator);
  const definition = field ? fieldDefinition(field) : undefined;
  if (definition) {
    const values = definition.values ?? (definition.valueKind === "date"
      ? ["today", "tomorrow", "yesterday", "7d", "24h", '"next monday"']
      : []);
    const prefix = valueToken?.value.toLowerCase() ?? "";
    return itemsForValues(values.filter((value) => value.toLowerCase().startsWith(prefix)), replacement);
  }

  const operatorContext = before?.kind === "identifier" && (!previous || !["equals", "not-equals", "less", "less-equals", "greater", "greater-equals"].includes(previous.kind));
  if (operatorContext) {
    const operators = fieldDefinition(before.value)?.operators ?? operatorItems;
    return operators.map((operator) => ({
      label: operator,
      insertText: operator,
      kind: "operator" as const,
      replacement,
    }));
  }

  if (before?.kind === "right-paren" || before?.kind === "string" || before?.kind === "number" || before?.kind === "duration") {
    return keywordItems.map((keyword) => ({ label: keyword, insertText: ` ${keyword} `, kind: "keyword" as const, replacement }));
  }
  return [];
}
