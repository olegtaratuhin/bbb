# Beads query core

This directory is the portable editor core for the Beads query language. It
has no React, DOM, BB SDK, RPC, or process-execution dependency. Consumers use
the pure functions exported from `index.ts` and adapt their results to their
own editor surface.

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
strings, numbers, durations (`7d`, `24h`, `2w`, `1m`, `1y`), absolute dates,
or the natural-language date forms accepted by Beads. Identifiers preserve
metadata key case after the `metadata.` prefix; ordinary field names are
case-insensitive.

The field catalog in `schema.ts` contains the documented fields and evaluator
aliases, including `metadata.<key>` and `has_metadata_key`. The parser is
intentionally error-tolerant: incomplete input produces a partial AST and
structured diagnostics so editors can provide completion before a query is
ready to execute.

All spans use JavaScript UTF-16 offsets (`from` inclusive, `to` exclusive),
which matches browser/editor selection APIs.
