# Beads for BB

This plugin adds a native BB project panel for repositories managed by
[Beads](https://github.com/gastownhall/beads). It talks to the `bd` CLI with
JSON output; it never reads the Beads database or `issues.jsonl` directly.

## Current UI

The **Beads** panel is available from the BB navigation for the selected
project. It provides:

- issue search and status filtering;
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

The path override is useful for an arbitrary checkout and must be accessible
from the BB server host. Project sources must have a local workspace and a
working `bd` executable.

## Install locally

From this repository:

```sh
npm install
bb plugin install ./bb-plugin-beads --yes
bb plugin reload beads
```

The plugin uses `bd` from `PATH` by default. Set `BEADS_BIN` in the BB server
environment when the executable has another name or location. Commands are
spawned with an argument array and `shell: false`.

## Development checks

```sh
npm test
npm run typecheck
bb plugin build
```

The build emits the server and frontend bundles under `dist/`; those generated
artifacts are ignored in source checkouts because BB rebuilds path installs.
