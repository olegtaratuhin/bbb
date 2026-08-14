import { describe, expect, it, vi } from "vitest";
import plugin from "./server";
import {
  createFakePluginHost,
  type CreateFakePluginHostOptions,
} from "./fake-plugin-host";

type PluginHostCommandResult = Awaited<ReturnType<NonNullable<CreateFakePluginHostOptions["hostCommandExecutor"]>>>;

vi.mock("@bb/plugin-sdk", () => ({
  defineRpcContract: (contract: unknown) => contract,
}));

const issue = {
  id: "bb-harness-1",
  title: "Harness issue",
  status: "open",
  priority: 2,
  issue_type: "task",
  labels: [],
  dependencies: [],
  dependents: [],
};

function successResult(value: unknown = issue): PluginHostCommandResult {
  return {
    status: "exited",
    exitCode: 0,
    signal: null,
    stdout: JSON.stringify(value),
    stderr: "",
    errorCode: null,
    error: null,
  };
}

describe("Beads server harness", () => {
  it("registers the public RPC methods and routes project commands", async () => {
    const requests: Array<{ hostId?: string; cwd: string; args: readonly string[] }> = [];
    const host = createFakePluginHost({
      projectSources: [
        {
          type: "local_path",
          path: "/remote/repository",
          hostId: "host-remote",
          isDefault: true,
        },
      ],
      hostCommandExecutor: async (request) => {
        requests.push(request);
        return successResult([issue]);
      },
    });
    await plugin(host.bb);

    expect(host.harness.registrations.rpcMethods).toEqual([
      "listProjects",
      "initializeProject",
      "listIssues",
      "showIssue",
      "createIssue",
      "updateIssue",
    ]);
    await expect(host.harness.callRpc("listIssues", { projectId: "proj-1" })).resolves.toEqual({
      issues: [expect.objectContaining({ id: issue.id })],
    });
    expect(requests[0]).toMatchObject({
      hostId: "host-remote",
      cwd: "/remote/repository",
    });
    expect(requests[0]?.args.slice(0, 2)).toEqual(["--json", "--sandbox"]);
  });

  it("keeps an explicit workspace path local", async () => {
    const requests: Array<{ hostId?: string; cwd: string }> = [];
    const host = createFakePluginHost({
      workspacePath: "/primary/override",
      projectSources: [],
      hostCommandExecutor: async (request) => {
        requests.push(request);
        return successResult([issue]);
      },
    });
    await plugin(host.bb);

    await host.harness.callRpc("listIssues", {});
    expect(requests[0]).toMatchObject({ cwd: "/primary/override" });
    expect(requests[0]).not.toHaveProperty("hostId");
  });

  it("maps bd failures to actionable RPC errors", async () => {
    const host = createFakePluginHost({
      projectSources: [{ type: "local_path", path: "/workspace", isDefault: true }],
      hostCommandExecutor: async () => ({
        ...successResult(),
        status: "exited",
        exitCode: 1,
        stdout: "",
        stderr: "query parse failed",
      }),
    });
    await plugin(host.bb);

    await expect(
      host.harness.callRpc("listIssues", { projectId: "proj-1" }),
    ).rejects.toThrow("query parse failed");
  });
});
