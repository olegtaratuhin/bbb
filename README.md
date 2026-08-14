# Beads for bb

[Beads](https://beads.gascity.com/) plugin for [bb](https://getbb.app/).

Beads adds a native project panel for browsing and updating issues managed by
the `bd` CLI. It keeps the Beads CLI as the source of truth and works with the
same project and host context as bb, including bb Connect sessions.

## What it provides

- Kanban, compact list, dependency graph, and epic/milestone views.
- Status, priority, assignee, author, and dependency visibility.
- Query-aware search with syntax highlighting, completion, validation, and
  actionable diagnostics.
- Quick filters that write shareable expressions into the query field instead
  of maintaining a second hidden filter state.
- Touch-friendly query assistance for narrow and remote clients.
- Issue detail editing, issue creation, status/priority changes, and refresh.
- Project selection across all bb projects, including a guided `bd init` flow
  for projects that do not have Beads yet.
- Host-correct execution when a project is stored on another machine.
- Cached loading and responsive layouts designed for split panes and phones.

## Install

Requirements:

- bb 0.36 or newer.
- The `bd` CLI installed and available on the host that owns the selected
  project.
- A project with a `.beads` workspace, or permission to initialize one from
  the plugin.

Install the latest tracked GitHub revision:

```sh
bb plugin install https://github.com/olegtaratuhin/bbb --yes
```

Then open the Beads panel from the bb project navigation. To update a Git
installation later:

```sh
bb plugin outdated
bb plugin update beads --yes
```

Remove it with:

```sh
bb plugin remove beads
```

The plugin is full-trust bb server code. Review the source before installing
it: it executes `bd` and can access project data through bb's host APIs.

## Views at a glance

The default surface is Kanban. The main views are:

- Kanban for status-oriented planning.
- List for dense scanning on small screens.
- Graph for dependency relationships, with horizontal and vertical layouts.
- The right-hand epic drawer for navigating containers without losing the
  current issue scope.

When publishing UI changes, add sanitized screenshots to
`docs/screenshots/` and link them from this section. Use a project with
synthetic issues; never capture private task descriptions, paths, or
credentials. The current source checkout was prepared without a browser
capture runtime, so the first release should add this visual proof before
publishing if a live screenshot is available.

## Project and host selection

The panel follows the project selected in bb. When the current route has no
project context, it prefers bb's most recently selected project and can probe
available projects for a Beads workspace. The project selector lists all bb
projects, including projects without Beads.

For a project-backed selection, `bd` runs on that project's source host. This
is also the behavior when bb is opened through Connect: the phone or browser
does not choose a filesystem. The selected host must be enrolled, connected,
and have `bd` on its `PATH`.

Projects without `.beads` offer a confirmed setup action. Selecting a project
never initializes it silently.

Optional settings are available under the plugin's bb settings page:

- **Project override** selects a specific bb project.
- **Workspace path override** points to an arbitrary local checkout on the bb
  server host.

Use the path override only for a checkout on the primary bb host. Leave it
empty for projects stored on an enrolled remote host.

## Query search

Plain text remains an ordinary search. Structured-query mode starts when the
input contains query syntax such as an operator, boolean keyword, or
parenthesis.

```text
status=open
type=bug AND priority=0
status!=closed OR assignee=none
NOT (status=closed)
updated>7d
created>=2025-01-15
```

The query editor provides field/operator/value completion, token highlighting,
schema validation, and diagnostics. Quick filters and the mobile builder
produce the same query text used by manual entry. See
[`query-core/README.md`](query-core/README.md) for the portable headless
contracts and supported grammar.

Invalid structured queries are rejected before the plugin invokes `bd`. This
prevents malformed input from being silently treated as free-text search.

## Development

```sh
npm ci
npm test
npm run test:compat
npm run typecheck
bb plugin build
```

Install the checkout for local development and reload it after changes:

```sh
bb plugin install . --yes
bb plugin reload beads
```

The repository contains a headless query core under `query-core/`, a server
adapter in `server.ts`, and the bb React surface in `app.tsx`. Vendored UI
components live under `components/` so the plugin can be installed from GitHub
without depending on bb's private source tree.

The test suite covers the query core, CLI/RPC normalization, host routing,
project selection, cache and loading behavior, responsive toolbar structure,
dependency graph projections, and focused React interactions.

## Troubleshooting

### No Beads database found

Confirm that the selected project has a local source and a `.beads` directory.
For a new project, use the setup action in the project selector or run:

```sh
bd init
```

Then refresh the panel.

### Remote view is empty

The repository must be a bb project with a `local_path` source. The source host
must be online through Connect and must have `bd` installed. The browser's
local filesystem is not used. Older bb versions without host-targeted command
transport cannot safely run `bd` for a non-primary source; update bb and reload
the plugin.

### Query suggestions or validation are missing

Structured assistance activates only after query syntax is detected. Plain
keywords intentionally use ordinary text search. If the query is recognized
as structured syntax, fix the diagnostic shown below the field before running
it.

## Data and privacy

The plugin does not read `.beads/dolt` or `.beads/issues.jsonl` directly. It
invokes `bd` through bounded JSON RPC operations and uses bb host routing for
project files. Runtime Dolt databases, interaction logs, `node_modules`, and
build output are local-only and ignored by Git.

This repository itself uses Beads for development tracking. The Beads database
is separate from the source branch. If issue history is intentionally shared,
use the Dolt-backed `bd dolt push`/`bd dolt pull` workflow after reviewing the
issue content for public disclosure; do not treat JSONL exports as the normal
sync mechanism.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
Bug reports should include bb and bd versions, the selected project/host
context, a sanitized reproduction, and the relevant plugin logs. Do not attach
credentials, private issue databases, or unredacted filesystem paths.

Security reports belong in [SECURITY.md](SECURITY.md), not in a public issue.

## License

MIT. See [LICENSE](LICENSE).
