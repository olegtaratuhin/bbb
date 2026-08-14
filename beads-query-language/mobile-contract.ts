/**
 * Platform-neutral contract for touch-oriented Beads query entry.
 *
 * This file describes state and intent, not a React component or a mobile UI
 * toolkit. Native, web, and remote BB clients can project the same contract
 * onto their own controls while continuing to use beads-query-language for grammar,
 * diagnostics, completion, and serialization.
 */

export type MobileQueryMode = "raw" | "builder";

/** The semantic state of the current source, from the user's point of view. */
export type MobileQueryInputState =
  | "empty"
  | "text"
  | "query-valid"
  | "query-incomplete"
  | "query-invalid";

export type MobileQueryFocus = "unfocused" | "focused" | "composing";
export type MobileQueryKeyboard = "hidden" | "visible" | "unknown";
export type MobileQuerySurface =
  | "none"
  | "completion"
  | "field-picker"
  | "operator-picker"
  | "value-picker"
  | "filter-builder"
  | "examples";

/** State that a platform adapter must be able to render and restore. */
export interface MobileQueryAssistState {
  mode: MobileQueryMode;
  inputState: MobileQueryInputState;
  source: string;
  /** UTF-16 cursor offset, matching beads-query-language spans and browser inputs. */
  cursor: number;
  selection?: { from: number; to: number };
  focus: MobileQueryFocus;
  keyboard: MobileQueryKeyboard;
  surface: MobileQuerySurface;
  /** True while an IME owns the composing range. */
  imeComposing: boolean;
  /** Last source/cursor pair to restore after a picker is dismissed. */
  restore?: { source: string; cursor: number };
}

/** Inputs emitted by a web/native adapter. No event mutates query semantics. */
export type MobileQueryAssistEvent =
  | { type: "focus" }
  | { type: "blur" }
  | { type: "input"; source: string; cursor: number }
  | { type: "selection-change"; cursor: number; selection?: { from: number; to: number } }
  | { type: "composition-start" }
  | { type: "composition-update"; source: string; cursor: number }
  | { type: "composition-end"; source: string; cursor: number }
  | { type: "open-surface"; surface: Exclude<MobileQuerySurface, "none"> }
  | { type: "dismiss-surface" }
  | { type: "switch-mode"; mode: MobileQueryMode }
  | { type: "restore-focus" }
  | { type: "keyboard"; state: MobileQueryKeyboard };

/**
 * Invariants for every implementation of the contract.
 *
 * - Raw mode is always available. Builder mode is an assistance surface, not
 *   a replacement grammar: its serialized source must pass through analyze().
 * - A completion is accepted only by applying its UTF-16 replacement span to
 *   the source. The resulting cursor is immediately after insertText.
 * - Input events received during IME composition update the visible source,
 *   but do not auto-open, accept, or dismiss completion surfaces.
 * - Opening a picker stores source/cursor in restore. Dismissal restores focus
 *   and that cursor unless the user committed a selection or changed source.
 * - Invalid and incomplete query states remain editable; they block execution
 *   but never block dismissal, mode switching, or recovery to raw text.
 * - Builder rows serialize left-to-right with explicit boolean connectors,
 *   preserving row order. Empty rows are omitted; an all-empty builder emits
 *   an empty source. The serialized source is validated before execution.
 */
export const MOBILE_QUERY_ASSIST_CONTRACT = {
  version: 1,
  minTouchTargetCssPx: 44,
  keyboardOcclusion: "keep-active-control-visible" as const,
  safeAreaInsets: "honor-platform-safe-area" as const,
  completion: {
    replacementOffsets: "utf16" as const,
    acceptCursor: "after-insert-text" as const,
    compositionPolicy: "defer-during-ime" as const,
  },
  builder: {
    emptyRowPolicy: "omit" as const,
    connectorPolicy: "explicit-between-rows" as const,
    validation: "beads-query-language-before-execution" as const,
  },
  accessibility: {
    inputRole: "combobox" as const,
    completionRole: "listbox" as const,
    completionOptionRole: "option" as const,
    builderRowLabel: "Filter condition" as const,
    dismissLabel: "Close query assistance" as const,
  },
} as const;

/** Deterministic product examples used by UI adapters and contract tests. */
export const MOBILE_QUERY_ASSIST_EXAMPLES = [
  {
    name: "field-to-value",
    source: "status=",
    cursor: 7,
    surface: "value-picker" as const,
    expectedSelection: "open",
  },
  {
    name: "recover-invalid-query",
    source: "priority=9",
    cursor: 10,
    surface: "none" as const,
    expectedAction: "edit-value-and-revalidate",
  },
  {
    name: "builder-with-connector",
    source: "status=open AND priority=1",
    cursor: 29,
    surface: "filter-builder" as const,
    expectedAction: "preserve-explicit-connector",
  },
] as const;
