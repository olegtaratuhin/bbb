import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";
import {
  createIssueArgs,
  listIssuesArgs,
  normalizeIssues,
  queryIssuesArgs,
  runBdJson,
  showIssueArgs,
  updateIssueArgs,
  type Issue,
} from "./bd-client";
import {
  resolveWorkspaceTarget,
  selectLocalWorkspaceSource,
  type ProjectSourceLike,
} from "./workspace-resolution";

const dependencySchema = z
  .object({
    issue_id: z.string(),
    depends_on_id: z.string(),
    type: z.string(),
  })
  .passthrough();

const issueSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    status: z.string().optional(),
    priority: z.number().optional(),
    issue_type: z.string().optional(),
    assignee: z.string().optional(),
    labels: z.array(z.unknown()),
    dependencies: z.array(dependencySchema),
    dependents: z.array(dependencySchema),
  })
  .passthrough();

const projectInput = z.object({ projectId: z.string().min(1).optional() });
const issueIdInput = projectInput.extend({ id: z.string().min(1) });
const beadsProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const issueOutput = z.object({ issue: issueSchema });

export const rpcContract = defineRpcContract({
  listProjects: {
    input: z.object({}),
    output: z.object({ projects: z.array(beadsProjectSchema) }),
  },
  listIssues: {
    input: projectInput.extend({
      status: z.string().optional(),
      priority: z.string().optional(),
      query: z.string().min(1).max(2000).optional(),
    }),
    output: z.object({ issues: z.array(issueSchema) }),
  },
  showIssue: {
    input: issueIdInput,
    output: issueOutput,
  },
  createIssue: {
    input: projectInput.extend({
      title: z.string().min(1),
      type: z.string().optional(),
      priority: z.number().int().min(0).max(4).optional(),
      description: z.string().optional(),
    }),
    output: issueOutput,
  },
  updateIssue: {
    input: issueIdInput.extend({
      status: z
        .enum(["open", "in_progress", "blocked", "deferred", "closed"])
        .optional(),
      priority: z.number().int().min(0).max(4).optional(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      acceptance: z.string().optional(),
    }),
    output: issueOutput,
  },
});

interface BeadsSettings {
  get(): Promise<{
    projectId?: string;
    workspacePath: string;
  }>;
}

type HostExecute = NonNullable<Parameters<typeof runBdJson>[1]>["execute"];

interface ProjectLike {
  id: string;
  name?: string | null;
  sources: readonly ProjectSourceLike[];
}

function errorMessage(result: { kind: string; message?: string; stderr?: string; error?: string }) {
  if (result.kind === "spawn") {
    return result.message ?? "Unable to start bd";
  }
  if (result.kind === "parse") {
    return result.error ?? "bd returned invalid JSON";
  }
  return result.message ?? (result.stderr?.trim() || "bd command failed");
}

function isMissingBeadsDatabase(result: { ok: boolean; kind?: string; stdout?: string; stderr?: string; message?: string; error?: string }) {
  if (result.ok) return false;
  return /no beads database found|no active beads workspace|no beads workspace|\.beads/i.test(
    [result.message, result.error, result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
}

function asIssue(value: unknown): Issue {
  const issue = normalizeIssues(value)[0];
  if (!issue || !issue.id) {
    throw new Error("bd returned no issue");
  }
  return issue;
}

async function getWorkspaceTarget(
  bb: BbPluginApi,
  settings: BeadsSettings,
  projectId?: string,
) {
  const configured = await settings.get();
  let target = resolveWorkspaceTarget({
    configuredProjectId: configured.projectId,
    projectId,
    workspacePath: configured.workspacePath,
  });
  if (target === null) target = await discoverBeadsProject(bb);
  if (target === null)
    throw new Error(
      "No Beads project was found among the BB projects. Open a project with .beads or configure a Beads project/path override in Settings.",
    );
  if (target.kind === "path") return { path: target.path };

  const project = await bb.sdk.projects.get({ projectId: target.projectId });
  const source = selectLocalWorkspaceSource(
    project.sources as readonly ProjectSourceLike[],
  );
  return {
    path: source.path!.trim(),
    ...(source.hostId !== undefined ? { hostId: source.hostId } : {}),
  };
}

function hostExecutor(bb: BbPluginApi): HostExecute | undefined {
  // Older installed BB servers may expose declarations without the host
  // command transport. Keep the plugin loadable and fail closed for remote
  // project sources below instead of spawning on the server by accident.
  return (
    bb.hosts as unknown as { execute?: HostExecute } | undefined
  )?.execute;
}

async function assertHostRouting(
  bb: BbPluginApi,
  target: { path: string; hostId?: string },
  execute: HostExecute | undefined,
) {
  if (typeof execute === "function" && target.hostId !== undefined) return;
  if (target.hostId === undefined) return;

  let isPrimaryHost = false;
  try {
    const system = await bb.sdk.system.config();
    isPrimaryHost =
      system.primaryHostId === null || system.primaryHostId === target.hostId;
  } catch {
    // An older BB may not expose the system metadata needed to prove that a
    // project source is local. Fail closed rather than running on the wrong
    // filesystem host.
  }
  if (!isPrimaryHost) {
    throw new Error(
      "This BB server does not support host-routed Beads commands. Update or restart BB before opening a project on another machine.",
    );
  }
}

async function runBdAtTarget(
  bb: BbPluginApi,
  target: { path: string; hostId?: string },
  args: readonly string[],
) {
  const execute = hostExecutor(bb);
  await assertHostRouting(bb, target, execute);
  return runBdJson(args, {
    cwd: target.path,
    ...(typeof execute === "function" && target.hostId !== undefined
      ? { hostId: target.hostId }
      : {}),
    ...(typeof execute === "function" ? { execute } : {}),
  });
}

async function projectTarget(
  bb: BbPluginApi,
  project: ProjectLike,
): Promise<{ path: string; hostId?: string } | null> {
  try {
    const source = selectLocalWorkspaceSource(project.sources);
    return {
      path: source.path!.trim(),
      ...(source.hostId !== undefined ? { hostId: source.hostId } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Nav-panel routes do not carry the project selected on another BB surface.
 * Resolve that missing context on the BB host rather than relying on browser
 * localStorage or trying to run bd in the remote browser. A single matching
 * project is unambiguous; multiple matches require the explicit setting.
 */
async function discoverBeadsProject(
  bb: BbPluginApi,
): Promise<{ kind: "project"; projectId: string } | null> {
  const matches = await findBeadsProjects(bb);

  if (matches.length === 1) {
    return { kind: "project", projectId: matches[0]!.id };
  }
  if (matches.length > 1) {
    const names = matches
      .map((project) => project.name?.trim() || project.id)
      .join(", ");
    throw new Error(
      `Multiple BB projects contain Beads (${names}). Configure a Beads project override in Settings.`,
    );
  }
  return null;
}

async function findBeadsProjects(bb: BbPluginApi): Promise<ProjectLike[]> {
  const projects = (await bb.sdk.projects.list()) as readonly ProjectLike[];
  const matches: ProjectLike[] = [];

  for (const project of projects) {
    const target = await projectTarget(bb, project);
    if (!target) continue;
    const result = await runBdAtTarget(
      bb,
      target,
      ["list", "--all", "--flat", "--limit", "1"],
    );
    if (result.ok) matches.push(project);
  }
  return matches;
}

async function runProjectBd(
  bb: BbPluginApi,
  settings: BeadsSettings,
  projectId: string | undefined,
  args: readonly string[],
) {
  const target = await getWorkspaceTarget(bb, settings, projectId);
  let result = await runBdAtTarget(bb, target, args);

  // The nav panel can be opened while BB is focused on an ordinary project
  // that has no .beads directory. Treat that route project as a preference,
  // not an override, and recover by discovering the sole Beads project. An
  // explicit setting remains authoritative so configuration errors stay
  // visible instead of silently selecting another repository.
  const configured = await settings.get();
  if (
    !result.ok &&
    projectId &&
    !configured.projectId?.trim() &&
    !configured.workspacePath?.trim() &&
    isMissingBeadsDatabase(result)
  ) {
    const discovered = await discoverBeadsProject(bb);
    if (discovered && discovered.projectId !== projectId) {
      const fallbackTarget = await getWorkspaceTarget(
        bb,
        settings,
        discovered.projectId,
      );
      result = await runBdAtTarget(bb, fallbackTarget, args);
    }
  }
  if (!result.ok) {
    throw new Error(errorMessage(result));
  }
  return result.value;
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    projectId: {
      type: "project",
      label: "Project override",
      description:
        "Optional BB project to use when the current project cannot be discovered from the open page.",
    },
    workspacePath: {
      type: "string",
      label: "Workspace path override",
      description:
        "Optional absolute path containing .beads. This takes precedence over project selection and runs bd on the BB server host.",
      default: "",
    },
  });

  bb.rpc.register(rpcContract, {
    async listProjects() {
      const projects = await findBeadsProjects(bb);
      return {
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name?.trim() || project.id,
        })),
      };
    },
    async listIssues({ projectId, status, priority, query }) {
      const value = await runProjectBd(
        bb,
        settings,
        projectId,
        query
          ? queryIssuesArgs(query, { status, priority })
          : listIssuesArgs({ status, priority }),
      );
      return { issues: normalizeIssues(value) };
    },
    async showIssue({ projectId, id }) {
      const value = await runProjectBd(bb, settings, projectId, showIssueArgs(id));
      return { issue: asIssue(value) };
    },
    async createIssue({ projectId, title, type, priority, description }) {
      const value = await runProjectBd(
        bb,
        settings,
        projectId,
        createIssueArgs({ title, type, priority, description }),
      );
      return { issue: asIssue(value) };
    },
    async updateIssue({
      projectId,
      id,
      status,
      priority,
      title,
      description,
      acceptance,
    }) {
      const value = await runProjectBd(
        bb,
        settings,
        projectId,
        updateIssueArgs(id, {
          status,
          priority,
          title,
          description,
          acceptance,
        }),
      );
      return { issue: asIssue(value) };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
