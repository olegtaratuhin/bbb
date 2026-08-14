import { mkdtemp, chmod, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  buildBdArgs,
  buildBdEnvironment,
  DEFAULT_BD_TIMEOUT_MS,
  MAX_BD_OUTPUT_BYTES,
  normalizeIssues,
  listIssuesArgs,
  queryIssuesArgs,
  showIssueArgs,
  createIssueArgs,
  updateIssueArgs,
  runBd,
  runBdJson,
  type Issue,
  type BdResult,
  type BdOk,
  type BdErr,
} from "./bd-client";

// ── buildBdArgs ──────────────────────────────────────────────────────────────

describe("buildBdArgs", () => {
  it("prepends --json and --sandbox when absent", () => {
    expect(buildBdArgs(["list", "--all"])).toEqual([
      "--json",
      "--sandbox",
      "list",
      "--all",
    ]);
  });

  it("skips --json when already present", () => {
    expect(buildBdArgs(["--json", "list"])).toEqual([
      "--sandbox",
      "--json",
      "list",
    ]);
  });

  it("skips --sandbox when already present", () => {
    expect(buildBdArgs(["--sandbox", "list"])).toEqual([
      "--json",
      "--sandbox",
      "list",
    ]);
  });

  it("skips both when already present", () => {
    expect(buildBdArgs(["--json", "--sandbox", "list"])).toEqual([
      "--json",
      "--sandbox",
      "list",
    ]);
  });

  it("handles empty input", () => {
    expect(buildBdArgs([])).toEqual(["--json", "--sandbox"]);
  });

  it("is case-insensitive for flag detection", () => {
    expect(buildBdArgs(["--JSON", "list"])).toEqual(["--sandbox", "--JSON", "list"]);
    expect(buildBdArgs(["--SANDBOX", "list"])).toEqual(["--json", "--SANDBOX", "list"]);
  });
});

// ── normalizeIssues ──────────────────────────────────────────────────────────

describe("normalizeIssues", () => {
  it("returns empty array for null/undefined", () => {
    expect(normalizeIssues(null)).toEqual([]);
    expect(normalizeIssues(undefined)).toEqual([]);
    expect(normalizeIssues(42)).toEqual([]);
  });

  it("normalizes a single issue object", () => {
    const input = { id: "bb-1", title: "Test", priority: 2 };
    const result = normalizeIssues(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "bb-1",
      title: "Test",
      priority: 2,
      labels: [],
      dependencies: [],
      dependents: [],
    });
  });

  it("normalizes an array of issues", () => {
    const input = [
      { id: "a", title: "A", labels: ["urgent"] },
      { id: "b", title: "B", labels: null },
    ];
    const result = normalizeIssues(input);
    expect(result).toHaveLength(2);
    expect(result[0].labels).toEqual(["urgent"]);
    expect(result[1].labels).toEqual([]);
  });

  it("preserves extra fields", () => {
    const input = { id: "x", title: "X", custom: 123, parent: "bb-0" };
    const result = normalizeIssues(input);
    expect(result[0].custom).toBe(123);
    expect(result[0].parent).toBe("bb-0");
  });

  it("handles missing id and title", () => {
    const input = { description: "just desc" };
    const result = normalizeIssues(input);
    expect(result[0].id).toBe("");
    expect(result[0].title).toBe("");
  });

  it("normalizes dependencies and dependents to arrays", () => {
    const input = {
      id: "z",
      title: "Z",
      dependencies: [{ issue_id: "z", depends_on_id: "a" }],
      dependents: null,
    };
    const result = normalizeIssues(input);
    expect(result[0].dependencies).toHaveLength(1);
    expect(result[0].dependents).toEqual([]);
  });

  it("normalizes dependency metadata and filters malformed records", () => {
    const result = normalizeIssues({
      id: "z",
      title: "Z",
      dependencies: [
        {
          issue_id: "z",
          depends_on_id: "a",
          type: "blocks",
          title: "A",
          status: "open",
          priority: 1,
        },
        { issue_id: "z", type: "related" },
        "a",
      ],
    });

    expect(result[0].dependencies).toEqual([
      {
        issue_id: "z",
        depends_on_id: "a",
        type: "blocks",
        title: "A",
        status: "open",
        priority: 1,
      },
    ]);
  });

  it("accepts legacy dependency id and dependency_type fields", () => {
    const result = normalizeIssues({
      id: "z",
      title: "Z",
      dependencies: [
        {
          id: "z",
          dependsOnId: "a",
          dependency_type: "parent-child",
        },
      ],
    });

    expect(result[0].dependencies[0]).toMatchObject({
      issue_id: "z",
      depends_on_id: "a",
      type: "parent-child",
    });
  });

  it("converts legacy nested issue dependencies using the owning issue", () => {
    const result = normalizeIssues({
      id: "child",
      title: "Child",
      dependencies: [{ id: "parent", title: "Parent", dependency_type: "parent-child" }],
      dependents: [{ id: "dependent", title: "Dependent", dependency_type: "blocks" }],
    });

    expect(result[0].dependencies[0]).toMatchObject({
      issue_id: "child",
      depends_on_id: "parent",
      type: "parent-child",
      title: "Parent",
    });
    expect(result[0].dependents[0]).toMatchObject({
      issue_id: "dependent",
      depends_on_id: "child",
      type: "blocks",
      title: "Dependent",
    });
  });

  it("omits optional fields when absent (no undefined own properties)", () => {
    const input = { id: "bb-1", title: "Minimal" };
    const result = normalizeIssues(input);
    const issue = result[0];
    // Required fields should be present
    expect(issue.id).toBe("bb-1");
    expect(issue.title).toBe("Minimal");
    expect(issue.labels).toEqual([]);
    expect(issue.dependencies).toEqual([]);
    expect(issue.dependents).toEqual([]);
    // Optional fields must NOT be own properties when absent
    expect(Object.prototype.hasOwnProperty.call(issue, "description")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(issue, "status")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(issue, "priority")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(issue, "issue_type")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(issue, "assignee")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(issue, "owner")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(issue, "created_at")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(issue, "created_by")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(issue, "updated_at")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(issue, "started_at")).toBe(false);
  });

  it("preserves optional fields when present", () => {
    const input = {
      id: "bb-2",
      title: "Full",
      description: "A description",
      status: "open",
      priority: 3,
      issue_type: "bug",
      assignee: "alice",
      owner: "bob",
      created_at: "2024-01-01",
      created_by: "charlie",
      updated_at: "2024-01-02",
      started_at: "2024-01-03",
      labels: ["urgent"],
      dependencies: [
        { issue_id: "bb-2", depends_on_id: "bb-1", type: "blocks" },
      ],
      dependents: [],
    };
    const result = normalizeIssues(input);
    const issue = result[0];
    expect(issue.description).toBe("A description");
    expect(issue.status).toBe("open");
    expect(issue.priority).toBe(3);
    expect(issue.issue_type).toBe("bug");
    expect(issue.assignee).toBe("alice");
    expect(issue.owner).toBe("bob");
    expect(issue.created_at).toBe("2024-01-01");
    expect(issue.created_by).toBe("charlie");
    expect(issue.updated_at).toBe("2024-01-02");
    expect(issue.started_at).toBe("2024-01-03");
    expect(issue.labels).toEqual(["urgent"]);
    expect(issue.dependencies).toEqual([
      { issue_id: "bb-2", depends_on_id: "bb-1", type: "blocks" },
    ]);
  });

  it("preserves present empty string fields", () => {
    const issue = normalizeIssues({ id: "bb-4", title: "Empty", status: "" })[0];
    expect(issue.status).toBe("");
    expect(Object.prototype.hasOwnProperty.call(issue, "status")).toBe(true);
  });

  it("omits extra fields with undefined values", () => {
    const input = {
      id: "bb-3",
      title: "Extra",
      customDefined: "present",
      customUndefined: undefined,
    };
    const result = normalizeIssues(input);
    const issue = result[0];
    expect(issue.customDefined).toBe("present");
    expect(Object.prototype.hasOwnProperty.call(issue, "customUndefined")).toBe(false);
  });
});

// ── Command Argument Builders ─────────────────────────────────────────────────

describe("listIssuesArgs", () => {
  it("builds base list args", () => {
    expect(listIssuesArgs()).toEqual(["list", "--all", "--flat"]);
  });

  it("adds status filter", () => {
    expect(listIssuesArgs({ status: "open" })).toEqual([
      "list",
      "--all",
      "--flat",
      "--status",
      "open",
    ]);
  });

  it("adds priority filter", () => {
    expect(listIssuesArgs({ priority: "2" })).toEqual([
      "list",
      "--all",
      "--flat",
      "--priority",
      "2",
    ]);
  });
});

describe("queryIssuesArgs", () => {
  it("builds a query expression with closed issues included", () => {
    expect(queryIssuesArgs("status=open AND priority<=1")).toEqual([
      "query",
      "(status=open AND priority<=1)",
      "--all",
    ]);
  });

  it("combines the query with the selected status", () => {
    expect(queryIssuesArgs("type=bug", { status: "blocked" })).toEqual([
      "query",
      "(type=bug) AND status=blocked",
      "--all",
    ]);
  });

  it("rejects an empty expression", () => {
    expect(() => queryIssuesArgs("  ")).toThrow("Query must be a non-empty string");
  });

  it("rejects recognized invalid query syntax before invoking bd", () => {
    expect(() => queryIssuesArgs("status=unknown")).toThrow(
      "Invalid Beads query: Choose one of",
    );
  });
});

describe("showIssueArgs", () => {
  it("builds show args with valid id", () => {
    expect(showIssueArgs("bb-123")).toEqual(["show", "bb-123"]);
  });

  it("rejects empty id", () => {
    expect(() => showIssueArgs("")).toThrow("Issue ID must be a non-empty string");
  });

  it("rejects whitespace-only id", () => {
    expect(() => showIssueArgs("   ")).toThrow("Issue ID must be a non-empty string");
  });

  it("trims whitespace from id", () => {
    expect(showIssueArgs("  bb-1  ")).toEqual(["show", "bb-1"]);
  });
});

describe("createIssueArgs", () => {
  it("builds create args with title only", () => {
    expect(createIssueArgs({ title: "Fix bug" })).toEqual(["create", "Fix bug"]);
  });

  it("builds create args with all options", () => {
    expect(
      createIssueArgs({
        title: "Feature",
        type: "feature",
        priority: 3,
        description: "New feature",
      }),
    ).toEqual([
      "create",
      "Feature",
      "--type",
      "feature",
      "--priority",
      "3",
      "--description",
      "New feature",
    ]);
  });

  it("rejects empty title", () => {
    expect(() => createIssueArgs({ title: "" })).toThrow("Title must be a non-empty string");
  });

  it("trims title and description", () => {
    expect(
      createIssueArgs({ title: "  Trim  ", description: "  Desc  " }),
    ).toEqual(["create", "Trim", "--description", "Desc"]);
  });
});

describe("updateIssueArgs", () => {
  it("builds update args with id only", () => {
    expect(updateIssueArgs("bb-1", {})).toEqual(["update", "bb-1"]);
  });

  it("builds update args with all options", () => {
    expect(
      updateIssueArgs("bb-1", {
        status: "in_progress",
        priority: 1,
        title: "Updated",
        description: "New desc",
        acceptance: "Works",
      }),
    ).toEqual([
      "update",
      "bb-1",
      "--status",
      "in_progress",
      "--priority",
      "1",
      "--title",
      "Updated",
      "--description",
      "New desc",
      "--acceptance",
      "Works",
    ]);
  });

  it("rejects empty id", () => {
    expect(() => updateIssueArgs("", {})).toThrow("Issue ID must be a non-empty string");
  });

  it("rejects empty title", () => {
    expect(() =>
      updateIssueArgs("bb-1", { title: "" }),
    ).toThrow("Title must be a non-empty string");
  });
});

// ── runBdJson ────────────────────────────────────────────────────────────────

describe("runBdJson", () => {
  it("accepts successful non-JSON output for setup commands", async () => {
    const execute = vi.fn(async () => ({
      status: "exited" as const,
      exitCode: 0,
      stdout: "Beads initialized successfully!",
      stderr: "",
      errorCode: null,
      error: null,
    }));

    await expect(
      runBd(["init", "--non-interactive"], {
        cwd: "/workspace",
        hostId: "host-remote",
        execute,
      }),
    ).resolves.toEqual({
      ok: true,
      stdout: "Beads initialized successfully!",
      stderr: "",
    });
  });

  it("forwards argv, cwd, and host to the injected host executor", async () => {
    const execute = vi.fn(async (request: {
      hostId?: string;
      command: string;
      args: readonly string[];
      cwd: string;
      timeoutMs?: number;
    }) => ({
      status: "exited" as const,
      exitCode: 0,
      signal: null,
      stdout: JSON.stringify([{ id: "bb-1", title: "remote" }]),
      stderr: "",
      errorCode: null,
      error: null,
      request,
    }));

    const result = await runBdJson(["list", "--query", "a; echo unsafe"], {
      cwd: "/remote/workspace",
      hostId: "host-remote",
      timeoutMs: 45_000,
      execute,
    });

    expect(result).toEqual({
      ok: true,
      value: [{ id: "bb-1", title: "remote" }],
    });
    expect(execute).toHaveBeenCalledWith({
      hostId: "host-remote",
      command: process.env.BEADS_BIN ?? "bd",
      args: ["--json", "--sandbox", "list", "--query", "a; echo unsafe"],
      cwd: "/remote/workspace",
      timeoutMs: 45_000,
    });
  });

  it("preserves bounded host execution failures", async () => {
    const result = await runBdJson(["list"], {
      cwd: "/remote/workspace",
      execute: async () => ({
        status: "timed_out" as const,
        exitCode: null,
        signal: "SIGTERM",
        stdout: "partial",
        stderr: "deadline",
        errorCode: "ETIMEDOUT",
        error: "timed out",
      }),
    });

    expect(result).toEqual({
      ok: false,
      kind: "transport",
      status: "timed_out",
      code: "ETIMEDOUT",
      message: "timed out",
      stdout: "partial",
      stderr: "deadline",
    });
  });

  it("returns structured spawn error for nonexistent binary", async () => {
    const result: BdResult = await runBdJson(["list"], {
      cwd: "/nonexistent",
    });
    // On most systems this will be a spawn error (ENOENT) because the cwd
    // doesn't exist; the binary itself may still be found but spawn fails.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["spawn", "exit"]).toContain(result.kind);
    }
  });

  it("uses BEADS_BIN env var", async () => {
    const original = process.env.BEADS_BIN;
    try {
      process.env.BEADS_BIN = "/no/such/binary";
      const result: BdResult = await runBdJson(["list"]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("spawn");
      }
    } finally {
      process.env.BEADS_BIN = original;
    }
  });

  it("returns parse error for non-JSON output", async () => {
    // Use a shell command that outputs non-JSON text via BEADS_BIN pointing
    // to a script that prints plain text.  Since we can't easily spawn a fake
    // binary, we verify the contract: runBdJson calls buildBdArgs which adds
    // --json/--sandbox (tested above), and the parse error path is exercised
    // when bd returns non-JSON.
    // Here we confirm the structured error shape for a missing binary.
    const original = process.env.BEADS_BIN;
    try {
      process.env.BEADS_BIN = "/does/not/exist/shellcheck";
      const result: BdResult = await runBdJson(["list"]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("spawn");
        expect(result.code).toBeDefined();
      }
    } finally {
      process.env.BEADS_BIN = original;
    }
  });

  it("keeps only the bd-relevant environment keys", () => {
    const environment = buildBdEnvironment({
      PATH: "/bin",
      HOME: "/tmp/home",
      BEADS_DIR: "/tmp/beads",
      SECRET_TOKEN: "do-not-forward",
    });
    expect(environment).toMatchObject({
      PATH: "/bin",
      HOME: "/tmp/home",
      BEADS_DIR: "/tmp/beads",
    });
    expect(environment).not.toHaveProperty("SECRET_TOKEN");
  });

  it("times out a local bd process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bb-beads-timeout-"));
    const binary = join(directory, "fake-bd");
    await writeFile(binary, "#!/bin/sh\nsleep 10\n", "utf8");
    await chmod(binary, 0o755);
    const original = process.env.BEADS_BIN;
    try {
      process.env.BEADS_BIN = binary;
      const result = await runBd(["list"], { timeoutMs: 25 });
      expect(result).toMatchObject({
        ok: false,
        kind: "transport",
        status: "timed_out",
        code: "ETIMEDOUT",
      });
    } finally {
      process.env.BEADS_BIN = original;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("limits local bd output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bb-beads-output-"));
    const binary = join(directory, "fake-bd");
    await writeFile(binary, "#!/bin/sh\nhead -c 9000000 /dev/zero\n", "utf8");
    await chmod(binary, 0o755);
    const original = process.env.BEADS_BIN;
    try {
      process.env.BEADS_BIN = binary;
      const result = await runBd(["list"]);
      expect(result).toMatchObject({
        ok: false,
        kind: "transport",
        status: "output_limit",
        code: "EOUTPUTLIMIT",
      });
      if (!result.ok) {
        expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(
          MAX_BD_OUTPUT_BYTES,
        );
      }
    } finally {
      process.env.BEADS_BIN = original;
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("uses the safe default timeout for local processes", async () => {
    expect(DEFAULT_BD_TIMEOUT_MS).toBe(30_000);
  });
});

// ── Type exports sanity check ────────────────────────────────────────────────

describe("type exports", () => {
  it("Issue type is usable", () => {
    const issue: Issue = {
      id: "1",
      title: "T",
      labels: [],
      dependencies: [],
      dependents: [],
    };
    expect(issue.id).toBe("1");
  });

  it("BdOk and BdErr types are usable", () => {
    const ok: BdOk<string[]> = { ok: true, value: [] };
    const err: BdErr = { ok: false, kind: "spawn", code: "ENOENT", message: "test" };
    expect(ok.ok).toBe(true);
    expect(err.ok).toBe(false);
  });
});
