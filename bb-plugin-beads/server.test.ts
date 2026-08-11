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
        get: vi.fn(async () => ({
          sources: options.projectSources ?? [],
        })),
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
      "No BB project is selected",
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
