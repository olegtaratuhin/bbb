# Beads for BB

This plugin adds a native BB project panel for repositories managed by
[Beads](https://github.com/gastownhall/beads). It talks to the `bd` CLI with
JSON output; it never reads the Beads database or `issues.jsonl` directly.

## Current UI

The **Beads** panel is available from the BB navigation for the selected
project. It provides:

- issue search and status filtering;
- Kanban, list, and epic/milestone progress views;
- epic and milestone completion cards with status breakdowns;
- an unassigned-work section for issues without a container;
- issue detail loading with status and priority controls;
- editing title, description, and acceptance criteria;
- creating a new issue with type, priority, and description;
- explicit refresh after changes.

## Query Language

The search input supports two modes:

1. **Ordinary text search** — typing plain keywords (e.g., `login fix`) triggers
   a free-text search against issue titles, descriptions, and notes. No
   special syntax is recognized; no validation or completion is active.
2. **Query mode** — as soon as the lexer detects a comparison operator (`=`,
   `!=`, `<`, `<=`, `>`, `>=`), a boolean keyword (`AND`, `OR`, `NOT`), or
   a parenthesis, the input switches to structured-query mode. In this mode
   the full query grammar applies, with completion, syntax highlighting, and
   live diagnostics.

The mode switch is automatic and transparent — the same `analyze()` call
drives both paths. A query that contains only identifiers and strings with
no operators stays in text-search mode.

### Supported syntax

```
comparison := field operator value
operator   := '=' | '!=' | '<' | '<=' | '>' | '>='
```

Comparisons are combined with `AND`, `OR`, `NOT` (case-insensitive) and
grouped with parentheses. Examples of **valid** queries:

- `status=open`
- `type=bug AND priority=0`
- `status!=closed OR assignee=none`
- `NOT (status=closed)`
- `updated>7d`
- `created>=2025-01-15`
- `title="exact phrase"`
- `metadata.Release=stable`
- `has_metadata_key=Release`

Examples of **invalid** queries (caught by local validation):

- `status=not-a-status` — enum value not recognized
- `pinned>maybe` — `pinned` only supports `=` / `!=`; value is not boolean
- `priority=9` — priority must be 0–4
- `unknown=value` — field not in the schema
- `updated=not-a-date` — not a recognized date or duration

### Fields and values

| Field              | Kind       | Operators     | Notes                                          |
| ------------------ | ---------- | ------------- | ------------------------------------------------ |
| `status`           | enum       | `=`, `!=`      | `open`, `in_progress`, `blocked`, `deferred`, `closed` |
| `priority`         | number     | `=`, `<`, `<=`, `>`, `>=` | 0 (highest) – 4                         |
| `type`             | enum       | `=`, `!=`      | `bug`, `feature`, `task`, `epic`, `chore`, `decision` |
| `assignee`         | text       | `=`            | `none` for unassigned                           |
| `owner`            | text       | `=`            |                                                 |
| `label` (`labels`) | text       | `=`            | `none` for unlabeled                            |
| `title`            | text       | `=`            | Text search in title                            |
| `description` (`desc`) | text   | `=`            | Text search in description                      |
| `notes`            | text       | `=`            | Text search in notes                            |
| `created` (`created_at`) | date | `=`, `<`, `<=`, `>`, `>=` | Date or duration (`7d`, `24h`, `2w`, `1m`, `1y`) or natural-language date (`today`, `tomorrow`, `yesterday`) |
| `updated` (`updated_at`) | date | `=`, `<`, `<=`, `>`, `>=` | Same as `created`                         |
| `started` (`started_at`) | date | `<`, `<=`, `>`, `>=` | First transition to in_progress          |
| `closed` (`closed_at`) | date   | `<`, `<=`, `>`, `>=` | Same as `created`                         |
| `id`               | identifier | `=`, `!=`     | Trailing wildcard supported (`bb-*`)            |
| `spec` (`spec_id`) | identifier | `=`, `!=`     | Trailing wildcard supported                     |
| `pinned`           | boolean    | `=`            | `true`, `false`, `yes`, `no`, `1`, `0`          |
| `ephemeral`        | boolean    | `=`            | Same as `pinned`                                |
| `template`         | boolean    | `=`            | Same as `pinned`                                |
| `parent`           | identifier | `=`           | Parent issue ID                                 |
| `mol_type`         | enum       | `=`           | `swarm`, `patrol`, `work`                       |
| `metadata.<key>`   | text       | `=`           | Dynamic; key preserves case                     |
| `has_metadata_key` | identifier | `=`           | Tests for key presence                          |

Values may be identifiers, single- or double-quoted strings (with `\n`,
`\t`, `\\` escapes), numbers, durations (`7d`, `24h`, `2w`, `1m`, `1y`),
ISO dates (`2025-01-15`), or natural-language dates.

### Completion, highlighting, and live diagnostics

- **Completion** triggers at field, operator, and value positions. Typing
  `sta` offers `status`; after `status ` the six operators appear; after
  `status=` the enum values appear. Date fields suggest templates like
  `today`, `tomorrow`, `7d`. Completions respect the cursor position and
  partially typed tokens, replacing only the current token span.
- **Highlighting** colour-codes tokens in query mode: fields (sky),
  operators (violet), keywords (amber bold), strings (emerald), numbers/
  durations/dates (orange), punctuation (muted), and invalid characters
  (wavy red underline).
- **Live diagnostics** surface validation errors as the user types. Only
  errors are shown in the UI; warnings and info are reserved for future use.
  The first error is displayed beneath the input. Diagnostics include the
  diagnostic code, a human-readable message, and the exact UTF-16 span so
  editors can underline the problematic text.

### Backend validation safety

Before any query reaches `bd query`, the plugin runs `analyze()` locally.
If the combined lexer + parser + schema validator produces even one error
diagnostic, the call throws and **no CLI invocation occurs**. This guards
against sending malformed expressions to the backend. When a query passes
local validation, it is wrapped in parentheses and combined with any
active status/priority filter clauses before `bd query` execution.

### Mobile query assistance

On narrow coarse-pointer clients, the completion list becomes a single
scrollable, safe-area-aware bottom surface with touch-sized options. The
sliders button opens a responsive query-assistance drawer containing quick
filters, curated valid examples, bounded local-only recent history, and a
schema-backed filter builder. Applying a preset or builder expression updates
the same controlled search input and execution path as typing; users can
replace the current query or add a valid expression with `AND`. Invalid or
incomplete builder rows stay in the drawer with an error message.

Manual mobile smoke checklist:

- iOS Safari and Android Chrome: focus the search field, confirm the completion
  surface remains above the soft keyboard, scroll a long value list, choose a
  completion, and dismiss with Escape/back or outside tap.
- Open query assistance, switch between quick filters, examples, and builder;
  verify 44px touch targets, no duplicate completion surface, and query text
  remains after cancel.
- Build a status + priority filter, apply it, then refresh and confirm the
  result request uses the same project and debounce behavior as typed search.
- Enter an incomplete or invalid row and verify no search request is sent until
  the expression is corrected; clear recent history and confirm it is removed
  from the device-local surface.

The panel follows the project currently selected in BB. Its resolution order
is:

1. the Beads **Workspace path override** setting, when configured;
2. the Beads **Project override** setting, when configured;
3. the project in the current BB route/composer;
4. BB's persisted root-compose project selection.
5. when a browser route has no project context, the BB server probes the
   available project sources and selects the only project where `bd list`
   succeeds.

The last fallback keeps remote browser clients independent of their own
localStorage. If more than one BB project contains Beads, choose the project
explicitly in the Beads settings; the plugin will not guess between unrelated
repositories.

For a project-backed selection, the plugin keeps the project source's
`hostId` and runs `bd` on that host with the source path as its working
directory. This is also the path used when BB is opened through **Connect**;
the phone or browser never selects a filesystem host. The selected host must
be enrolled and connected to BB, and must have a working `bd` executable.

The path override is useful for an arbitrary checkout and intentionally runs
on BB's primary host (the override does not accept a host selector). Leave it
empty when the checkout belongs to an enrolled non-primary host. If a remote
panel reports that no Beads project was found, verify that the BB project has a
`local_path` source and that `bd` is available on that host; then reload the
plugin and refresh the panel. BB versions without the host-command transport
cannot safely execute a project sourced from another host; the plugin reports
that the BB server must be updated or restarted instead of silently running
`bd` on the wrong machine. Primary-host projects and path overrides continue
to use the local fallback on those older servers.

## Install locally

From this repository:

```sh
npm install
bb plugin install ./bb-plugin-beads --yes
bb plugin reload beads
```

The plugin uses `bd` from the selected host's `PATH` by default. Set
`BEADS_BIN` in the BB server/host environment only when the executable has
another name or location. Commands use a bounded, shell-free argument array;
the plugin never reads `.beads/dolt` or `.beads/issues.jsonl` directly.

## Development checks

```sh
npm test
npm run typecheck
bb plugin build
```

The build emits the server and frontend bundles under `dist/`; those generated
artifacts are ignored in source checkouts because BB rebuilds path installs.
