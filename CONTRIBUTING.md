# Contributing

Thanks for helping improve Beads for bb.

## Local setup

Install bb, the `bd` CLI, and Node.js 22 or newer. Then run:

```sh
npm ci
npm test
npm run test:compat
npm run typecheck
bb plugin build
bb plugin install . --yes
bb plugin reload beads
```

Tests are grouped by responsibility under `tests/`: production logic lives in
`tests/unit/`, React surface checks in `tests/ui/`, server and CLI checks in
`tests/integration/`, and the portable query-language suite in
`tests/query-core/`. Shared test-only hosts and fixtures live in
`tests/fixtures/` and are not part of the published plugin package.

Use `bd prime` for the project tracking workflow. Create or update a Beads
issue before beginning substantial work and include the issue ID in commits.

## Pull requests

- Keep changes focused and explain user-visible behavior.
- Add or update tests for query, RPC, host-routing, or UI behavior.
- Run the full checks above before requesting review.
- Do not commit `node_modules`, `dist`, embedded Dolt data, interaction logs,
  screenshots containing private issues, or local `.DS_Store` files.
- Keep the plugin compatible with the declared bb and plugin SDK engines.

For UI changes, include a sanitized screenshot or a short description of the
tested layout at wide, narrow, and remote-client sizes when practical.

## Reporting bugs

Use the GitHub issue template and include bb version, plugin version, bd
version, selected project/host context, reproduction steps, and sanitized
logs. Never include credentials, private task data, or unredacted filesystem
paths.
