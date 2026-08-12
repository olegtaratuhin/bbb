import { describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@bb/plugin-sdk";
import plugin from "./server";

vi.mock("@bb/plugin-sdk", () => ({
  defineRpcContract: (contract: unknown) => contract,
}));

const issue = {
  id: "bb-1",
  title: "Remote issue",
  status: "open",
  priority: 2,
  issue_type: "task",
  labels: [],
  dependencies: [],
  dependents: [],
};

function makeHost(options: {
  workspacePath?: string;
  projectSources?: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  execute?: ReturnType<typeof vi.fn>;
  primaryHostId?: string | null;
  legacyHostApi?: boolean;
} = {}) {
  const registrations: { handlers: Record<string, (...args: any[]) => any> } = {
    handlers: {},
  };
  const execute =
    options.execute ??
    vi.fn(async () => ({
      status: "exited" as const,
      exitCode: 0,
      signal: null,
      stdout: JSON.stringify(issue),
      stderr: "",
      errorCode: null,
      error: null,
    }));
  const bb = {
    log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: {
      define: vi.fn(() => ({
        get: async () => ({
          projectId: undefined,
          workspacePath: options.workspacePath ?? "",
        }),
        onChange: vi.fn(),
      })),
    },
    sdk: {
      projects: {
        get: vi.fn(async ({ projectId }: { projectId?: string } = {}) => ({
          sources:
            options.projects?.find((project) => project.id === projectId)?.sources ??
            options.projectSources ??
            [],
        })),
        list: vi.fn(async () => options.projects ?? []),
      },
      system: {
        config: vi.fn(async () => ({
          primaryHostId: options.primaryHostId ?? "host-primary",
        })),
      },
    },
    hosts: options.legacyHostApi ? {} : { execute },
    rpc: {
      register: vi.fn((_contract: unknown, handlers: Record<string, any>) => {
        registrations.handlers = handlers;
      }),
    },
    onDispose: vi.fn(),
  } as unknown as BbPluginApi;
  return { bb, execute, registrations };
}

describe("Beads server host routing", () => {
  it("discovers the only Beads project when the browser has no route project", async () => {
    const execute = vi.fn(async (request: { args: readonly string[] }) => ({
      status: "exited" as const,
      exitCode: 0,
      stdout: request.args.includes("--limit")
        ? JSON.stringify([])
        : JSON.stringify(issue),
      stderr: "",
      errorCode: null,
      error: null,
    }));
    const { bb, registrations } = makeHost({
      projectSources: [
        {
          type: "local_path",
          path: "/remote/beads",
          hostId: "host-remote",
          isDefault: true,
        },
      ],
      projects: [
        {
          id: "proj-auto",
          name: "Remote project",
          sources: [
            {
              type: "local_path",
              path: "/remote/beads",
              hostId: "host-remote",
              isDefault: true,
            },
          ],
        },
      ],
      execute,
    });
    await plugin(bb);

    await registrations.handlers.listIssues({});

    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        hostId: "host-remote",
        cwd: "/remote/beads",
      }),
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        hostId: "host-remote",
        cwd: "/remote/beads",
      }),
    );
  });

  it("falls back when the current BB project has no Beads database", async () => {
    const execute = vi.fn(async (request: { cwd: string; args: readonly string[] }) => {
      if (request.cwd === "/current/project") {
        return {
          status: "exited" as const,
          exitCode: 1,
          stdout: "",
          stderr: "Error: no beads database found",
          errorCode: null,
          error: null,
        };
      }
      return {
        status: "exited" as const,
        exitCode: 0,
        stdout: request.args.includes("--limit") ? JSON.stringify([]) : JSON.stringify(issue),
        stderr: "",
        errorCode: null,
        error: null,
      };
    });
    const { bb, registrations } = makeHost({
      projectSources: [
        { type: "local_path", path: "/current/project", isDefault: true },
      ],
      projects: [
        {
          id: "proj-beads",
          name: "Beads project",
          sources: [
            { type: "local_path", path: "/beads/project", isDefault: true },
          ],
        },
      ],
      execute,
    });
    await plugin(bb);

    await expect(
      registrations.handlers.listIssues({ projectId: "proj-current" }),
    ).resolves.toEqual({ issues: [expect.objectContaining({ id: issue.id })] });
    expect(execute.mock.calls.map(([request]) => request.cwd)).toEqual([
      "/current/project",
      "/beads/project",
      "/beads/project",
    ]);
  });

  it("requires an override when multiple projects contain Beads", async () => {
    const { bb, registrations } = makeHost({
      projects: [
        {
          id: "proj-one",
          name: "One",
          sources: [{ type: "local_path", path: "/one", isDefault: true }],
        },
        {
          id: "proj-two",
          name: "Two",
          sources: [{ type: "local_path", path: "/two", isDefault: true }],
        },
      ],
      execute: vi.fn(async () => ({
        status: "exited" as const,
        exitCode: 0,
        stdout: JSON.stringify([]),
        stderr: "",
        errorCode: null,
        error: null,
      })),
    });
    await plugin(bb);

    await expect(registrations.handlers.listIssues({})).rejects.toThrow(
      "Multiple BB projects contain Beads",
    );
  });

  it("forwards the project source host for queries and mutations", async () => {
    const { bb, execute, registrations } = makeHost({
      projectSources: [
        {
          type: "local_path",
          path: "/remote/beads",
          hostId: "host-remote",
          isDefault: true,
        },
      ],
    });
    await plugin(bb);

    await registrations.handlers.listIssues({
      projectId: "proj-1",
      query: "status = open",
    });
    await registrations.handlers.showIssue({ projectId: "proj-1", id: "bb-1" });
    await registrations.handlers.createIssue({
      projectId: "proj-1",
      title: "Created",
    });
    await registrations.handlers.updateIssue({
      projectId: "proj-1",
      id: "bb-1",
      status: "in_progress",
    });

    expect(execute).toHaveBeenCalledTimes(4);
    for (const [request] of execute.mock.calls) {
      expect(request).toMatchObject({
        hostId: "host-remote",
        cwd: "/remote/beads",
        command: "bd",
      });
      expect(request.args.slice(0, 2)).toEqual(["--json", "--sandbox"]);
    }
  });

  it("keeps an explicit path override on the primary host", async () => {
    const { bb, execute, registrations } = makeHost({
      workspacePath: "/primary/beads",
    });
    await plugin(bb);

    await registrations.handlers.listIssues({});

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/primary/beads" }),
    );
    expect(execute.mock.calls[0][0]).not.toHaveProperty("hostId");
  });

  it("reports missing project selection and disconnected hosts", async () => {
    const missing = makeHost();
    await plugin(missing.bb);
    await expect(missing.registrations.handlers.listIssues({})).rejects.toThrow(
      "No Beads project was found",
    );

    const disconnected = makeHost({
      projectSources: [{ type: "local_path", path: "/remote/beads", hostId: "host-remote" }],
      execute: vi.fn(async () => {
        throw new Error("Host is not connected");
      }),
    });
    await plugin(disconnected.bb);
    await expect(
      disconnected.registrations.handlers.listIssues({ projectId: "proj-1" }),
    ).rejects.toThrow("Host is not connected");
  });

  it("does not run a remote project locally on an older BB server", async () => {
    const legacy = makeHost({
      legacyHostApi: true,
      projectSources: [
        { type: "local_path", path: "/remote/beads", hostId: "host-remote" },
      ],
    });
    await plugin(legacy.bb);

    await expect(
      legacy.registrations.handlers.listIssues({ projectId: "proj-1" }),
    ).rejects.toThrow("does not support host-routed Beads commands");
  });

  it("handles a BB server without the hosts namespace", async () => {
    const legacy = makeHost({
      projectSources: [
        { type: "local_path", path: "/remote/beads", hostId: "host-remote" },
      ],
    });
    (legacy.bb as unknown as { hosts?: unknown }).hosts = undefined;
    await plugin(legacy.bb);

    await expect(
      legacy.registrations.handlers.listIssues({ projectId: "proj-1" }),
    ).rejects.toThrow("does not support host-routed Beads commands");
  });
});
