import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  definePluginApp,
  Markdown,
  useBbContext,
  useBbNavigate,
  useComposerView,
  useRpc,
  useSettings,
} from "@bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { Issue } from "./bd-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  chooseProjectId,
  projectIdFromComposerScope,
  readRootComposeProjectId,
} from "./project-context";

const STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "deferred",
  "closed",
] as const;
const ISSUE_TYPES = ["task", "bug", "feature", "chore", "epic"];
type IssueStatus = (typeof STATUSES)[number];

function statusLabel(status: string | undefined) {
  return status?.replaceAll("_", " ") ?? "unknown";
}

function issueMatches(issue: Issue, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return `${issue.id} ${issue.title} ${issue.description ?? ""}`
    .toLowerCase()
    .includes(normalizedQuery);
}

function IssueRow({ issue, onOpen }: { issue: Issue; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-start justify-between gap-4 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onOpen}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs text-muted-foreground">
          {issue.id}
        </span>
        <span className="mt-1 block truncate font-medium">{issue.title}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="capitalize">{statusLabel(issue.status)}</span>
        <span>P{issue.priority ?? 2}</span>
      </span>
    </button>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-destructive/50">
      <CardContent className="p-4 text-sm text-destructive">
        {message}
      </CardContent>
    </Card>
  );
}

function CreateIssueDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    title: string;
    type: string;
    priority: number;
    description?: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("task");
  const [priority, setPriority] = useState("2");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        title: title.trim(),
        type,
        priority: Number(priority),
        description: description.trim() || undefined,
      });
      setTitle("");
      setDescription("");
      onOpenChange(false);
    } catch {
      // The parent renders the command error; keep the form open for retry.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">New issue</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Beads issue</DialogTitle>
          <DialogDescription>
            Add a tracked issue to the selected project.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-2 text-sm">
            Title
            <Input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What needs to be done?"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-2 text-sm">
              Type
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                {ISSUE_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              Priority
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                {[0, 1, 2, 3, 4].map((option) => (
                  <option key={option} value={option}>
                    P{option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="grid gap-2 text-sm">
            Description
            <textarea
              className="min-h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional context"
            />
          </label>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? "Creating…" : "Create issue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IssueDetails({
  issue,
  onUpdate,
}: {
  issue: Issue;
  onUpdate: (input: {
    status?: IssueStatus;
    priority?: number;
    title?: string;
    description?: string;
    acceptance?: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description ?? "");
  const [acceptance, setAcceptance] = useState(
    typeof issue.acceptance_criteria === "string"
      ? issue.acceptance_criteria
      : "",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(issue.title);
    setDescription(issue.description ?? "");
    setAcceptance(
      typeof issue.acceptance_criteria === "string"
        ? issue.acceptance_criteria
        : "",
    );
  }, [issue]);

  async function saveText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await onUpdate({
        title: title.trim(),
        description,
        acceptance,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>{issue.id}</CardDescription>
        <CardTitle>{issue.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-2">
            Status
            <select
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={issue.status ?? "open"}
              onChange={(event) => {
                void onUpdate({
                  status: event.target.value as IssueStatus,
                });
              }}
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            Priority
            <select
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={String(issue.priority ?? 2)}
              onChange={(event) => {
                void onUpdate({ priority: Number(event.target.value) });
              }}
            >
              {[0, 1, 2, 3, 4].map((priority) => (
                <option key={priority} value={priority}>
                  P{priority}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="rounded-md bg-muted/30 p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Description
          </div>
          {issue.description ? (
            <Markdown content={issue.description} />
          ) : (
            <span className="text-muted-foreground">No description.</span>
          )}
        </div>
        <form className="grid gap-3" onSubmit={saveText}>
          <label className="grid gap-2">
            Title
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="grid gap-2">
            Description
            <textarea
              className="min-h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="grid gap-2">
            Acceptance criteria
            <textarea
              className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={acceptance}
              onChange={(event) => setAcceptance(event.target.value)}
            />
          </label>
          <Button type="submit" size="sm" className="justify-self-start" disabled={saving}>
            {saving ? "Saving…" : "Save text"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function BeadsPanel({ subPath }: { subPath: string }) {
  const { projectId } = useBbContext();
  const composerView = useComposerView();
  const { values: settingValues, isLoading: settingsLoading } = useSettings();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [detail, setDetail] = useState<Issue | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [rootComposeProjectId, setRootComposeProjectId] = useState(() =>
    readRootComposeProjectId(
      typeof window === "undefined" ? undefined : window.localStorage,
    ),
  );
  const configuredProjectId =
    typeof settingValues?.projectId === "string"
      ? settingValues.projectId
      : null;
  const workspacePathOverride =
    typeof settingValues?.workspacePath === "string"
      ? settingValues.workspacePath.trim()
      : "";
  const currentProjectId = chooseProjectId({
    configuredProjectId,
    composerProjectId: projectIdFromComposerScope(composerView.scope),
    rootComposeProjectId,
    routeProjectId: projectId,
  });
  const rpcProjectId = workspacePathOverride ? undefined : currentProjectId;
  const selectedId = subPath.startsWith("issue/")
    ? decodeURIComponent(subPath.slice("issue/".length))
    : null;

  useEffect(() => {
    const refreshRootProject = () => {
      setRootComposeProjectId(readRootComposeProjectId(window.localStorage));
    };
    window.addEventListener("storage", refreshRootProject);
    window.addEventListener("focus", refreshRootProject);
    return () => {
      window.removeEventListener("storage", refreshRootProject);
      window.removeEventListener("focus", refreshRootProject);
    };
  }, []);

  async function loadIssues() {
    if (!rpcProjectId && !workspacePathOverride) {
      setIssues([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await rpc.call("listIssues", {
        ...(rpcProjectId ? { projectId: rpcProjectId } : {}),
        ...(status === "all" ? {} : { status }),
      });
      setIssues(result.issues as Issue[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Beads");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail() {
    if ((!rpcProjectId && !workspacePathOverride) || !selectedId) {
      setDetail(null);
      return;
    }
    try {
      const result = await rpc.call("showIssue", {
        ...(rpcProjectId ? { projectId: rpcProjectId } : {}),
        id: selectedId,
      });
      setDetail(result.issue as Issue);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load issue");
    }
  }

  useEffect(() => {
    void loadIssues();
  }, [rpcProjectId, status, refresh, workspacePathOverride]);

  useEffect(() => {
    void loadDetail();
  }, [rpcProjectId, selectedId, refresh, workspacePathOverride]);

  const visibleIssues = useMemo(
    () => issues.filter((issue) => issueMatches(issue, query)),
    [issues, query],
  );

  async function createIssue(input: {
    title: string;
    type: string;
    priority: number;
    description?: string;
  }) {
    if (!rpcProjectId && !workspacePathOverride) {
      return;
    }
    setError(null);
    try {
      const result = await rpc.call("createIssue", {
        ...(rpcProjectId ? { projectId: rpcProjectId } : {}),
        ...input,
      });
      setRefresh((value) => value + 1);
      navigate.toPluginPanel("board", {
        subPath: `issue/${encodeURIComponent((result.issue as Issue).id)}`,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create issue");
      throw cause;
    }
  }

  async function updateIssue(input: {
    status?: IssueStatus;
    priority?: number;
    title?: string;
    description?: string;
    acceptance?: string;
  }) {
    if ((!rpcProjectId && !workspacePathOverride) || !selectedId) {
      return;
    }
    setError(null);
    try {
      await rpc.call("updateIssue", {
        ...(rpcProjectId ? { projectId: rpcProjectId } : {}),
        id: selectedId,
        ...input,
      });
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update issue");
    }
  }

  if (settingsLoading) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Loading Beads settings…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!rpcProjectId && !workspacePathOverride) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle>Beads</CardTitle>
            <CardDescription>
              Open a BB project or configure a Beads project/path override in
              Settings → Extensions → Beads.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto grid max-w-5xl gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Beads</h1>
            <p className="text-sm text-muted-foreground">
              {workspacePathOverride
                ? `Workspace override: ${workspacePathOverride}`
                : "Project issues backed by the local bd CLI."}
            </p>
          </div>
          <CreateIssueDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreate={createIssue}
          />
        </div>
        {error ? <ErrorCard message={error} /> : null}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Input
            aria-label="Search Beads issues"
            placeholder="Search issues"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="Filter by status"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {statusLabel(option)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{loading ? "Loading…" : `${visibleIssues.length} issues`}</span>
            <Button variant="ghost" size="sm" onClick={() => setRefresh((value) => value + 1)}>
              Refresh
            </Button>
          </div>
          {visibleIssues.length > 0 ? (
            visibleIssues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                onOpen={() =>
                  navigate.toPluginPanel("board", {
                    subPath: `issue/${encodeURIComponent(issue.id)}`,
                  })
                }
              />
            ))
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                {loading ? "Loading issues…" : "No issues match this view."}
              </CardContent>
            </Card>
          )}
        </div>
        {detail ? (
          <IssueDetails issue={detail} onUpdate={updateIssue} />
        ) : selectedId && !error ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Loading issue…
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "configuration",
    title: "Project resolution",
    description: "Choose how Beads finds the workspace for bd.",
    component: () => (
      <p className="text-sm text-muted-foreground">
        Beads follows the project open in BB when available. Use Project
        override to pin another BB project, or Workspace path override for an
        arbitrary local path containing .beads.
      </p>
    ),
  });
  app.slots.navPanel({
    id: "board",
    title: "Beads",
    icon: "ListTodo",
    path: "board",
    component: BeadsPanel,
  });
});
