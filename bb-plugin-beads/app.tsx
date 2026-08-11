import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
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
import { buildDependencyEdges, type DependencyEdge } from "./dependency-graph";
import {
  buildEpicProgress,
  getDescendantWorkIssues,
  getUnassignedWorkIssues,
  isContainerIssue,
  type EpicProgress,
} from "./epic-progress";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
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
const ISSUE_TYPES = [
  "task",
  "bug",
  "feature",
  "chore",
  "epic",
  "milestone",
];
type IssueStatus = (typeof STATUSES)[number];
const OTHER_STATUS = "__other" as const;
type BoardStatus = IssueStatus | typeof OTHER_STATUS;
type SortMode =
  | "manual"
  | "priority_desc"
  | "priority_asc"
  | "updated_desc"
  | "created_desc"
  | "title_asc";
type EpicSortMode =
  | "progress_desc"
  | "issues_desc"
  | "updated_desc"
  | "title_asc";

type ViewMode = "kanban" | "list" | "graph" | "epics";

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

const OTHER_STATUS_CONFIG = {
  label: "Other",
  dot: "bg-violet-500",
  badge:
    "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800",
  header: "border-t-violet-500",
};

const COLUMN_COUNT_BADGE_CLASS =
  "inline-flex h-4 min-w-4 items-center justify-center rounded bg-muted px-1.5 text-[11px] leading-4 text-muted-foreground";

const PRIORITIES = [0, 1, 2, 3, 4] as const;
const PRIORITY_LABELS: Record<number, string> = {
  0: "P0 · Critical",
  1: "P1 · High",
  2: "P2 · Medium",
  3: "P3 · Low",
  4: "P4 · Backlog",
};
const SORT_LABELS: Record<SortMode, string> = {
  manual: "Manual",
  priority_desc: "Priority (high → low)",
  priority_asc: "Priority (low → high)",
  updated_desc: "Updated (newest)",
  created_desc: "Created (newest)",
  title_asc: "Title (A–Z)",
};
const EPIC_SORT_LABELS: Record<EpicSortMode, string> = {
  progress_desc: "Progress (highest)",
  issues_desc: "Issue count (highest)",
  updated_desc: "Updated (newest)",
  title_asc: "Title (A–Z)",
};

function statusLabel(status: string | undefined) {
  const config = STATUS_CONFIG[status as IssueStatus];
  if (config) return config.label;
  if (!status?.trim()) return "Unknown";
  return status
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusBadgeClass(status: string | undefined) {
  return (
    STATUS_CONFIG[status as IssueStatus]?.badge ??
    OTHER_STATUS_CONFIG.badge
  );
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

function StatusIcon({
  status,
  className = "h-3.5 w-3.5",
}: {
  status: string | undefined;
  className?: string;
}) {
  const color =
    status === "blocked"
      ? "text-red-500"
      : status === "in_progress"
        ? "text-amber-500"
        : status === "closed"
          ? "text-emerald-500"
          : status === "open"
            ? "text-sky-500"
            : "text-muted-foreground";
  const ring = (dashed = false) => (
    <circle
      cx="7"
      cy="7"
      r="5.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      {...(dashed ? { strokeDasharray: "1.8 2" } : {})}
    />
  );

  return (
    <svg viewBox="0 0 14 14" aria-hidden className={`${color} ${className}`}>
      {status === "closed" ? (
        <>
          <circle cx="7" cy="7" r="5.4" fill="currentColor" />
          <path
            d="M4.4 7.2 l1.8 1.8 3.4-3.8"
            fill="none"
            stroke="var(--background)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : status === "blocked" ? (
        <>
          <circle cx="7" cy="7" r="5.4" fill="currentColor" />
          <path
            d="M5 5 l4 4 M9 5 l-4 4"
            stroke="var(--background)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      ) : status === "in_progress" ? (
        <>
          {ring()}
          <path d="M7 7 L7 2.4 A4.6 4.6 0 0 1 11.2 9.5 Z" fill="currentColor" />
        </>
      ) : status === "deferred" ? (
        ring(true)
      ) : (
        ring(true)
      )}
    </svg>
  );
}

function PriorityIcon({
  priority,
  className = "h-3.5 w-3.5",
}: {
  priority: number | undefined;
  className?: string;
}) {
  const normalized = priority === undefined ? 2 : Math.max(0, Math.min(4, priority));
  const activeBars = Math.max(0, Math.min(3, 4 - normalized));
  const bars = [
    { x: 1.5, y: 8, height: 5 },
    { x: 5.5, y: 5, height: 8 },
    { x: 9.5, y: 2, height: 11 },
  ];
  return (
    <svg viewBox="0 0 14 14" aria-hidden className={`text-muted-foreground ${className}`}>
      {bars.map((bar, index) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width="3"
          height={bar.height}
          rx="1"
          className={index < activeBars ? "fill-current" : "fill-muted"}
        />
      ))}
    </svg>
  );
}

function FilterChip({
  icon,
  label,
  selectedLabels,
  align = "start",
  children,
}: {
  icon: IconName;
  label: string;
  selectedLabels: readonly string[];
  align?: "start" | "end";
  children: ReactNode;
}) {
  const active = selectedLabels.length > 0;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<
    { top: number; left?: number; right?: number } | undefined
  >();

  useEffect(() => {
    if (!open) return;

    const positionMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuStyle({
        top: rect.bottom + 6,
        ...(align === "end"
          ? { right: window.innerWidth - rect.right }
          : { left: rect.left }),
      });
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [align, open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex h-6 cursor-pointer list-none items-center gap-1.5 rounded-md border px-2.5 text-xs [&::-webkit-details-marker]:hidden max-md:pointer-coarse:h-8 ${
          active
            ? "border-border bg-secondary text-foreground"
            : "border-dashed border-border text-muted-foreground hover:border-input hover:text-foreground"
        }`}
        aria-label={`${label} filter`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name={icon} className="h-3 w-3 shrink-0" aria-hidden="true" />
        {label}
        {active ? (
          <span className="max-w-44 truncate font-medium max-md:max-w-24">
            {selectedLabels.join(", ")}
          </span>
        ) : null}
        <Icon
          name="ChevronDown"
          className="h-3 w-3 shrink-0 opacity-60"
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          className="fixed z-50 max-h-[min(20rem,calc(100vh-1rem))] min-w-52 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
          style={menuStyle}
          role="group"
          aria-label={`${label} filter options`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function FilterOption({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-state-hover">
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input"
        }`}
        aria-hidden="true"
      >
        {checked ? <Icon name="Check" className="h-2.5 w-2.5" /> : null}
      </span>
      {children}
    </label>
  );
}

function sortIssues(issues: readonly Issue[], sort: SortMode) {
  if (sort === "manual") return [...issues];

  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => {
      let result = 0;
      if (sort === "priority_desc" || sort === "priority_asc") {
        const direction = sort === "priority_desc" ? 1 : -1;
        result =
          ((a.issue.priority ?? 2) - (b.issue.priority ?? 2)) * direction;
      } else if (sort === "updated_desc" || sort === "created_desc") {
        const field = sort === "updated_desc" ? "updated_at" : "created_at";
        const aDate = a.issue[field] ?? "";
        const bDate = b.issue[field] ?? "";
        result = String(bDate).localeCompare(String(aDate));
      } else if (sort === "title_asc") {
        result = a.issue.title.localeCompare(b.issue.title);
      }
      return result || a.index - b.index;
    })
    .map(({ issue }) => issue);
}

function IssueRow({ issue, onOpen }: { issue: Issue; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full min-h-10 cursor-pointer items-center gap-2 border-b border-border-hairline px-3 py-1.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onOpen}
    >
      <span className="shrink-0 text-[11px] font-mono text-muted-foreground">
        {issue.id}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{issue.title}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <PriorityIcon priority={issue.priority} className="h-3 w-3" />
          P{issue.priority ?? 2}
        </span>
      </span>
    </button>
  );
}

function IssueCard({ issue, onOpen }: { issue: Issue; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="w-full cursor-pointer rounded-md border border-border bg-card p-2.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <PriorityIcon priority={issue.priority} className="h-3 w-3" />
          P{issue.priority ?? 2}
        </span>
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
  status: BoardStatus;
}) {
  const config = status === OTHER_STATUS ? OTHER_STATUS_CONFIG : STATUS_CONFIG[status];
  return (
    <div className="flex flex-col gap-1.5">
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
          No {config.label.toLowerCase()} issues
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
  status: BoardStatus;
}) {
  const config = status === OTHER_STATUS ? OTHER_STATUS_CONFIG : STATUS_CONFIG[status];
  const [expanded, setExpanded] = useState(() => issues.length > 0);
  const headerClass = `flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold uppercase tracking-wide border-t-2 ${config.header}`;
  const header = (
    <>
      <span className="flex items-center gap-2">
        <StatusIcon status={status} className="h-3.5 w-3.5 shrink-0" />
        {config.label}
      </span>
      <span className="flex items-center gap-2">
        <span className={COLUMN_COUNT_BADGE_CLASS}>{issues.length}</span>
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
      className="group snap-start @md:flex @md:flex-1 @md:min-w-[10rem] @md:flex-col @md:gap-2"
    >
      <summary
        className={`${headerClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
      >
        {header}
      </summary>
      <div className="mt-2 @md:mt-0">
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
  visibleColumns: readonly BoardStatus[];
}) {
  const columns = useMemo(() => {
    const map = new Map<BoardStatus, Issue[]>();
    visibleColumns.forEach((s) => map.set(s, []));
    issues.forEach((issue) => {
      const bucket = STATUSES.includes(issue.status as IssueStatus)
        ? (issue.status as IssueStatus)
        : OTHER_STATUS;
      if (map.has(bucket)) {
        map.get(bucket)!.push(issue);
      }
    });
    return map;
  }, [issues, visibleColumns]);

  return (
    <>
      <div
        className="hidden overflow-x-auto pb-2 @md:block"
        role="region"
        aria-label="Kanban board"
      >
        <div className="mx-auto flex w-full min-w-[52rem] max-w-none snap-x snap-mandatory gap-2">
          {visibleColumns.map((status) => (
            <KanbanColumn
              key={status}
              issues={columns.get(status) ?? []}
              onOpenIssue={onOpenIssue}
              status={status}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 @md:hidden">
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

function IssueListView({
  issues,
  onOpenIssue,
}: {
  issues: Issue[];
  onOpenIssue: (issue: Issue) => void;
}) {
  const groups = useMemo(
    () => {
      const knownGroups = STATUSES.map((status) => ({
        status,
        issues: issues.filter((issue) => issue.status === status),
      })).filter((group) => group.issues.length > 0);
      const otherIssues = issues.filter(
        (issue) => !STATUSES.includes(issue.status as IssueStatus),
      );
      return otherIssues.length > 0
        ? [...knownGroups, { status: OTHER_STATUS, issues: otherIssues }]
        : knownGroups;
    },
    [issues],
  );

  return (
    <div className="grid gap-3">
      {groups.map((group) => {
        const config =
          group.status === OTHER_STATUS
            ? OTHER_STATUS_CONFIG
            : STATUS_CONFIG[group.status];
        return (
          <section key={group.status} aria-labelledby={`list-${group.status}`}>
            <div
              id={`list-${group.status}`}
              className="sticky top-0 z-10 flex items-center gap-2 border-b border-border-hairline bg-background px-1.5 pb-1.5 pt-1 text-xs font-semibold"
            >
              <StatusIcon
                status={group.status === OTHER_STATUS ? undefined : group.status}
                className="h-3.5 w-3.5 shrink-0"
              />
              {config.label}
              <span className="font-normal tabular-nums text-muted-foreground">
                {group.issues.length}
              </span>
            </div>
            <div>
              {group.issues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  onOpen={() => onOpenIssue(issue)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

type GraphRelationFilter = "all" | "blocking" | "hierarchy" | "related";

const GRAPH_RELATION_LABELS: Record<GraphRelationFilter, string> = {
  all: "All relationships",
  blocking: "Blocking",
  hierarchy: "Hierarchy",
  related: "Related",
};

const GRAPH_NODE_WIDTH = 196;
const GRAPH_NODE_HEIGHT = 68;
const GRAPH_COLUMN_GAP = 52;
const GRAPH_ROW_GAP = 24;

interface GraphNodePosition {
  issue: Issue;
  x: number;
  y: number;
  layer: number;
}

function graphEdgeLabel(edge: DependencyEdge) {
  if (edge.relation === "blocking") return "Blocks";
  if (edge.relation === "hierarchy") return "Parent / child";
  if (edge.relation === "related") return "Related";
  return edge.type;
}

function layoutDependencyGraph(
  issues: readonly Issue[],
  edges: readonly DependencyEdge[],
) {
  const nodeIds = new Set<string>();
  for (const edge of edges) {
    nodeIds.add(edge.fromId);
    nodeIds.add(edge.toId);
  }
  const graphIssues = issues
    .filter((issue) => nodeIds.has(issue.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const levels = new Map(graphIssues.map((issue) => [issue.id, 0]));

  // Longest-path layering keeps blockers and parents to the left. The
  // bounded passes also keep malformed/cyclic dependency data renderable.
  for (let pass = 0; pass < graphIssues.length; pass++) {
    let changed = false;
    for (const edge of edges) {
      const nextLevel = (levels.get(edge.fromId) ?? 0) + 1;
      if (nextLevel > (levels.get(edge.toId) ?? 0)) {
        levels.set(edge.toId, nextLevel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byLayer = new Map<number, Issue[]>();
  for (const issue of graphIssues) {
    const layer = levels.get(issue.id) ?? 0;
    const bucket = byLayer.get(layer) ?? [];
    bucket.push(issue);
    byLayer.set(layer, bucket);
  }

  const nodes: GraphNodePosition[] = [];
  for (const [layer, layerIssues] of [...byLayer.entries()].sort(
    ([a], [b]) => a - b,
  )) {
    layerIssues.sort((a, b) => a.id.localeCompare(b.id));
    layerIssues.forEach((issue, index) => {
      nodes.push({
        issue,
        layer,
        x: 24 + layer * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP),
        y: 24 + index * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP),
      });
    });
  }

  const maxLayer = Math.max(...nodes.map((node) => node.layer), 0);
  const maxRows = Math.max(
    ...[...byLayer.values()].map((layerIssues) => layerIssues.length),
    1,
  );
  return {
    nodes,
    width: Math.max(680, 48 + (maxLayer + 1) * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP)),
    height: Math.max(260, 48 + maxRows * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP)),
  };
}

function DependencyGraphView({
  issues,
  focusedIssueId,
  onOpenIssue,
}: {
  issues: Issue[];
  focusedIssueId: string | null;
  onOpenIssue: (issue: Issue) => void;
}) {
  const [relationFilter, setRelationFilter] =
    useState<GraphRelationFilter>("all");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
    focusedIssueId,
  );
  const allEdges = useMemo(() => buildDependencyEdges(issues), [issues]);
  const edges = useMemo(
    () =>
      relationFilter === "all"
        ? allEdges
        : allEdges.filter((edge) => edge.relation === relationFilter),
    [allEdges, relationFilter],
  );
  const layout = useMemo(
    () => layoutDependencyGraph(issues, edges),
    [edges, issues],
  );
  const positions = useMemo(
    () => new Map(layout.nodes.map((node) => [node.issue.id, node])),
    [layout.nodes],
  );

  useEffect(() => {
    setSelectedIssueId(focusedIssueId);
  }, [focusedIssueId]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Dependency graph</h2>
          <p className="text-xs text-muted-foreground">
            {layout.nodes.length} issues · {edges.length} relationships
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          Relationship
          <select
            aria-label="Filter graph relationships"
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground"
            value={relationFilter}
            onChange={(event) =>
              setRelationFilter(event.target.value as GraphRelationFilter)
            }
          >
            {(Object.keys(GRAPH_RELATION_LABELS) as GraphRelationFilter[]).map(
              (option) => (
                <option key={option} value={option}>
                  {GRAPH_RELATION_LABELS[option]}
                </option>
              ),
            )}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-px w-5 bg-destructive" aria-hidden="true" />
          Blocks
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-px w-5 border-t border-dashed border-muted-foreground"
            aria-hidden="true"
          />
          Parent / child
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-px w-5 border-t border-dotted border-muted-foreground"
            aria-hidden="true"
          />
          Related
        </span>
      </div>

      {layout.nodes.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No {relationFilter === "all" ? "dependencies" : GRAPH_RELATION_LABELS[relationFilter].toLowerCase()} in this view.
          </CardContent>
        </Card>
      ) : (
        <div
          className="overflow-auto rounded-md border border-border bg-muted/20"
          role="region"
          aria-label="Issue dependency graph"
        >
          <div
            className="relative"
            style={{ width: layout.width, height: layout.height }}
          >
            <svg
              className="pointer-events-none absolute inset-0"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="beads-graph-arrow"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L7,3.5 L0,7 z" fill="var(--destructive)" />
                </marker>
                <marker
                  id="beads-graph-muted-arrow"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path
                    d="M0,0 L7,3.5 L0,7 z"
                    fill="var(--muted-foreground)"
                  />
                </marker>
              </defs>
              {edges.map((edge) => {
                const from = positions.get(edge.fromId);
                const to = positions.get(edge.toId);
                if (!from || !to) return null;
                const startX = from.x + GRAPH_NODE_WIDTH;
                const startY = from.y + GRAPH_NODE_HEIGHT / 2;
                const endX = to.x;
                const endY = to.y + GRAPH_NODE_HEIGHT / 2;
                const controlX = (startX + endX) / 2;
                const selected =
                  selectedIssueId === edge.fromId ||
                  selectedIssueId === edge.toId;
                const stroke =
                  edge.relation === "blocking"
                    ? "var(--destructive)"
                    : "var(--muted-foreground)";
                return (
                  <path
                    key={edge.id}
                    d={`M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={selected ? 2 : 1.25}
                    strokeDasharray={
                      edge.relation === "hierarchy"
                        ? "5 4"
                        : edge.relation === "related"
                          ? "2 4"
                          : undefined
                    }
                    opacity={selectedIssueId && !selected ? 0.2 : 0.75}
                    markerEnd={
                      edge.directed
                        ? edge.relation === "blocking"
                          ? "url(#beads-graph-arrow)"
                          : "url(#beads-graph-muted-arrow)"
                        : undefined
                    }
                  >
                    <title>{graphEdgeLabel(edge)}</title>
                  </path>
                );
              })}
            </svg>
            {layout.nodes.map(({ issue, x, y }) => {
              const selected = selectedIssueId === issue.id;
              return (
                <button
                  key={issue.id}
                  type="button"
                  className={`absolute flex flex-col justify-between rounded-md border bg-card p-2 text-left shadow-sm transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    selected ? "border-primary bg-secondary" : "border-border"
                  }`}
                  style={{
                    left: x,
                    top: y,
                    width: GRAPH_NODE_WIDTH,
                    height: GRAPH_NODE_HEIGHT,
                  }}
                  aria-label={`Open ${issue.id}: ${issue.title}`}
                  aria-pressed={selected}
                  onClick={() => {
                    setSelectedIssueId(issue.id);
                    onOpenIssue(issue);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
                    <span className="truncate text-[11px] text-muted-foreground">
                      {issue.id}
                    </span>
                    <PriorityIcon
                      priority={issue.priority}
                      className="ml-auto h-3 w-3"
                    />
                  </span>
                  <span className="line-clamp-2 text-xs font-medium">
                    {issue.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function EpicProgressCard({
  progress,
  onOpenIssue,
}: {
  progress: EpicProgress;
  onOpenIssue: (issue: Issue) => void;
}) {
  const typeLabel = progress.container.issue_type === "milestone"
    ? "Milestone"
    : "Epic";

  return (
    <button
      type="button"
      className="group flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={() => onOpenIssue(progress.container)}
    >
      <span className="flex min-w-0 items-center justify-between gap-3">
        <span className="inline-flex shrink-0 items-center rounded-md bg-muted px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {typeLabel}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {progress.container.id}
        </span>
      </span>
      <span className="line-clamp-2 text-sm font-semibold">
        {progress.container.title}
      </span>
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {progress.total === 0
            ? "No child issues yet"
            : `${progress.completed} of ${progress.total} issues complete`}
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {progress.percentage}%
        </span>
      </span>
      <span
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${progress.container.title} completion`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percentage}
      >
        <span
          className="block h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${progress.percentage}%` }}
        />
      </span>
      <span className="flex flex-wrap gap-1.5">
        {STATUSES.map((status) => {
          const count = progress.statusCounts[status] ?? 0;
          if (count === 0) return null;
          return (
            <span
              key={status}
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${statusBadgeClass(status)}`}
            >
              {count} {statusLabel(status)}
            </span>
          );
        })}
      </span>
    </button>
  );
}

function EpicProgressView({
  issues,
  visibleIssues,
  statusFilter,
  onOpenIssue,
}: {
  issues: Issue[];
  visibleIssues: Issue[];
  statusFilter: readonly IssueStatus[];
  onOpenIssue: (issue: Issue) => void;
}) {
  const progress = useMemo(() => buildEpicProgress(issues), [issues]);
  const unassignedIds = useMemo(
    () => new Set(getUnassignedWorkIssues(issues).map((issue) => issue.id)),
    [issues],
  );
  const visibleProgress = useMemo(
    () =>
        progress.filter(
        (entry) =>
          statusFilter.length === 0 ||
          statusFilter.some((status) => (entry.statusCounts[status] ?? 0) > 0),
      ),
    [progress, statusFilter],
  );
  const visibleUnassigned = visibleIssues.filter((issue) =>
    unassignedIds.has(issue.id),
  );

  if (visibleProgress.length === 0 && visibleUnassigned.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No epics, milestones, or unassigned work match this view.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5">
      {visibleProgress.length > 0 ? (
        <section className="grid gap-3" aria-labelledby="epic-progress-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2
              id="epic-progress-heading"
              className="text-sm font-semibold"
            >
              Epics and milestones
            </h2>
            <span className="text-xs text-muted-foreground">
              {visibleProgress.length} {visibleProgress.length === 1 ? "container" : "containers"}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleProgress.map((entry) => (
              <EpicProgressCard
                key={entry.container.id}
                progress={entry}
                onOpenIssue={onOpenIssue}
              />
            ))}
          </div>
        </section>
      ) : null}

      {visibleUnassigned.length > 0 ? (
        <section className="grid gap-3" aria-labelledby="unassigned-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="unassigned-heading" className="text-sm font-semibold">
              Unassigned work
            </h2>
            <span className="text-xs text-muted-foreground">
              {visibleUnassigned.length} {visibleUnassigned.length === 1 ? "issue" : "issues"}
            </span>
          </div>
          <div className="grid gap-2">
            {visibleUnassigned.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                onOpen={() => onOpenIssue(issue)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function EpicNavigationRail({
  issues,
  selectedEpicId,
  onSelectEpic,
  onNewEpic,
}: {
  issues: Issue[];
  selectedEpicId: string | null;
  onSelectEpic: (id: string) => void;
  onNewEpic: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<IssueStatus[]>([]);
  const [selectedPriorities, setSelectedPriorities] = useState<number[]>([]);
  const [sortMode, setSortMode] = useState<EpicSortMode>("progress_desc");
  const progress = useMemo(() => buildEpicProgress(issues), [issues]);
  const visibleProgress = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return progress
      .filter((entry) => {
        const matchesQuery = normalizedQuery
          ? `${entry.container.id} ${entry.container.title}`
              .toLowerCase()
              .includes(normalizedQuery)
          : true;
        const matchesStatus =
          selectedStatuses.length === 0 ||
          selectedStatuses.includes(entry.container.status as IssueStatus);
        const matchesPriority =
          selectedPriorities.length === 0 ||
          selectedPriorities.includes(entry.container.priority ?? 2);
        return matchesQuery && matchesStatus && matchesPriority;
      })
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => {
        let result = 0;
        if (sortMode === "progress_desc") {
          result = b.entry.percentage - a.entry.percentage;
        } else if (sortMode === "issues_desc") {
          result = b.entry.total - a.entry.total;
        } else if (sortMode === "updated_desc") {
          result = String(b.entry.container.updated_at ?? "").localeCompare(
            String(a.entry.container.updated_at ?? ""),
          );
        } else {
          result = a.entry.container.title.localeCompare(b.entry.container.title);
        }
        return result || a.index - b.index;
      })
      .map(({ entry }) => entry);
  }, [progress, query, selectedPriorities, selectedStatuses, sortMode]);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-l border-border-hairline bg-background px-3 py-4 max-md:w-56">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Epics</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {visibleProgress.length} / {progress.length}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        className="mb-3 w-full justify-start"
        onClick={onNewEpic}
      >
        <Icon name="Plus" className="h-4 w-4" aria-hidden="true" />
        New epic
      </Button>
      <div className="grid gap-2">
        <Input
          aria-label="Search epics"
          placeholder="Search epics"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 text-xs"
        />
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5">
          <FilterChip
            icon="Circle"
            label="Status"
            selectedLabels={selectedStatuses.map(statusLabel)}
          >
            {STATUSES.map((option) => (
              <FilterOption
                key={option}
                checked={selectedStatuses.includes(option)}
                onChange={(checked) =>
                  setSelectedStatuses((current) =>
                    checked
                      ? current.includes(option)
                        ? current
                        : [...current, option]
                      : current.filter((value) => value !== option),
                  )
                }
              >
                <span className="flex items-center gap-2">
                  <StatusIcon status={option} className="h-3 w-3" />
                  {statusLabel(option)}
                </span>
              </FilterOption>
            ))}
          </FilterChip>
          <FilterChip
            icon="ArrowUpDown"
            label="Priority"
            selectedLabels={selectedPriorities.map(
              (priority) => PRIORITY_LABELS[priority],
            )}
          >
            {PRIORITIES.map((option) => (
              <FilterOption
                key={option}
                checked={selectedPriorities.includes(option)}
                onChange={(checked) =>
                  setSelectedPriorities((current) =>
                    checked
                      ? current.includes(option)
                        ? current
                        : [...current, option]
                      : current.filter((value) => value !== option),
                  )
                }
              >
                <span className="flex items-center gap-2">
                  <PriorityIcon priority={option} className="h-3 w-3" />
                  {PRIORITY_LABELS[option]}
                </span>
              </FilterOption>
            ))}
          </FilterChip>
          <FilterChip
            icon="Sort"
            label="Sort"
            selectedLabels={
              sortMode === "progress_desc" ? [] : [EPIC_SORT_LABELS[sortMode]]
            }
            align="end"
          >
            {(Object.keys(EPIC_SORT_LABELS) as EpicSortMode[]).map((option) => (
              <FilterOption
                key={option}
                checked={sortMode === option}
                onChange={(checked) => {
                  if (checked) setSortMode(option);
                }}
              >
                {EPIC_SORT_LABELS[option]}
              </FilterOption>
            ))}
          </FilterChip>
          {selectedStatuses.length > 0 || selectedPriorities.length > 0 ? (
            <button
              type="button"
              className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-xs text-muted-foreground hover:border-input hover:text-foreground max-md:pointer-coarse:h-8"
              onClick={() => {
                setSelectedStatuses([]);
                setSelectedPriorities([]);
              }}
            >
              <Icon name="X" className="h-3 w-3" aria-hidden="true" />
              Clear
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {visibleProgress.length > 0 ? (
          visibleProgress.map((entry) => (
            <button
              key={entry.container.id}
              type="button"
              className={`w-full rounded-md border p-2.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                selectedEpicId === entry.container.id
                  ? "border-primary bg-secondary"
                  : "border-border"
              }`}
              aria-pressed={selectedEpicId === entry.container.id}
              onClick={() => onSelectEpic(entry.container.id)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <StatusIcon
                  status={entry.container.status}
                  className="h-3 w-3 shrink-0"
                />
                <span className="truncate text-xs font-medium">
                  {entry.container.title}
                </span>
              </span>
              <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                {entry.container.id}
              </span>
              <span className="mt-2 flex items-center gap-2">
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${entry.percentage}%` }}
                  />
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {entry.percentage}% · {entry.total}
                </span>
              </span>
            </button>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No epics match these controls.
          </div>
        )}
      </div>
    </aside>
  );
}

function EpicWorkspace({
  issues,
  visibleIssues,
  statusFilter,
  selectedEpicId,
  loading,
  onBack,
  onOpenIssue,
}: {
  issues: Issue[];
  visibleIssues: Issue[];
  statusFilter: readonly IssueStatus[];
  selectedEpicId: string | null;
  loading: boolean;
  onBack: () => void;
  onOpenIssue: (issue: Issue) => void;
}) {
  const selectedEpic = selectedEpicId
    ? issues.find((issue) => issue.id === selectedEpicId) ?? null
    : null;

  return (
    <div className="flex min-h-0 flex-col gap-4 @lg:flex-row">
      <div className="order-2 min-w-0 flex-1 @lg:order-1">
        {selectedEpic ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={onBack}
              >
                <Icon name="ChevronLeft" className="h-3.5 w-3.5" aria-hidden="true" />
                Back to epic progress
              </Button>
              <span className="min-w-0 truncate text-sm font-medium">
                Issues in {selectedEpic.title}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {visibleIssues.length} issues
              </span>
            </div>
            {loading && visibleIssues.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  Loading issues…
                </CardContent>
              </Card>
            ) : visibleIssues.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  No child issues match this view.
                </CardContent>
              </Card>
            ) : (
              <IssueListView issues={visibleIssues} onOpenIssue={onOpenIssue} />
            )}
          </>
        ) : loading && issues.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Loading epics…
            </CardContent>
          </Card>
        ) : (
          <EpicProgressView
            issues={issues}
            visibleIssues={visibleIssues}
            statusFilter={statusFilter}
            onOpenIssue={onOpenIssue}
          />
        )}
      </div>
    </div>
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
  initialType = "task",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: string;
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

  useEffect(() => {
    if (open) setType(initialType);
  }, [initialType, open]);

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
        <Button size="sm">
          <Icon name="Plus" className="h-4 w-4" aria-hidden="true" />
          New task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {type === "epic" ? "Create Beads epic" : "Create Beads issue"}
          </DialogTitle>
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
              placeholder={
                type === "epic" ? "What should this epic accomplish?" : "What needs to be done?"
              }
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
              {saving
                ? "Creating…"
                : type === "epic"
                  ? "Create epic"
                  : "Create issue"}
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
  childIssueCount,
  onViewChildren,
  onOpenLinkedIssue,
  onViewDependencies,
}: {
  issue: Issue;
  childIssueCount: number;
  onViewChildren: (issue: Issue) => void;
  onOpenLinkedIssue: (id: string) => void;
  onViewDependencies: () => void;
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

  const linkedIssues = [
    ...issue.dependencies.map((dependency) => ({
      id: dependency.depends_on_id,
      title: dependency.title ?? dependency.depends_on_id,
      relation: dependency.type,
      direction:
        ["blocks", "conditional-blocks", "waits-for"].includes(
          dependency.type,
        )
          ? "Blocked by"
          : dependency.type === "parent-child"
            ? "Parent / child"
          : "Related",
    })),
    ...issue.dependents.map((dependency) => ({
      id: dependency.issue_id,
      title: dependency.title ?? dependency.issue_id,
      relation: dependency.type,
      direction:
        ["blocks", "conditional-blocks", "waits-for"].includes(
          dependency.type,
        )
          ? "Blocks"
          : dependency.type === "parent-child"
            ? "Parent / child"
          : "Related",
    })),
  ];

  return (
    <div className="h-full overflow-y-auto px-1">
        <div className="mb-4 flex items-center gap-2">
          <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
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
      {isContainerIssue(issue) && childIssueCount > 0 ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Child issues</div>
            <div className="text-xs text-muted-foreground">
              {childIssueCount} descendant {childIssueCount === 1 ? "issue" : "issues"}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => onViewChildren(issue)}
          >
            <Icon name="ListView" className="h-3.5 w-3.5" aria-hidden="true" />
            View issues
          </Button>
        </div>
      ) : null}
      <div className="mb-4 rounded-md border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Dependencies</div>
            <div className="text-xs text-muted-foreground">
              {linkedIssues.length === 0
                ? "No linked issues"
                : `${linkedIssues.length} linked ${linkedIssues.length === 1 ? "issue" : "issues"}`}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={onViewDependencies}
          >
            <Icon name="Workflow" className="h-3.5 w-3.5" aria-hidden="true" />
            Open graph
          </Button>
        </div>
        {linkedIssues.length > 0 ? (
          <div className="grid gap-1">
            {linkedIssues.map((linked, index) => (
              <button
                key={`${linked.direction}:${linked.id}:${index}`}
                type="button"
                className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-state-hover"
                onClick={() => onOpenLinkedIssue(linked.id)}
              >
                <span className="shrink-0 text-muted-foreground">
                  {linked.direction}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {linked.title}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {linked.id}
                </span>
              </button>
            ))}
          </div>
        ) : null}
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
  const [selectedStatuses, setSelectedStatuses] = useState<IssueStatus[]>([]);
  const [selectedPriorities, setSelectedPriorities] = useState<number[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState("task");
  const [refresh, setRefresh] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [epicScopeId, setEpicScopeId] = useState<string | null>(null);
  const [graphFocusId, setGraphFocusId] = useState<string | null>(null);
  const [epicRailOpen, setEpicRailOpen] = useState(false);
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
  }, [rpcProjectId, refresh, workspacePathOverride, beadsQuery]);

  useEffect(() => {
    void loadDetail();
  }, [rpcProjectId, selectedId, refresh, workspacePathOverride]);

  const scopedIssues = useMemo(
    () =>
      epicScopeId === null
        ? issues
        : getDescendantWorkIssues(issues, epicScopeId),
    [epicScopeId, issues],
  );
  const detailChildIssueCount = useMemo(
    () => (detail ? getDescendantWorkIssues(issues, detail.id).length : 0),
    [detail, issues],
  );

  const visibleIssues = useMemo(() => {
    const statusFiltered =
      selectedStatuses.length === 0
        ? scopedIssues
        : scopedIssues.filter((issue) =>
            selectedStatuses.includes(issue.status as IssueStatus),
          );
    const priorityFiltered =
      selectedPriorities.length === 0
        ? statusFiltered
        : statusFiltered.filter((issue) =>
            selectedPriorities.includes(issue.priority ?? 2),
          );
    const textFiltered = beadsQuery
      ? priorityFiltered
      : priorityFiltered.filter((issue) => issueMatches(issue, query));
    return sortIssues(textFiltered, sortMode);
  }, [
    beadsQuery,
    query,
    selectedPriorities,
    selectedStatuses,
    scopedIssues,
    sortMode,
  ]);

  function openIssue(issue: Issue) {
    navigate.toPluginPanel("board", {
      subPath: `issue/${encodeURIComponent(issue.id)}`,
    });
  }

  function openLinkedIssue(id: string) {
    navigate.toPluginPanel("board", {
      subPath: `issue/${encodeURIComponent(id)}`,
    });
  }

  function closeDetail() {
    setDetail(null);
    navigate.toPluginPanel("board", { subPath: "", replace: true });
  }

  function openEpicIssues(issue: Issue) {
    setEpicScopeId(issue.id);
    setEpicRailOpen(true);
    setViewMode("epics");
    closeDetail();
  }

  function openEpicFromRail(id: string) {
    setEpicScopeId(id);
    setViewMode("epics");
  }

  function openDependencyGraph(issue: Issue) {
    setQuery("");
    setSelectedStatuses([]);
    setSelectedPriorities([]);
    setSortMode("manual");
    setEpicScopeId(null);
    setGraphFocusId(issue.id);
    setViewMode("graph");
    closeDetail();
  }

  function startNewEpic() {
    setCreateType("epic");
    setCreateOpen(true);
  }

  function handleCreateOpenChange(open: boolean) {
    setCreateOpen(open);
    if (!open) setCreateType("task");
  }

  function returnToEpicProgress() {
    setEpicScopeId(null);
    setEpicRailOpen(true);
    setViewMode("epics");
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
    const columns: BoardStatus[] =
      selectedStatuses.length === 0
        ? [...STATUSES]
        : selectedStatuses.length > 0
          ? [...selectedStatuses]
          : [...STATUSES];
    if (
      selectedStatuses.length === 0 &&
      scopedIssues.some((issue) => !STATUSES.includes(issue.status as IssueStatus))
    ) {
      columns.push(OTHER_STATUS);
    }
    return columns;
  }, [scopedIssues, selectedStatuses]);

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
    <div className="@container flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border-hairline bg-background px-3.5 py-1.5">
        <div className="w-full">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="flex shrink-0 overflow-hidden rounded-md border border-border"
              role="group"
              aria-label="Issue view"
            >
              <Button
                type="button"
                size="sm"
                variant={viewMode === "kanban" ? "secondary" : "ghost"}
                className="rounded-none"
                onClick={() => {
                  setEpicScopeId(null);
                  setGraphFocusId(null);
                  setViewMode("kanban");
                }}
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
                onClick={() => {
                  setEpicScopeId(null);
                  setGraphFocusId(null);
                  setViewMode("list");
                }}
                aria-pressed={viewMode === "list"}
                aria-label="List view"
              >
                List
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === "graph" ? "secondary" : "ghost"}
                className="rounded-none border-l border-border"
                onClick={() => {
                  setEpicScopeId(null);
                  setGraphFocusId(null);
                  setViewMode("graph");
                }}
                aria-pressed={viewMode === "graph"}
                aria-label="Dependency graph view"
              >
                Graph
              </Button>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label="Refresh issues"
                onClick={() => setRefresh((value) => value + 1)}
              >
                <Icon name="RotateCcw" className="h-4 w-4" aria-hidden="true" />
              </Button>
              <CreateIssueDialog
                open={createOpen}
                onOpenChange={handleCreateOpenChange}
                initialType={createType}
                onCreate={createIssue}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label={epicRailOpen ? "Hide epic sidebar" : "Show epic sidebar"}
                aria-pressed={epicRailOpen}
                onClick={() => setEpicRailOpen((open) => !open)}
              >
                <Icon name="PanelRight" className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 border-t border-border-hairline pt-1">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
              <div className="flex min-w-[12rem] flex-1 @md:max-w-[28rem]">
                <Input
                  aria-label="Search Beads issues"
                  placeholder="Search issues or query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-8 min-w-0 focus-visible:border-ring focus-visible:ring-0"
                />
              </div>
              <FilterChip
                icon="Circle"
                label="Status"
                selectedLabels={selectedStatuses.map(statusLabel)}
              >
                {STATUSES.map((option) => (
                  <FilterOption
                    key={option}
                    checked={selectedStatuses.includes(option)}
                    onChange={(checked) =>
                      setSelectedStatuses((current) =>
                        checked
                          ? current.includes(option)
                            ? current
                            : [...current, option]
                          : current.filter((value) => value !== option),
                      )
                    }
                  >
                    <span className="flex items-center gap-2">
                      <StatusIcon status={option} className="h-3 w-3" />
                      {statusLabel(option)}
                    </span>
                  </FilterOption>
                ))}
              </FilterChip>
              <FilterChip
                icon="ArrowUpDown"
                label="Priority"
                selectedLabels={selectedPriorities.map(
                  (priority) => PRIORITY_LABELS[priority],
                )}
              >
                {PRIORITIES.map((priority) => (
                  <FilterOption
                    key={priority}
                    checked={selectedPriorities.includes(priority)}
                    onChange={(checked) =>
                      setSelectedPriorities((current) =>
                        checked
                          ? current.includes(priority)
                            ? current
                            : [...current, priority]
                          : current.filter((value) => value !== priority),
                      )
                    }
                  >
                    <span className="flex items-center gap-2">
                      <PriorityIcon priority={priority} className="h-3 w-3" />
                      {PRIORITY_LABELS[priority]}
                    </span>
                  </FilterOption>
                ))}
              </FilterChip>
              {selectedStatuses.length > 0 || selectedPriorities.length > 0 ? (
                <button
                  type="button"
                  className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-xs text-muted-foreground hover:border-input hover:text-foreground max-md:pointer-coarse:h-8"
                  onClick={() => {
                    setSelectedStatuses([]);
                    setSelectedPriorities([]);
                  }}
                >
                  <Icon name="X" className="h-3 w-3" aria-hidden="true" />
                  Clear
                </button>
              ) : null}
            </div>
            <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              {loading ? "Loading…" : `${visibleIssues.length} issues`}
            </span>
            <FilterChip
              icon="Sort"
              label="Sort"
              selectedLabels={sortMode === "manual" ? [] : [SORT_LABELS[sortMode]]}
              align="end"
            >
              {(Object.keys(SORT_LABELS) as SortMode[]).map((option) => (
                <FilterOption
                  key={option}
                  checked={sortMode === option}
                  onChange={(checked) => {
                    if (checked) setSortMode(option);
                  }}
                >
                  {SORT_LABELS[option]}
                </FilterOption>
              ))}
            </FilterChip>
          </div>
          {error ? (
            <div className="mt-3">
              <ErrorCard message={error} />
            </div>
          ) : null}
        </div>
      </div>

      {/* Content area */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="w-full">
          {viewMode === "epics" ? (
            <EpicWorkspace
              issues={issues}
              visibleIssues={visibleIssues}
              statusFilter={selectedStatuses}
              selectedEpicId={epicScopeId}
              loading={loading}
              onBack={returnToEpicProgress}
              onOpenIssue={openIssue}
            />
          ) : loading && visibleIssues.length === 0 ? (
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
          ) : viewMode === "list" ? (
            <IssueListView issues={visibleIssues} onOpenIssue={openIssue} />
          ) : viewMode === "graph" ? (
            <DependencyGraphView
              issues={visibleIssues}
              focusedIssueId={graphFocusId}
              onOpenIssue={openIssue}
            />
          ) : (
            <EpicProgressView
              issues={issues}
              visibleIssues={visibleIssues}
              statusFilter={selectedStatuses}
              onOpenIssue={openIssue}
            />
          )}
          </div>
        </div>
        {epicRailOpen ? (
          <EpicNavigationRail
            issues={issues}
            selectedEpicId={epicScopeId}
            onSelectEpic={openEpicFromRail}
            onNewEpic={startNewEpic}
          />
        ) : null}
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
              <IssueDetailsContent
                issue={detail}
                onUpdate={updateIssue}
                childIssueCount={detailChildIssueCount}
                onViewChildren={openEpicIssues}
                onOpenLinkedIssue={openLinkedIssue}
                onViewDependencies={() => openDependencyGraph(detail)}
              />
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
