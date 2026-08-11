import {
  analyze,
  complete,
  highlight,
  type CompletionItem,
  type Diagnostic,
  type HighlightSpan,
  type QueryAnalysis,
} from "./query-core";

export interface QueryEditorModel {
  source: string;
  cursor: number;
  analysis: QueryAnalysis;
  queryMode: boolean;
  diagnostics: readonly Diagnostic[];
  highlights: readonly HighlightSpan[];
  completions: readonly CompletionItem[];
}

function hasQuerySyntax(analysis: QueryAnalysis): boolean {
  return analysis.tokens.some((token) =>
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

/** Pure projection used by React, a future native editor, or another client. */
export function createQueryEditorModel(source: string, cursor = source.length): QueryEditorModel {
  const analysis = analyze(source);
  const queryMode = hasQuerySyntax(analysis);
  return {
    source,
    cursor,
    analysis,
    queryMode,
    diagnostics: queryMode
      ? analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
      : [],
    highlights: queryMode ? highlight(analysis.tokens, analysis.ast) : [],
    completions: complete(analysis.tokens, source, cursor),
  };
}

export function applyCompletion(source: string, item: CompletionItem): { source: string; cursor: number } {
  const sourceText = `${source.slice(0, item.replacement.from)}${item.insertText}${source.slice(item.replacement.to)}`;
  return {
    source: sourceText,
    cursor: item.replacement.from + item.insertText.length,
  };
}
