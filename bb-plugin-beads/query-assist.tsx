import { useEffect, useRef, useState } from "react";
import { analyze } from "./query-core";
import {
  BUILT_IN_PRESETS,
  clearRow,
  createEmptyRow,
  getFieldChoices,
  getOperatorChoices,
  getValueChoices,
  parseSimpleFilterRows,
  serializePreset,
  serializeRows,
  updateRowField,
  updateRowOperator,
  updateRowValue,
  validateRows,
  type FilterConnector,
  type FilterRow,
} from "./query-core";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
import { Icon } from "./components/ui/icon";
import { Input } from "./components/ui/input";

interface QueryAssistProps {
  query: string;
  onQueryChange: (query: string) => void;
  assignee?: string;
  onClosed?: () => void;
}

type ApplyMode = "replace" | "compose";
type AssistTab = "presets" | "builder";

function firstError(rows: readonly FilterRow[]): string | undefined {
  return validateRows(rows).diagnostics[0]?.message;
}

export function QueryAssist({
  query,
  onQueryChange,
  assignee,
  onClosed,
}: QueryAssistProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AssistTab>("presets");
  const [applyMode, setApplyMode] = useState<ApplyMode>("replace");
  const [connector, setConnector] = useState<FilterConnector>("AND");
  const [rows, setRows] = useState<FilterRow[]>([createEmptyRow("builder-row-1")]);
  const [feedback, setFeedback] = useState<string>();
  const nextRowId = useRef(2);

  function initializeBuilder() {
    const draft = parseSimpleFilterRows(query);
    setRows(draft?.rows.length ? draft.rows : [createEmptyRow(`builder-row-${nextRowId.current++}`)]);
    setConnector(draft?.connector ?? "AND");
    setFeedback(undefined);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setTab("presets");
      setApplyMode("replace");
      initializeBuilder();
    } else {
      onClosed?.();
    }
  }

  function combine(nextQuery: string): string {
    if (applyMode === "replace" || !query.trim()) return nextQuery;
    const current = analyze(query);
    if (current.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      setFeedback("The current query has errors, so this filter will replace it.");
      return nextQuery;
    }
    return `(${query}) AND (${nextQuery})`;
  }

  function applyQuery(nextQuery: string) {
    const analysis = analyze(nextQuery);
    if (analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      setFeedback(analysis.diagnostics[0]?.message ?? "Enter a valid query.");
      return;
    }
    onQueryChange(combine(nextQuery));
    setOpen(false);
  }

  function applyPreset(name: string) {
    const preset = BUILT_IN_PRESETS.find((candidate) => candidate.name === name);
    if (!preset) return;
    const nextQuery = serializePreset(preset, { assignee });
    if (!nextQuery) {
      setFeedback("This filter needs an assignee supplied by BB.");
      return;
    }
    applyQuery(nextQuery);
  }

  function applyBuilder() {
    const validationMessage = firstError(rows);
    if (validationMessage) {
      setFeedback(validationMessage);
      return;
    }
    const nextQuery = serializeRows(rows, connector);
    if (!nextQuery) {
      setFeedback("Choose at least one filter.");
      return;
    }
    applyQuery(nextQuery);
  }

  useEffect(() => {
    if (!open) setFeedback(undefined);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 max-md:pointer-coarse:h-10 max-md:pointer-coarse:w-10"
          aria-label="Open query assistance"
        >
          <Icon name="SlidersHorizontal" className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl gap-3 p-4 max-md:pointer-coarse:max-h-[90dvh] max-md:pointer-coarse:overflow-y-auto max-md:pointer-coarse:p-4">
        <DialogHeader>
          <DialogTitle>Query assistance</DialogTitle>
          <DialogDescription>
            Use a preset or build a Beads query. The generated expression stays editable.
          </DialogDescription>
        </DialogHeader>

        <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Query assistance mode">
          <Button
            type="button"
            size="sm"
            variant={tab === "presets" ? "secondary" : "ghost"}
            className="min-h-9 flex-1 max-md:pointer-coarse:min-h-11"
            role="tab"
            aria-selected={tab === "presets"}
            onClick={() => setTab("presets")}
          >
            Quick filters
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "builder" ? "secondary" : "ghost"}
            className="min-h-9 flex-1 max-md:pointer-coarse:min-h-11"
            role="tab"
            aria-selected={tab === "builder"}
            onClick={() => setTab("builder")}
          >
            Build a query
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>When a query already exists:</span>
          <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="How to apply filter">
            <button
              type="button"
              className={`rounded px-2 py-1 max-md:pointer-coarse:min-h-9 ${applyMode === "replace" ? "bg-state-active text-foreground" : ""}`}
              aria-pressed={applyMode === "replace"}
              onClick={() => setApplyMode("replace")}
            >
              Replace
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 max-md:pointer-coarse:min-h-9 ${applyMode === "compose" ? "bg-state-active text-foreground" : ""}`}
              aria-pressed={applyMode === "compose"}
              onClick={() => setApplyMode("compose")}
            >
              Add with AND
            </button>
          </div>
        </div>

        {tab === "presets" ? (
          <div className="grid max-h-[min(28rem,50dvh)] gap-1.5 overflow-y-auto pr-1" role="list" aria-label="Beads query presets">
            {BUILT_IN_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-state-hover max-md:pointer-coarse:min-h-14"
                onClick={() => applyPreset(preset.name)}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{preset.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{preset.description}</span>
                </span>
                <Icon name="ArrowRight" className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">Filters</span>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Join with
                <select
                  aria-label="Join filters with"
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm text-foreground max-md:pointer-coarse:h-11"
                  value={connector}
                  onChange={(event) => setConnector(event.target.value as FilterConnector)}
                >
                  <option value="AND">AND</option>
                  <option value="OR">OR</option>
                </select>
              </label>
            </div>
            <div className="grid max-h-[min(25rem,45dvh)] gap-2 overflow-y-auto pr-1">
              {rows.map((row, index) => {
                const field = getFieldChoices().find((choice) => choice.name === row.field);
                const values = getValueChoices(row.field);
                return (
                  <div key={row.id} className="grid gap-1.5 rounded-md border border-border p-2">
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 text-center text-xs text-muted-foreground">{index + 1}</span>
                      <select
                        aria-label={`Filter ${index + 1} field`}
                        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm text-foreground max-md:pointer-coarse:h-11"
                        value={row.field}
                        onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? updateRowField(item, event.target.value) : item))}
                      >
                        <option value="">Choose field</option>
                        {getFieldChoices().map((choice) => <option key={choice.name} value={choice.name}>{choice.label}</option>)}
                      </select>
                      <select
                        aria-label={`Filter ${index + 1} operator`}
                        className="h-9 w-16 rounded-md border border-input bg-transparent px-2 text-sm text-foreground max-md:pointer-coarse:h-11"
                        value={row.operator}
                        onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? updateRowOperator(item, event.target.value as FilterRow["operator"]) : item))}
                      >
                        {getOperatorChoices(row.field).map((operator) => <option key={operator.label} value={operator.label}>{operator.label}</option>)}
                      </select>
                      <button
                        type="button"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground max-md:pointer-coarse:h-11 max-md:pointer-coarse:w-11"
                        aria-label={`Clear filter ${index + 1}`}
                        onClick={() => setRows((current) => current.map((item) => item.id === row.id ? clearRow(item) : item))}
                      >
                        <Icon name="X" className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    {field?.values ? (
                      <select
                        aria-label={`Filter ${index + 1} value`}
                        className="ml-5 h-9 rounded-md border border-input bg-transparent px-2 text-sm text-foreground max-md:pointer-coarse:ml-0 max-md:pointer-coarse:h-11"
                        value={row.value}
                        onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? updateRowValue(item, event.target.value) : item))}
                      >
                        <option value="">Choose value</option>
                        {values.map((choice) => <option key={choice.label} value={choice.label}>{choice.label}</option>)}
                      </select>
                    ) : (
                      <Input
                        aria-label={`Filter ${index + 1} value`}
                        className="ml-5 h-9 max-md:pointer-coarse:ml-0 max-md:pointer-coarse:h-11"
                        placeholder={field?.valueKind === "date" ? "e.g. 7d or today" : "Enter a value"}
                        value={row.value}
                        onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? updateRowValue(item, event.target.value) : item))}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              className="min-h-10 max-md:pointer-coarse:min-h-12"
              onClick={() => setRows((current) => [...current, createEmptyRow(`builder-row-${nextRowId.current++}`)])}
            >
              <Icon name="Plus" className="h-4 w-4" aria-hidden="true" />
              Add filter
            </Button>
          </div>
        )}

        {feedback ? <p className="text-xs text-destructive" role="alert">{feedback}</p> : null}
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="mr-2 font-medium text-foreground">Current query</span>
          <code className="break-all">{query || "No query"}</code>
        </div>
        <DialogFooter className="flex-row justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onQueryChange("")}>
            Clear
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="ghost">Cancel</Button>
          </DialogClose>
          {tab === "builder" ? (
            <Button type="button" onClick={applyBuilder}>Apply filters</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
