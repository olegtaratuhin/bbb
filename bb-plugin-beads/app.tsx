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
import { Icon } from "@/components/ui/icon";
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

type ViewMode = "kanban" | "list";

const STATUS_CONFIG: Record<
  IssueStatus,
  { label: string; dot: string; badge: string; header: string }
> = {
  open: {
    label: "Open",
    dot: "bg-sky-500",
    badge: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
    header: "border-t-sky-500",
  },
  in_progress: {
    label: "In Progress",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    header: "border-t-amber-500",
  },
  blocked: {
    label: "Blocked",
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
    header: "border-t-red-500",
  },
  deferred: {
    label: "Deferred",
    dot: "bg-zinc-400",
    badge: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-300 dark:border-zinc-700",
    header: "border-t-zinc-400",
  },
  closed: {
    label: "Closed",
    dot: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
    header: "border-t-emerald-500",
  },
};

const ISSUE_COUNT_BADGE_CLASS =
  "inline-flex h-8 items-center rounded-md bg-muted px-2 text-xs text-muted-foreground";

function statusLabel(status: string | undefined) {
  return STATUS_CONFIG[status as IssueStatus]?.label ?? "unknown";
}

function statusBadgeClass(status: string | undefined) {
  return STATUS_CONFIG[status as IssueStatus]?.badge ?? "bg-muted text-muted-foreground border-border";
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

const QUERY_FIELD_PATTERN =
  /\b(?:status|priority|type|assignee|owner|label|title|description|notes|created|updated|started|closed|id|spec|pinned|ephemeral|template|parent|mol_type)\s*(?:!=|>=|<=|=|>|<)\s*[^\s()]+/i;

function isBeadsQuery(value: string) {
  const query = value.trim();
  if (
    !query ||
    /(?:AND|OR|NOT)\s*$/i.test(query) ||
    /(?:!=|>=|<=|=|>|<)\s*$/i.test(query)
  ) {
    return false;
  }
  return QUERY_FIELD_PATTERN.test(query);
}

function IssueRow({ issue, onOpen }: { issue: Issue; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onOpen}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs text-muted-foreground">
          {issue.id}
        </span>
        <span className="mt-0.5 block truncate font-medium">{issue.title}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(issue.status)}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_CONFIG[issue.status as IssueStatus]?.dot ?? "bg-muted-foreground"}`} />
          {statusLabel(issue.status)}
        </span>
        <span className="text-xs text-muted-foreground">P{issue.priority ?? 2}</span>
      </span>
    </button>
  );
}

function IssueCard({ issue, onOpen }: { issue: Issue; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="w-full cursor-pointer rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onOpen}
    >
      <span className="mb-1 block truncate text-xs text-muted-foreground">
        {issue.id}
      </span>
      <span className="mb-2 block line-clamp-2 text-sm font-medium">
        {issue.title}
      </span>
      <span className="flex items-center gap-2">
        {issue.issue_type ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs capitalize text-muted-foreground">
            {issue.issue_type}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">P{issue.priority ?? 2}</span>
      </span>
    </button>
  );
}

function KanbanColumnBody({
  issues,
  onOpenIssue,
  status,
}: {
  issues: Issue[];
  onOpenIssue: (issue: Issue) => void;
  status: IssueStatus;
}) {
  return (
    <div className="flex flex-col gap-2">
      {issues.length > 0 ? (
        issues.map((issue) => (
          <IssueCard
            key={issue.id}
            issue={issue}
            onOpen={() => onOpenIssue(issue)}
          />
        ))
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No {STATUS_CONFIG[status].label.toLowerCase()} issues
        </div>
      )}
    </div>
  );
}

function KanbanColumn({
  issues,
  onOpenIssue,
  status,
}: {
  issues: Issue[];
  onOpenIssue: (issue: Issue) => void;
  status: IssueStatus;
}) {
  const config = STATUS_CONFIG[status];
  const [expanded, setExpanded] = useState(() => issues.length > 0);
  const headerClass = `flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold uppercase tracking-wide border-t-2 ${config.header}`;
  const header = (
    <>
      <span className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${config.dot}`} />
        {config.label}
      </span>
      <span className="flex items-center gap-2">
        <span className={ISSUE_COUNT_BADGE_CLASS}>{issues.length}</span>
        <Icon
          name="ChevronDown"
          className="h-4 w-4 normal-case transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </span>
    </>
  );

  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="group snap-start sm:flex sm:w-[15rem] sm:min-w-[15rem] sm:flex-col sm:gap-2"
    >
      <summary
        className={`${headerClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
      >
        {header}
      </summary>
      <div className="mt-2 sm:mt-0">
        <KanbanColumnBody
          issues={issues}
          onOpenIssue={onOpenIssue}
          status={status}
        />
      </div>
    </details>
  );
}

function KanbanBoard({
  issues,
  onOpenIssue,
  visibleColumns,
}: {
  issues: Issue[];
  onOpenIssue: (issue: Issue) => void;
  visibleColumns: readonly IssueStatus[];
}) {
  const columns = useMemo(() => {
    const map = new Map<IssueStatus, Issue[]>();
    visibleColumns.forEach((s) => map.set(s, []));
    issues.forEach((issue) => {
      const bucket = issue.status as IssueStatus;
      if (map.has(bucket)) {
        map.get(bucket)!.push(issue);
      }
    });
    return map;
  }, [issues, visibleColumns]);

  return (
    <>
      <div
        className="hidden snap-x snap-mandatory gap-3 overflow-x-auto pb-2 sm:flex"
        role="region"
        aria-label="Kanban board"
      >
        {visibleColumns.map((status) => (
          <KanbanColumn
            key={status}
            issues={columns.get(status) ?? []}
            onOpenIssue={onOpenIssue}
            status={status}
          />
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:hidden">
        {visibleColumns.map((status) => (
          <KanbanColumn
            key={status}
            issues={columns.get(status) ?? []}
            onOpenIssue={onOpenIssue}
            status={status}
          />
        ))}
      </div>
    </>
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

function IssueDetailsContent({
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

  const statusCfg = STATUS_CONFIG[issue.status as IssueStatus];

  return (
    <div className="h-full overflow-y-auto px-1">
        <div className="mb-4 flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusCfg?.dot ?? "bg-muted-foreground"}`} />
          <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(issue.status)}`}>
            {statusLabel(issue.status)}
          </span>
          <span className="text-xs text-muted-foreground">{issue.id}</span>
        </div>
        <div className="mb-4 rounded-md bg-muted/30 p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Description
          </div>
          {issue.description ? (
            <Markdown content={issue.description} />
          ) : (
            <span className="text-muted-foreground">No description.</span>
          )}
        </div>
      <div className="mt-4 border-t border-border bg-card p-4">
        <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
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
        <form className="grid gap-3" onSubmit={saveText}>
          <label className="grid gap-2 text-sm">
            Title
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="grid gap-2 text-sm">
            Description
            <textarea
              className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Acceptance criteria
            <textarea
              className="min-h-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={acceptance}
              onChange={(event) => setAcceptance(event.target.value)}
            />
          </label>
          <Button type="submit" size="sm" className="justify-self-start" disabled={saving}>
            {saving ? "Saving…" : "Save text"}
          </Button>
        </form>
      </div>
    </div>
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
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
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

  const detailOpen = selectedId !== null;
  const beadsQuery = isBeadsQuery(query) ? query.trim() : "";

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
        ...(beadsQuery ? { query: beadsQuery } : {}),
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
  }, [rpcProjectId, status, refresh, workspacePathOverride, beadsQuery]);

  useEffect(() => {
    void loadDetail();
  }, [rpcProjectId, selectedId, refresh, workspacePathOverride]);

  const visibleIssues = useMemo(
    () => (beadsQuery ? issues : issues.filter((issue) => issueMatches(issue, query))),
    [beadsQuery, issues, query],
  );

  function openIssue(issue: Issue) {
    navigate.toPluginPanel("board", {
      subPath: `issue/${encodeURIComponent(issue.id)}`,
    });
  }

  function closeDetail() {
    setDetail(null);
    navigate.toPluginPanel("board", { subPath: "", replace: true });
  }

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

  // Determine which columns to show based on status filter
  const visibleColumns = useMemo(() => {
    if (status === "all") return STATUSES;
    const filtered = status as IssueStatus;
    return STATUSES.includes(filtered) ? [filtered] : STATUSES;
  }, [status]);

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
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border p-4">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-center gap-2">
            <CreateIssueDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              onCreate={createIssue}
            />
            <div className="flex min-w-0 flex-[1_1_22rem] gap-2 sm:grid sm:max-w-[28rem] sm:grid-cols-[minmax(0,1fr)_10rem]">
              <Input
                aria-label="Search Beads issues"
                placeholder="Search issues or query"
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
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <div
                className="flex overflow-hidden rounded-md border border-border"
                role="group"
                aria-label="Beads view"
              >
                <Button
                  type="button"
                  size="sm"
                  variant={viewMode === "kanban" ? "secondary" : "ghost"}
                  className="rounded-none"
                  onClick={() => setViewMode("kanban")}
                  aria-pressed={viewMode === "kanban"}
                  aria-label="Kanban board view"
                >
                  Kanban
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  className="rounded-none border-l border-border"
                  onClick={() => setViewMode("list")}
                  aria-pressed={viewMode === "list"}
                  aria-label="List view"
                >
                  List
                </Button>
              </div>
              <span className={ISSUE_COUNT_BADGE_CLASS}>
                {loading ? "Loading…" : `${visibleIssues.length} issues`}
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label="Refresh issues"
                onClick={() => setRefresh((value) => value + 1)}
              >
                <Icon name="RotateCcw" className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>
          {error ? (
            <div className="mt-3">
              <ErrorCard message={error} />
            </div>
          ) : null}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-7xl">
          {loading && visibleIssues.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Loading issues…
              </CardContent>
            </Card>
          ) : visibleIssues.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No issues match this view.
              </CardContent>
            </Card>
          ) : viewMode === "kanban" ? (
            <KanbanBoard
              issues={visibleIssues}
              onOpenIssue={openIssue}
              visibleColumns={visibleColumns}
            />
          ) : (
            <div className="grid gap-2">
              {visibleIssues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  onOpen={() => openIssue(issue)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={(open) => !open && closeDetail()}>
        <DialogContent className="max-h-[85vh] max-w-2xl gap-0 overflow-hidden p-0">
          <div className="overflow-hidden">
            <DialogHeader className="px-6 pt-6 pb-3">
              <DialogTitle className="truncate">
                {detail ? detail.title : "Loading…"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Issue detail and edit form
              </DialogDescription>
            </DialogHeader>
          </div>
          {detail ? (
            <div className="h-[min(70vh,32rem)] overflow-hidden sm:h-[calc(85vh-5rem)]">
              <IssueDetailsContent issue={detail} onUpdate={updateIssue} />
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">Loading issue…</div>
          )}
        </DialogContent>
      </Dialog>
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
