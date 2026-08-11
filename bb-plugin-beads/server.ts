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
    dependencies: z.array(z.unknown()),
    dependents: z.array(z.unknown()),
  })
  .passthrough();

const projectInput = z.object({ projectId: z.string().min(1).optional() });
const issueIdInput = projectInput.extend({ id: z.string().min(1) });

const issueOutput = z.object({ issue: issueSchema });

export const rpcContract = defineRpcContract({
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

function errorMessage(result: { kind: string; message?: string; stderr?: string; error?: string }) {
  if (result.kind === "spawn") {
    return result.message ?? "Unable to start bd";
  }
  if (result.kind === "parse") {
    return result.error ?? "bd returned invalid JSON";
  }
  return result.stderr?.trim() || "bd command failed";
}

function asIssue(value: unknown): Issue {
  const issue = normalizeIssues(value)[0];
  if (!issue || !issue.id) {
    throw new Error("bd returned no issue");
  }
  return issue;
}

async function getWorkspacePath(
  bb: BbPluginApi,
  settings: BeadsSettings,
  projectId?: string,
) {
  const configured = await settings.get();
  const target = resolveWorkspaceTarget({
    configuredProjectId: configured.projectId,
    projectId,
    workspacePath: configured.workspacePath,
  });
  if (target === null) {
    throw new Error(
      "No BB project is selected. Open a project in BB or configure a Beads project/path override in Settings.",
    );
  }
  if (target.kind === "path") return target.path;

  const project = await bb.sdk.projects.get({ projectId: target.projectId });
  const source = selectLocalWorkspaceSource(
    project.sources as readonly ProjectSourceLike[],
  );
  return source.path!.trim();
}

async function runProjectBd(
  bb: BbPluginApi,
  settings: BeadsSettings,
  projectId: string | undefined,
  args: readonly string[],
) {
  const cwd = await getWorkspacePath(bb, settings, projectId);
  const result = await runBdJson(args, { cwd });
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
