import type { ReactNode } from "react";

export function BeadsToolbarFrame({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      data-testid="beads-toolbar"
      className="shrink-0 border-b border-border-hairline bg-background px-3.5 py-1.5"
    >
      {children}
    </div>
  );
}
