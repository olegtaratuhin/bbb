import { Card, CardContent } from "../components/ui/card";
import type { ViewMode } from "./view-mode";

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} aria-hidden="true" />;
}

function KanbanSkeleton() {
  return (
    <div data-testid="beads-skeleton-kanban" className="grid gap-3 @md:grid-cols-2 @lg:grid-cols-3 @xl:grid-cols-5">
      {Array.from({ length: 5 }, (_, column) => (
        <div key={column} className="min-w-0 rounded-lg border border-border p-2">
          <div className="mb-3 flex items-center gap-2">
            <SkeletonBlock className="h-3 w-3 rounded-full" />
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="ml-auto h-4 w-5" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: column % 2 === 0 ? 3 : 2 }, (_, card) => (
              <div key={card} className="rounded-md border border-border p-3">
                <SkeletonBlock className="mb-2 h-3 w-3/4" />
                <SkeletonBlock className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <Card data-testid="beads-skeleton-list">
      <CardContent className="space-y-3 p-4">
        {Array.from({ length: 8 }, (_, row) => (
          <div key={row} className="flex items-center gap-3 rounded-md border border-border p-3">
            <SkeletonBlock className="h-3 w-24 shrink-0" />
            <SkeletonBlock className="h-4 flex-1" />
            <SkeletonBlock className="h-4 w-16 shrink-0" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function GraphSkeleton() {
  return (
    <Card data-testid="beads-skeleton-graph">
      <CardContent className="flex min-h-80 items-center justify-center p-6">
        <div className="grid w-full max-w-2xl grid-cols-3 items-center gap-4">
          <SkeletonBlock className="h-20" />
          <div className="space-y-3">
            <SkeletonBlock className="h-16" />
            <SkeletonBlock className="h-16" />
          </div>
          <SkeletonBlock className="h-20" />
        </div>
      </CardContent>
    </Card>
  );
}

function EpicSkeleton() {
  return (
    <Card data-testid="beads-skeleton-epics">
      <CardContent className="space-y-3 p-4">
        {Array.from({ length: 5 }, (_, row) => (
          <div key={row} className="rounded-md border border-border p-3">
            <SkeletonBlock className="h-4 w-1/2" />
            <SkeletonBlock className="mt-3 h-2 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function IssueViewSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === "list") return <ListSkeleton />;
  if (viewMode === "graph") return <GraphSkeleton />;
  if (viewMode === "epics") return <EpicSkeleton />;
  return <KanbanSkeleton />;
}
