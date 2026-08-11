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

The panel follows the project currently selected in BB. Its resolution order
is:

1. the Beads **Workspace path override** setting, when configured;
2. the Beads **Project override** setting, when configured;
3. the project in the current BB route/composer;
4. BB's persisted root-compose project selection.

For a project-backed selection, the plugin keeps the project source's
`hostId` and runs `bd` on that host with the source path as its working
directory. This is also the path used when BB is opened through **Connect**;
the phone or browser never selects a filesystem host. The selected host must
be enrolled and connected to BB, and must have a working `bd` executable.

The path override is useful for an arbitrary checkout and intentionally runs
on BB's primary host (the override does not accept a host selector). Leave it
empty when the checkout belongs to an enrolled non-primary host. If a remote
panel is empty, verify that the BB project has a `local_path` source, its
source host is connected, and `bd` is available on that host; then reload the
plugin and refresh the panel.

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
