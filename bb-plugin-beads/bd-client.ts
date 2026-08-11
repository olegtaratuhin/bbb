// bd-client.ts — bounded Beads CLI adapter for bb-plugin-beads.
//
// Pure, testable TypeScript module. No side effects on import.
// Project-backed callers inject BB's bounded host executor; the local spawn
// path remains available for direct adapter tests and primary-host callers.

import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Issue {
  id: string;
  title: string;
  description?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
  assignee?: string;
  owner?: string;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  started_at?: string;
  labels: string[];
  dependencies: IssueDependency[];
  dependents: IssueDependency[];
  [key: string]: unknown;
}

export type DependencyType = string;

export interface IssueDependency {
  issue_id: string;
  depends_on_id: string;
  type: DependencyType;
  title?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
  [key: string]: unknown;
}

export type BdOk<T = unknown> = { ok: true; value: T };
export type BdErr =
  | { ok: false; kind: "spawn"; code: string; message: string }
  | { ok: false; kind: "exit"; code: number; stdout: string; stderr: string }
  | {
      ok: false;
      kind: "transport";
      status: "timed_out" | "output_limit";
      code: string;
      message: string;
      stdout: string;
      stderr: string;
    }
  | { ok: false; kind: "parse"; raw: string; error: string };

export type BdResult<T = unknown> = BdOk<T> | BdErr;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve the bd binary path (BEADS_BIN env var or default "bd"). */
function resolveBdBin(): string {
  return process.env.BEADS_BIN ?? "bd";
}

/** Get the current working directory for bd commands. */
function getCwd(options?: { cwd?: string | undefined }): string {
  return options?.cwd ?? process.cwd();
}

// ── buildBdArgs ──────────────────────────────────────────────────────────────

/**
 * Prepends `--json` and `--sandbox` flags unless already present.
 */
export function buildBdArgs(commandArgs: readonly string[]): string[] {
  const lower = commandArgs.map((a) => a.toLowerCase());
  const result: string[] = [];
  if (!lower.some((a) => a === "--json" || a === "-j")) {
    result.push("--json");
  }
  if (!lower.some((a) => a === "--sandbox")) {
    result.push("--sandbox");
  }
  result.push(...commandArgs);
  return result;
}

// ── runBdJson ────────────────────────────────────────────────────────────────

export interface RunBdOptions {
  cwd?: string;
  hostId?: string;
  timeoutMs?: number;
  execute?: (request: {
    hostId?: string;
    command: string;
    args: readonly string[];
    cwd: string;
    timeoutMs?: number;
  }) => Promise<{
    status: "exited" | "spawn_error" | "timed_out" | "output_limit";
    exitCode: number | null;
    stdout: string;
    stderr: string;
    errorCode: string | null;
    error: string | null;
  }>;
}

type BdExecutionResult = NonNullable<RunBdOptions["execute"]> extends (
  request: never,
) => Promise<infer TResult>
  ? TResult
  : never;

function parseBdOutput(stdout: string, stderr: string): BdResult {
  const raw = stdout.trim() || stderr.trim();
  if (!raw) {
    return { ok: false, kind: "parse", raw: "", error: "Empty output" };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return {
      ok: false,
      kind: "parse",
      raw,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function resultFromHostExecution(result: BdExecutionResult): BdResult {
  if (result.status === "spawn_error") {
    return {
      ok: false,
      kind: "spawn",
      code: result.errorCode ?? "UNKNOWN",
      message: result.error ?? (result.stderr || "Unable to start bd"),
    };
  }
  if (result.status === "timed_out" || result.status === "output_limit") {
    return {
      ok: false,
      kind: "transport",
      status: result.status,
      code: result.errorCode ?? result.status,
      message: result.error ?? `bd command ${result.status}`,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  if (result.exitCode !== 0) {
    return {
      ok: false,
      kind: "exit",
      code: result.exitCode ?? -1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  return parseBdOutput(result.stdout, result.stderr);
}

/**
 * Invoke the bd CLI and return parsed JSON on success,
 * or a structured error on failure.
 */
export function runBdJson(
  commandArgs: readonly string[],
  options?: RunBdOptions,
): Promise<BdResult> {
  return new Promise((resolve) => {
    const args = buildBdArgs(commandArgs);
    const cwd = getCwd(options);
    const bin = resolveBdBin();

    const execute = options?.execute;
    if (execute) {
      void execute({
        ...(options.hostId !== undefined ? { hostId: options.hostId } : {}),
        command: bin,
        args,
        cwd,
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : {}),
      })
        .then((result) => resolve(resultFromHostExecution(result)))
        .catch((err) =>
          resolve({
            ok: false,
            kind: "spawn",
            code: "TRANSPORT_ERROR",
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      return;
    }

    const spawnOptions: SpawnOptions = {
      cwd,
      shell: false,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, spawnOptions);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "UNKNOWN";
      const message = err instanceof Error ? err.message : String(err);
      return resolve({ ok: false, kind: "spawn", code, message });
    }

    const stdoutParts: Buffer[] = [];
    const stderrParts: Buffer[] = [];

    child.stdout!.on("data", (chunk: Buffer) => stdoutParts.push(chunk));
    child.stderr!.on("data", (chunk: Buffer) => stderrParts.push(chunk));

    child.on("error", (err: Error) => {
      const code = (err as { code?: string }).code ?? "UNKNOWN";
      resolve({ ok: false, kind: "spawn", code, message: err.message });
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutParts).toString("utf8");
      const stderr = Buffer.concat(stderrParts).toString("utf8");

      if (code !== 0) {
        resolve({
          ok: false,
          kind: "exit",
          code: code ?? -1,
          stdout,
          stderr,
        });
        return;
      }

      resolve(parseBdOutput(stdout, stderr));
    });
  });
}

// ── normalizeIssues ──────────────────────────────────────────────────────────

/**
 * Accept a JSON payload (single object or array) and return a normalized
 * `Issue[]` with guaranteed array fields for labels/dependencies/dependents.
 */
export function normalizeIssues(value: unknown): Issue[] {
  if (value === null || value === undefined) {
    return [];
  }

  const items: unknown[] = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }

    const record = item as Record<string, unknown>;
    const normalizeDependencies = (
      value: unknown,
      ownerId: string,
      direction: "dependencies" | "dependents",
    ): IssueDependency[] => {
      if (!Array.isArray(value)) return [];
      return value.flatMap((entry) => {
        if (typeof entry === "string") return [];
        if (typeof entry !== "object" || entry === null) return [];
        const dependency = entry as Record<string, unknown>;
        const explicitIssueId =
          typeof dependency.issue_id === "string"
            ? dependency.issue_id
            : "";
        const explicitDependsOnId =
          typeof dependency.depends_on_id === "string"
            ? dependency.depends_on_id
            : typeof dependency.dependsOnId === "string"
              ? dependency.dependsOnId
              : "";
        const legacyId = typeof dependency.id === "string" ? dependency.id : "";
        const issueId =
          explicitIssueId ||
          (direction === "dependencies" ? ownerId : legacyId);
        const dependsOnId =
          explicitDependsOnId ||
          (direction === "dependencies" ? legacyId : ownerId);
        if (!issueId || !dependsOnId) return [];
        const normalized: IssueDependency = {
          issue_id: issueId,
          depends_on_id: dependsOnId,
          type:
            typeof dependency.type === "string"
              ? dependency.type
              : typeof dependency.dependency_type === "string"
                ? dependency.dependency_type
                : "related",
        };
        for (const key of ["title", "status", "issue_type"] as const) {
          if (typeof dependency[key] === "string") normalized[key] = dependency[key];
        }
        if (typeof dependency.priority === "number") {
          normalized.priority = dependency.priority;
        }
        for (const key of Object.keys(dependency)) {
          if (!(key in normalized) && dependency[key] !== undefined) {
            normalized[key] = dependency[key];
          }
        }
        return [normalized];
      });
    };
    const issue: Issue = {
      id: (record.id as string) ?? "",
      title: (record.title as string) ?? "",
      labels: Array.isArray(record.labels) ? record.labels : [],
      dependencies: normalizeDependencies(
        record.dependencies,
        (record.id as string) ?? "",
        "dependencies",
      ),
      dependents: normalizeDependencies(
        record.dependents,
        (record.id as string) ?? "",
        "dependents",
      ),
    };

    // Copy optional string fields only when present (omit undefined for RPC compat)
    const optionalStringFields: (keyof Pick<Issue, "description" | "status" | "issue_type" | "assignee" | "owner" | "created_at" | "created_by" | "updated_at" | "started_at">)[] = [
      "description", "status", "issue_type", "assignee", "owner",
      "created_at", "created_by", "updated_at", "started_at",
    ];
    for (const key of optionalStringFields) {
      if (typeof record[key] === "string") {
        issue[key] = record[key] as string;
      }
    }

    // Copy optional number field only when present
    if (typeof record.priority === "number") {
      issue.priority = record.priority;
    }

    // Preserve any additional fields, but omit those with undefined values
    for (const key of Object.keys(record)) {
      if (!(key in issue)) {
        const v = record[key];
        if (v !== undefined) {
          issue[key] = v;
        }
      }
    }

    return [issue];
  });
}

// ── Command Argument Builders ─────────────────────────────────────────────────

/** Validate an issue ID — must be a non-empty string. */
function validateId(id: string): string {
  if (!id || typeof id !== "string" || !id.trim()) {
    throw new Error("Issue ID must be a non-empty string");
  }
  return id.trim();
}

/** Validate a text value (title, description, etc.) — must be a non-empty string. */
function validateText(value: string, name: string): string {
  if (!value || typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Build arguments for `bd list --all --flat`.
 */
export function listIssuesArgs(filters?: {
  status?: string;
  priority?: string;
}): string[] {
  const args: string[] = ["list", "--all", "--flat"];
  if (filters?.status) {
    args.push("--status", filters.status);
  }
  if (filters?.priority) {
    args.push("--priority", filters.priority);
  }
  return args;
}

/**
 * Build arguments for `bd query <expression>`, preserving the list view's
 * status/priority filters when they are selected.
 */
export function queryIssuesArgs(
  expression: string,
  filters?: { status?: string; priority?: string },
): string[] {
  const clauses = [`(${validateText(expression, "Query")})`];
  if (filters?.status && filters.status !== "all") {
    clauses.push(`status=${filters.status}`);
  }
  if (filters?.priority) {
    clauses.push(`priority=${filters.priority}`);
  }
  return ["query", clauses.join(" AND "), "--all"];
}

/**
 * Build arguments for `bd show <id>`.
 */
export function showIssueArgs(id: string): string[] {
  return ["show", validateId(id)];
}

/**
 * Build arguments for `bd create <title>`.
 */
export function createIssueArgs(params: {
  title: string;
  type?: string;
  priority?: number;
  description?: string;
}): string[] {
  const args: string[] = ["create", validateText(params.title, "Title")];
  if (params.type) {
    args.push("--type", params.type);
  }
  if (typeof params.priority === "number") {
    args.push("--priority", String(params.priority));
  }
  if (params.description !== undefined) {
    args.push("--description", validateText(params.description, "Description"));
  }
  return args;
}

/**
 * Build arguments for `bd update <id>`.
 */
export function updateIssueArgs(id: string, params: {
  status?: string;
  priority?: number;
  title?: string;
  description?: string;
  acceptance?: string;
}): string[] {
  const args: string[] = ["update", validateId(id)];
  if (params.status) {
    args.push("--status", params.status);
  }
  if (typeof params.priority === "number") {
    args.push("--priority", String(params.priority));
  }
  if (params.title !== undefined) {
    args.push("--title", validateText(params.title, "Title"));
  }
  if (params.description !== undefined) {
    args.push("--description", validateText(params.description, "Description"));
  }
  if (params.acceptance !== undefined) {
    args.push("--acceptance", validateText(params.acceptance, "Acceptance"));
  }
  return args;
}
