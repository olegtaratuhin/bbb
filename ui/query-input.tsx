import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { type CompletionItem, type HighlightSpan } from "../query-core";
import { applyCompletion, createQueryEditorModel } from "../query-core/editor-model";
import { Input } from "../components/ui/input";
import { QueryAssist } from "./query-assist";

const HIGHLIGHT_CLASSES: Record<HighlightSpan["kind"], string> = {
  field: "text-sky-600 dark:text-sky-400",
  operator: "text-violet-600 dark:text-violet-400",
  keyword: "font-semibold text-amber-600 dark:text-amber-400",
  string: "text-emerald-600 dark:text-emerald-400",
  number: "text-orange-600 dark:text-orange-400",
  duration: "text-orange-600 dark:text-orange-400",
  date: "text-orange-600 dark:text-orange-400",
  identifier: "text-foreground",
  punctuation: "text-muted-foreground",
  invalid: "underline decoration-destructive decoration-wavy text-destructive",
};

export function QueryInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputFrameRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(value.length);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [floatingPosition, setFloatingPosition] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const editorModel = useMemo(
    () => createQueryEditorModel(value, cursor),
    [cursor, value],
  );
  const queryMode = editorModel.queryMode;
  const queryHighlights = editorModel.highlights;
  const suggestions = focused ? editorModel.completions.slice(0, 8) : [];
  const diagnostics = editorModel.diagnostics;

  useEffect(() => {
    setActiveSuggestion(0);
  }, [value, cursor]);

  useLayoutEffect(() => {
    if ((!focused && diagnostics.length === 0) || (focused && suggestions.length === 0 && diagnostics.length === 0)) {
      setFloatingPosition(null);
      return;
    }

    const frame = inputFrameRef.current;
    if (!frame) return;
    const frameElement: HTMLDivElement = frame;

    function updateCompletionPosition() {
      const rect = frameElement.getBoundingClientRect();
      setFloatingPosition({
        left: rect.left,
        top: rect.bottom + 4,
        width: rect.width,
      });
    }

    updateCompletionPosition();
    window.addEventListener("resize", updateCompletionPosition);
    window.addEventListener("scroll", updateCompletionPosition, true);
    return () => {
      window.removeEventListener("resize", updateCompletionPosition);
      window.removeEventListener("scroll", updateCompletionPosition, true);
    };
  }, [diagnostics.length, focused, suggestions.length]);

  function updateCursor() {
    setCursor(inputRef.current?.selectionStart ?? value.length);
  }

  function acceptSuggestion(item: CompletionItem) {
    const next = applyCompletion(value, item);
    onChange(next.source);
    setCursor(next.cursor);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  let highlightedOffset = 0;
  const highlightedContent: ReactNode[] = [];
  for (const [index, span] of queryHighlights.entries()) {
    if (span.from > highlightedOffset) {
      highlightedContent.push(
        <span key={`gap-${index}`}>{value.slice(highlightedOffset, span.from)}</span>,
      );
    }
    highlightedContent.push(
      <span key={`${span.from}-${span.to}`} className={HIGHLIGHT_CLASSES[span.kind]}>
        {value.slice(span.from, span.to)}
      </span>,
    );
    highlightedOffset = span.to;
  }
  if (highlightedOffset < value.length) {
    highlightedContent.push(<span key="tail">{value.slice(highlightedOffset)}</span>);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <div ref={inputFrameRef} className="relative h-8">
        {queryMode ? (
          <div
            aria-hidden="true"
            data-testid="beads-query-highlight"
            className="pointer-events-none absolute inset-x-px inset-y-px z-[1] flex items-center overflow-hidden whitespace-pre px-3 font-[inherit] text-sm leading-5"
          >
            {highlightedContent}
          </div>
        ) : null}
        <Input
          ref={inputRef}
          aria-label="Search Beads issues"
          aria-describedby={diagnostics.length > 0 ? "beads-query-diagnostics" : undefined}
          aria-controls={focused && suggestions.length > 0 ? "beads-query-completions" : undefined}
          aria-activedescendant={
            focused && suggestions[activeSuggestion]
              ? `beads-query-completion-${suggestions[activeSuggestion]!.kind}-${suggestions[activeSuggestion]!.label}`
              : undefined
          }
          placeholder="Search issues or query"
          value={value}
          onFocus={() => {
            setFocused(true);
            setActiveSuggestion(0);
            updateCursor();
          }}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onClick={updateCursor}
          onKeyUp={updateCursor}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length > 0) {
              event.preventDefault();
              setActiveSuggestion((current) => Math.min(current + 1, suggestions.length - 1));
            } else if (event.key === "ArrowUp" && suggestions.length > 0) {
              event.preventDefault();
              setActiveSuggestion((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter" && suggestions[activeSuggestion]) {
              event.preventDefault();
              acceptSuggestion(suggestions[activeSuggestion]!);
            } else if (event.key === "Escape") {
              setFocused(false);
            }
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setCursor(event.target.selectionStart ?? event.target.value.length);
          }}
          className={`h-8 min-w-0 pr-28 @max-md:pr-10 font-[inherit] text-sm leading-5 focus-visible:border-ring focus-visible:ring-0 ${queryMode ? "relative z-[2] bg-transparent text-transparent caret-foreground selection:bg-primary/20" : ""}`}
        />
        <div className="absolute right-0.5 top-1/2 z-[3] -translate-y-1/2">
          <QueryAssist
            query={value}
            onQueryChange={onChange}
            onClosed={() => {
              requestAnimationFrame(() => {
                inputRef.current?.focus();
                const nextCursor = inputRef.current?.value.length ?? value.length;
                inputRef.current?.setSelectionRange(nextCursor, nextCursor);
                setCursor(nextCursor);
              });
            }}
          />
        </div>
        {focused && suggestions.length > 0 && floatingPosition && typeof document !== "undefined"
          ? createPortal(
              <div
                role="listbox"
                aria-label="Beads query completions"
                aria-orientation="vertical"
                id="beads-query-completions"
                data-testid="beads-query-completion-surface"
                style={{
                  "--beads-query-completion-left": `${floatingPosition.left}px`,
                  "--beads-query-completion-top": `${floatingPosition.top}px`,
                  "--beads-query-completion-width": `${floatingPosition.width}px`,
                } as React.CSSProperties}
                className="fixed left-[var(--beads-query-completion-left)] top-[var(--beads-query-completion-top)] z-50 mt-0 grid w-[var(--beads-query-completion-width)] max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 text-xs shadow-md [scrollbar-width:thin] max-md:pointer-coarse:inset-x-3 max-md:pointer-coarse:bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-md:pointer-coarse:top-auto max-md:pointer-coarse:w-auto max-md:pointer-coarse:max-h-[min(20rem,45dvh)] max-md:pointer-coarse:rounded-xl max-md:pointer-coarse:p-2 max-md:pointer-coarse:text-base max-md:pointer-coarse:shadow-lg"
              >
                {suggestions.map((item) => (
                  <button
                    key={`${item.kind}-${item.label}`}
                    id={`beads-query-completion-${item.kind}-${item.label}`}
                    type="button"
                    role="option"
                    aria-selected={suggestions[activeSuggestion] === item}
                    className={`flex min-h-11 items-center justify-between gap-3 rounded px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground max-md:pointer-coarse:min-h-12 max-md:pointer-coarse:px-3.5 max-md:pointer-coarse:py-2.5 ${suggestions[activeSuggestion] === item ? "bg-accent text-accent-foreground" : ""}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => acceptSuggestion(item)}
                  >
                    <span>{item.label}</span>
                    {item.detail ? <span className="text-muted-foreground">{item.detail}</span> : null}
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null}
      </div>
      {diagnostics.length > 0 && suggestions.length === 0 && floatingPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              id="beads-query-diagnostics"
              role="alert"
              style={{
                "--beads-query-completion-left": `${floatingPosition.left}px`,
                "--beads-query-completion-top": `${floatingPosition.top}px`,
                "--beads-query-completion-width": `${floatingPosition.width}px`,
              } as React.CSSProperties}
              className="fixed left-[var(--beads-query-completion-left)] top-[var(--beads-query-completion-top)] z-50 max-w-[min(24rem,calc(100vw-1.5rem))] truncate rounded-md border border-destructive/30 bg-popover px-2.5 py-1.5 text-[11px] text-destructive shadow-md"
            >
              {diagnostics[0]?.message}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
