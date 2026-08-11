import { complete } from "./completion";
import { highlight } from "./highlight";
import { lex } from "./lexer";
import { parse } from "./parser";
import { validate } from "./validate";
import type { CompletionItem, QueryAnalysis } from "./types";

export * from "./types";
export * from "./schema";
export { lex } from "./lexer";
export { parse } from "./parser";
export { validate } from "./validate";
export { complete } from "./completion";
export { highlight } from "./highlight";

export function analyze(source: string): QueryAnalysis {
  const lexed = lex(source);
  const parsed = parse(source);
  return {
    source,
    tokens: lexed.tokens,
    ast: parsed.ast,
    diagnostics: [...parsed.diagnostics, ...validate(parsed.ast)],
  };
}

export function completions(source: string, cursor = source.length): readonly CompletionItem[] {
  const analysis = analyze(source);
  return complete(analysis.tokens, source, cursor);
}

export function highlights(source: string): ReturnType<typeof highlight> {
  const analysis = analyze(source);
  return highlight(analysis.tokens, analysis.ast);
}
