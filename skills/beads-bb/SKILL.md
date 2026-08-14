---
name: beads-bb
description: Use when working with the Beads panel in bb, especially for project selection, remote host routing, query search, or plugin troubleshooting.
---

# Beads in bb

The Beads plugin is a UI over the `bd` CLI. Treat `bd` as the source of truth
and do not read `.beads/dolt` or `.beads/issues.jsonl` directly.

When troubleshooting an empty or incorrect view:

1. Confirm the selected bb project and its `local_path` source.
2. Confirm the source host is online when using bb Connect.
3. Confirm `bd` is installed on that host and can resolve the workspace.
4. Refresh the panel after fixing the host or workspace.

Structured search supports fields, operators, boolean expressions, completion,
and validation. Prefer the query editor and Quick filters; do not duplicate
status or priority state in an unrelated local filter.
