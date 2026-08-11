# Beads query core

This directory is the portable editor core for the Beads query language. It
has no React, DOM, BB SDK, RPC, or process-execution dependency. Consumers use
the pure functions exported from `index.ts` and adapt their results to their
own editor surface.

## API surface

`index.ts` re-exports everything needed to build a query editor:

```ts
// Core analysis — single entry point
analyze(source: string): QueryAnalysis

// Convenience wrappers
completions(source: string, cursor?: number): readonly CompletionItem[]
highlights(source: string): readonly HighlightSpan[]

// Low-level primitives (for custom pipelines)
lex(source: string): LexResult
parse(source: string): ParseResult
validate(ast: QueryNode | null): readonly Diagnostic[]

// Schema introspection (for extension tooling)
FIELD_DEFINITIONS: readonly FieldDefinition[]
fieldDefinition(name: string): FieldDefinition | undefined
allFieldNames(): readonly string[]
canonicalFieldName(value: string): string
```

`QueryAnalysis` bundles tokens, AST, and merged diagnostics in one object.
`completions()` and `highlights()` are thin wrappers around `analyze()`.

## Mobile assistance contract

`mobile-contract.ts` defines the platform-neutral state and event contract for
touch-oriented query entry. It intentionally does not depend on React, DOM,
or a mobile toolkit. An adapter may expose raw editing, completion pickers,
quick filters, and a structured builder, but every generated source is still
validated by this package before it reaches Beads.

The contract requires UTF-16 replacement offsets, defers completion actions
during IME composition, honors safe-area and keyboard occlusion, uses 44 CSS
pixel minimum touch targets, and keeps incomplete/invalid queries recoverable.
Builder rows omit empty conditions and preserve explicit boolean connectors.
`MOBILE_QUERY_ASSIST_EXAMPLES` contains deterministic adapter scenarios.

## Compatibility contract

The compatibility authority is the upstream Beads query package:

- `internal/query/lexer.go`
- `internal/query/parser.go`
- `internal/query/evaluator.go`
- `docs/cli-reference/query.md`

The supported grammar is:

```text
expression := or-expression
or-expression := and-expression (OR and-expression)*
and-expression := not-expression (AND not-expression)*
not-expression := NOT not-expression | primary
primary := comparison | '(' expression ')'
comparison := field operator value
operator := '=' | '!=' | '<' | '<=' | '>' | '>='
```

Boolean keywords are case-insensitive. Values may be identifiers, quoted
strings (single or double, with `\n`, `\t`, `\\` escapes), numbers, durations
(`7d`, `24h`, `2w`, `1m`, `1y`), ISO dates (`2025-01-15`), or natural-language
date forms (`today`, `tomorrow`, `yesterday`, `next monday`). Identifiers
preserve metadata key case after the `metadata.` prefix; ordinary field names
are case-insensitive.

The field catalog in `schema.ts` contains the documented fields and evaluator
aliases, including `metadata.<key>` and `has_metadata_key`. The parser is
intentionally error-tolerant: incomplete input produces a partial AST and
structured diagnostics so editors can provide completion before a query is
ready to execute.

### Upstream limitations

This core mirrors the upstream Beads query grammar as closely as practical,
but there are known boundaries:

- **No range queries** — upstream `bd query` does not support range syntax
  (e.g., `priority>0 AND priority<3` works, but `priority:0..3` does not).
- **No full-text operators** — there is no `~` prefix or `CONTAINS` keyword;
  text search on `title`, `description`, `notes` uses plain `=` comparison
  (which upstream treats as substring match).
- **Metadata is equality-only** — `metadata.<key>` supports `=` only; upstream
  does not evaluate comparison operators on dynamic metadata.
- **Date parsing differences** — natural-language date resolution (e.g.,
  `next monday`) is handled by the Go evaluator at runtime, not by this TS
  core. The core only validates that a date-shaped token *looks* plausible
  (ISO format, known relative words, or `next`/`last`/`in` prefix). The
  final interpretation is upstream's responsibility.
- **Trailing wildcards on `id` / `spec`** — the core accepts `id=bb-*` as a
  valid identifier token; whether the upstream evaluates the wildcard depends
  on the `bd` version. Local validation does not reject it.

## UTF-16 span portability

All span offsets (`from` inclusive, `to` exclusive) use **JavaScript UTF-16
code unit positions**. This matches browser `selectionStart`/`selectionEnd`,
CSS `::selection`, and the DOM `Range` API.

The lexer handles supplementary Unicode characters correctly for offset
tracking: `widthAt()` computes `String.fromCodePoint(codePoint).length`,
which returns `2` for characters outside the BMP. This means spans remain
consistent across environments that use UTF-16 natively (browsers, Node.js
`string.slice()`).

**If you integrate with an editor that uses byte offsets** (e.g., Neovim/LSP,
which reports UTF-8), you must convert. A simple approach:

```ts
function utf16ToUtf8(source: string, offset: number): number {
  return Buffer.byteLength(source.slice(0, offset), "utf8");
}
```

The reverse conversion requires scanning the string byte by byte. This is why
the core normalizes to UTF-16 at the boundary — it is the lowest-common
denominator for JS/TS editors.

## Extension guidance

### Adding a new field

1. Add an entry to `FIELD_DEFINITIONS` in `schema.ts`:

```ts
field("my_field", "My Field", "Description", "enum", allComparisons, [
  "option_a",
  "option_b",
]),
```

2. Choose the appropriate `ValueKind` (`text`, `identifier`, `number`,
   `duration`, `date`, `boolean`, `enum`).
3. If the field supports only a subset of operators, pass the narrowed array
   (e.g., `onlyEquals` for `["="]`).
4. Add aliases if needed (e.g., `["myfield"]`).
5. Update `validateComparison()` in `validate.ts` if the field has special
   value constraints beyond enum/boolean/number/date validation.
6. Add test cases in `query-core.test.ts` covering the new field's valid and
   invalid values.

### Adding a new value type

If upstream introduces a new value literal form (e.g., a set operator or
regex syntax), extend:

- `lexer.ts` — new `TokenKind` and tokenization logic
- `types.ts` — new type entries
- `parser.ts` — if it participates in grammar precedence
- `validate.ts` — semantic validation rules
- `highlight.ts` — visual token classification

### Custom completion or highlighting

`complete()` and `highlight()` are pure functions. You can compose them with
additional logic:

```ts
import { lex, parse, validate, complete, highlight } from "./query-core";

function myAnalyze(source: string) {
  const tokens = lex(source);
  const ast = parse(source);
  const diagnostics = validate(ast);
  return { tokens, ast, diagnostics };
}
```

## Local validation

Run the full validation suite (lexer, parser, schema validation, completion,
highlighting) without building the plugin or invoking `bd`:

```sh
cd bb-plugin-beads
npm test -- --reporter=verbose query-core
```

This executes `query-core.test.ts` and covers:

- Tokenization with operators, keywords, values, and UTF-16 spans
- Quoted strings with escapes, durations, and date-shaped identifiers
- Incomplete-string and invalid-punctuation diagnostics
- Boolean precedence and grouping in the AST
- Partial-expression recovery with actionable diagnostics
- Field, operator, enum, number, boolean, and date validation
- All documented fields and evaluator aliases
- Multi-error reporting with precise spans
- Unmatched closing groups
- Syntax highlighting for all token kinds
- Completion at field, operator, value, and keyword positions
- Replacement range accuracy for partial tokens

To validate against a specific `bd` version, run the query directly:

```sh
bd query "status=open AND priority=0" --all --json
```

Compare the upstream result set with the plugin's expected behaviour. The
plugin wraps validated queries in parentheses and appends active filter
clauses, so the full executed expression may differ from the input string.
