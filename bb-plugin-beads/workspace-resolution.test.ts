import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceTarget,
  selectLocalWorkspaceSource,
} from "./workspace-resolution";
import {
  chooseProjectId,
  projectIdFromComposerScope,
  readRootComposeProjectId,
} from "./project-context";

describe("resolveWorkspaceTarget", () => {
  it("prefers an explicit path override", () => {
    expect(
      resolveWorkspaceTarget({
        workspacePath: "  /work/beads  ",
        configuredProjectId: "configured",
        projectId: "current",
      }),
    ).toEqual({ kind: "path", path: "/work/beads" });
  });

  it("prefers the configured project over the discovered project", () => {
    expect(
      resolveWorkspaceTarget({
        configuredProjectId: "configured",
        projectId: "current",
      }),
    ).toEqual({ kind: "project", projectId: "configured" });
  });

  it("returns no target when neither project nor path is available", () => {
    expect(resolveWorkspaceTarget({})).toBeNull();
  });
});

describe("selectLocalWorkspaceSource", () => {
  it("prefers the default local source", () => {
    expect(
      selectLocalWorkspaceSource([
        { type: "local_path", path: "/first" },
        {
          type: "local_path",
          path: "/default",
          hostId: "host-remote",
          isDefault: true,
        },
      ]),
    ).toMatchObject({ path: "/default", hostId: "host-remote" });
  });

  it("rejects projects without a local workspace", () => {
    expect(() =>
      selectLocalWorkspaceSource([{ type: "local_path", path: "" }]),
    ).toThrow("no local workspace");
  });
});

describe("project context", () => {
  it("extracts project IDs from composer scopes", () => {
    expect(
      projectIdFromComposerScope({ kind: "new-thread", projectId: "proj_1" }),
    ).toBe("proj_1");
    expect(projectIdFromComposerScope({ kind: "new-thread", projectId: null })).toBeNull();
  });

  it("uses the current route before the root-compose fallback", () => {
    expect(
      chooseProjectId({
        routeProjectId: "route",
        composerProjectId: "composer",
        rootComposeProjectId: "root",
      }),
    ).toBe("route");
  });

  it("reads BB's persisted root-compose project selection", () => {
    expect(
      readRootComposeProjectId({
        getItem: (key) => (key === "bb.root-compose.project-id" ? "root" : null),
      }),
    ).toBe("root");
  });
});
