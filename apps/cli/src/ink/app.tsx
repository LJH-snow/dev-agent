import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, useState } from "react";
import { Box, Text, measureElement, useApp, useCursor, useInput, usePaste, useStdin, useStdout, type DOMElement, type SuspendTerminal } from "ink";

import {
  DEFAULT_COMMAND_HINTS,
  type CommandHint,
} from "../tui-renderer.js";
import { renderSignalLoomMark } from "../tui-brand.js";
import type { TuiStateSnapshot } from "../tui-session.js";
import { displayWidth, fitDisplayLine, splitByDisplayWidth, truncateToDisplayWidth } from "../tui-width.js";
import { InkUiController, type InkUiSnapshot } from "../ink-ui.js";
import {
  InkRuntimeStore,
  type InkRunSummary,
  type InkRuntimeSnapshot,
} from "./runtime-store.js";
import {
  deriveInkViewportLayout,
  InkViewportModel,
  type InkViewportSnapshot,
} from "./viewport.js";
import {
  MOUSE_TRACKING_DISABLE,
  MOUSE_TRACKING_ENABLE,
  MouseInputParser,
  type MouseClick,
  type MouseMove,
  type MouseWheelDirection,
} from "./mouse-wheel.js";
import { KittyQueryResponseFilter } from "./kitty-query-response.js";
import { RetryPanel } from "./retry-panel.js";
import { ThinkingIndicator } from "./thinking-indicator.js";
import { ThoughtLine } from "./thought-line.js";
import { RotatingStatus } from "./rotating-status.js";
import { ToolTimeline } from "./tool-timeline.js";
import { MarkdownView, measureMarkdownRows } from "./markdown.js";
import { MAX_EDITOR_CHARS } from "./editor-suspend.js";
import {
  COMMAND_PALETTE_VISIBLE,
  CommandPalette,
  commandPaletteRowAt,
  type CommandPaletteLayout,
} from "./command-palette.js";
import { HistoryPanel } from "./history-panel.js";
import { SessionPicker } from "./session-picker.js";
import { PlanReviewPanel } from "./plan-review-panel.js";
import { CollaborationPanel } from "./collaboration-panel.js";
import { McpPanel } from "./mcp-panel.js";
import { InkThemeProvider, getInkTheme, useInkTheme } from "./theme.js";
import { useInkFocusRouter } from "./focus-router.js";
import {
  completeWorkspacePath,
  type PathCompletionResult,
} from "../path-completion.js";

export interface InkCliAppProps {
  readonly store: InkRuntimeStore;
  readonly provider: string;
  readonly model: string;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly executor: string;
  readonly terminalRowsOffset?: number;
  readonly mcpCount?: number;
  readonly commands?: readonly CommandHint[];
  readonly onSubmit: (value: string) => void;
  readonly onCancel: () => void;
  readonly onExit: () => void;
  readonly controller?: InkUiController;
  readonly approvalPrompt?: string;
  readonly textPrompt?: string;
  readonly onApprovalAnswer?: (value: string) => void;
  readonly onRetry?: () => void;
  readonly onDismissRetry?: () => void;
  readonly onSessionResume?: (index: number) => void;
  readonly onDismissSessionPicker?: () => void;
  readonly onSuspendTerminalReady?: (suspendTerminal: SuspendTerminal) => void;
}

const EMPTY_UI_SNAPSHOT: InkUiSnapshot = {
  busy: false,
  queuedPrompts: [],
  theme: "signal",
};
const NOOP_SUBSCRIBE = (): (() => void) => () => undefined;
const EMPTY_GET_SNAPSHOT = (): InkUiSnapshot => EMPTY_UI_SNAPSHOT;
// Pasted blocks land in the composer capped at this many characters so a
// runaway clipboard cannot stall the frame loop; anything beyond is dropped
// and surfaced as a one-line notice above the composer.
export const MAX_PASTE_CHARS = 8_000;
// Opt-in IME cursor placement: positions the terminal cursor at the caret so
// CJK composition windows open in the right place. Off by default because the
// absolute row depends on the terminal honoring the frame-height contract.
const IME_CURSOR_ENABLED = process.env.DEV_AGENT_IME_CURSOR === "1";
const DEFAULT_BOTTOM_SHELL_ROWS = 8;

export function InkCliApp({
  store,
  provider,
  model,
  sessionId,
  workingDirectory,
  executor,
  terminalRowsOffset = 0,
  mcpCount = 0,
  commands = DEFAULT_COMMAND_HINTS,
  onSubmit,
  onCancel,
  onExit,
  controller,
  approvalPrompt,
  textPrompt,
  onApprovalAnswer,
  onRetry,
  onDismissRetry,
  onSessionResume,
  onDismissSessionPicker,
  onSuspendTerminalReady,
}: InkCliAppProps): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const inputSnapshot = useSyncExternalStore(
    controller?.subscribe ?? NOOP_SUBSCRIBE,
    controller === undefined ? EMPTY_GET_SNAPSHOT : controller.snapshot.bind(controller),
    controller === undefined ? EMPTY_GET_SNAPSHOT : controller.snapshot.bind(controller),
  );
  const { stdout, write } = useStdout();
  const { suspendTerminal } = useApp();
  const { isRawModeSupported } = useStdin();
  useEffect(() => {
    onSuspendTerminalReady?.(suspendTerminal);
  }, [onSuspendTerminalReady, suspendTerminal]);
  const [, resize] = useState(0);
  useEffect(() => {
    const changed = (): void => resize((n) => n + 1);
    stdout.on("resize", changed);
    return () => { stdout.off("resize", changed); };
  }, [stdout]);
  const columns = Math.max(20, stdout.columns ?? process.stdout.columns ?? 80);
  const terminalRows = Math.max(
    12,
    (stdout.rows ?? process.stdout.rows ?? 24) - Math.max(0, terminalRowsOffset),
  );
  const shellRef = useRef<DOMElement>(null);
  // This is the complete scrollable frame (welcome, transcript, and dynamic
  // panels), not just the currently visible transcript rows. Its measured
  // height is the source of truth for totalRows.
  const contentRef = useRef<DOMElement>(null);
  const [shellRows, setShellRows] = useState(DEFAULT_BOTTOM_SHELL_ROWS);
  const [contentRows, setContentRows] = useState(0);
  const viewportLayout = deriveInkViewportLayout(terminalRows, shellRows);
  const visibleTranscriptRows = viewportLayout.visibleRows;
  const navigationRow = viewportLayout.navigationRow;
  const viewportMouseInput = useRef(new MouseInputParser()).current;
  const kittyQueryResponseFilter = useRef(new KittyQueryResponseFilter()).current;
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pasteTruncated, setPasteTruncated] = useState(false);
  const [editorTruncated, setEditorTruncated] = useState(false);
  // Composer text lives in a ref alongside the render state: input events can
  // arrive between throttled frames (maxFps), and a handler reading render
  // state would apply edits against a stale draft and silently drop content.
  const composerRef = useRef({ value: "", cursor: 0 });
  const applyComposer = useCallback((nextValue: string, nextCursor: number) => {
    composerRef.current = { value: nextValue, cursor: nextCursor };
    setValue(nextValue);
    setCursor(nextCursor);
  }, []);
  // External editor drafts (`:editor`) arrive through the runtime store. The
  // monotonic id makes repeated inserts of identical text effective, and the
  // same ref-backed application as paste keeps throttled frames from losing
  // the content.
  const lastComposerInsertIdRef = useRef(0);
  const composerInsert = snapshot.composerInsert;
  useEffect(() => {
    if (composerInsert === undefined || composerInsert.id === lastComposerInsertIdRef.current) {
      return;
    }
    lastComposerInsertIdRef.current = composerInsert.id;
    applyComposer(composerInsert.value, Array.from(composerInsert.value).length);
    setPasteTruncated(false);
    setEditorTruncated(composerInsert.truncated);
  }, [composerInsert, applyComposer]);
  const [mousePosition, setMousePosition] = useState<MouseMove | undefined>(undefined);
  const lastMousePosition = useRef<MouseMove | undefined>(undefined);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [pathCompletion, setPathCompletion] = useState<PathCompletionResult | undefined>(undefined);
  const [pathCompletionIndex, setPathCompletionIndex] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [paletteOffset, setPaletteOffset] = useState(0);
  const [paletteLayout, setPaletteLayout] = useState<CommandPaletteLayout | undefined>(undefined);
  const dismissedPathKey = useRef<string | undefined>(undefined);
  const [dismissedCommandKey, setDismissedCommandKey] = useState<string | undefined>(undefined);
  const viewportModel = useRef(new InkViewportModel({
    totalRows: 0,
    visibleRows: visibleTranscriptRows,
  })).current;
  const [viewport, setViewport] = useState<InkViewportSnapshot>(() =>
    viewportModel.snapshot(),
  );
  // Measure on every commit: panels rendered from component state (path
  // completion, command palette, queued prompts) change the scroll-content
  // height, while approval text and wrapped composer input change the bottom
  // shell height. The next render derives the clipped viewport from the
  // measured shell instead of relying on fixed row estimates.
  useLayoutEffect(() => {
    const shellHeight = measureBoxHeight(shellRef.current);
    const contentHeight = measureBoxHeight(contentRef.current);
    if (shellHeight !== undefined && shellHeight > 0 && shellHeight !== shellRows) {
      setShellRows(shellHeight);
    }
    if (contentHeight !== undefined && contentHeight !== contentRows) {
      setContentRows(contentHeight);
    }
  });
  const rememberMousePosition = useCallback((position: MouseMove): void => {
    const previous = lastMousePosition.current;
    if (previous?.x === position.x && previous.y === position.y) return;
    lastMousePosition.current = position;
    setMousePosition(position);
  }, []);
  const moveViewport = useCallback((
    direction: MouseWheelDirection,
    mode: "page" | "wheel" = "page",
  ): void => {
    const next = mode === "wheel"
      ? viewportModel.scrollBy(direction === "up" ? -3 : 3)
      : direction === "up"
        ? viewportModel.pageUp()
        : viewportModel.pageDown();
    setViewport(next);
  }, [viewportModel]);

  // Ink 7 keeps its stdin event emitter private. Enable mouse reports through
  // the public stream writer, then consume those reports in the single
  // useInput router below so mouse bytes never reach the composer.
  useEffect(() => {
    if (!isRawModeSupported) return;
    write(MOUSE_TRACKING_ENABLE);
    return () => {
      write(MOUSE_TRACKING_DISABLE);
    };
  }, [isRawModeSupported, write]);

  const rawSuggestions = commandSuggestions(value, commands);
  const commandPaletteKey = `${value}\u0000${JSON.stringify(rawSuggestions)}`;
  const suggestions = dismissedCommandKey === commandPaletteKey
    ? []
    : rawSuggestions;
  const activePaletteLayout = suggestions.length > 0 ? paletteLayout : undefined;
  const busy = inputSnapshot.busy ||
    (snapshot.state !== "ready" && snapshot.state !== "done" &&
      snapshot.state !== "error" && snapshot.state !== "interrupted");
  const queuedPrompts = inputSnapshot.queuedPrompts.length > 0
    ? inputSnapshot.queuedPrompts
    : snapshot.queuedPrompts;
  const activeApprovalPrompt = inputSnapshot.approvalPrompt ?? approvalPrompt;
  const activeTextPrompt = inputSnapshot.textPrompt ?? textPrompt;
  const activeInputPrompt = activeTextPrompt ?? activeApprovalPrompt;
  const { owner: focusOwner } = useInkFocusRouter({
    activeInputPrompt: activeInputPrompt !== undefined,
    sessionPicker: snapshot.sessionPicker !== undefined,
    pathCompletion: pathCompletion !== undefined,
    commandPalette: suggestions.length > 0,
    retry: snapshot.retry !== undefined,
  });
  const displayedSessionId = inputSnapshot.sessionId ?? sessionId;
  const pathCompletionKey = `${value}\u0000${cursor}`;
  const allTranscriptEntries = visibleTranscriptEntries(snapshot);
  // Keep one authoritative transcript source. Static transcript items cannot
  // be removed once Ink has emitted them, so switching from Static history to
  // a manual viewport would otherwise paint the same turns twice. Welcome and turns share the measured managed viewport.
  const transcriptEntries = allTranscriptEntries;
  // The task title is sticky only while the user is browsing away from live
  // output. During an active answer (or any normal follow-output state), the
  // title remains part of the transcript instead of taking a permanent row
  // from the live answer viewport.
  const navigationHovered = mousePosition !== undefined &&
    isNavigationBarHovered(mousePosition, navigationRow, viewport, columns);
  const transcriptRows = contentRows;
  // The run summary is a post-run diagnostic: show it once the run has
  // actually settled through the event stream (or under explicit debug), so
  // summaries that predate any run never announce stale `[timing]` lines.
  const showRunSummary = snapshot.summaryAnnounced ||
    process.env.DEV_AGENT_TUI_DEBUG === "1";
  const renderedViewport = viewport.followOutput
    ? {
        ...viewport,
        offset: Math.max(0, transcriptRows - visibleTranscriptRows),
        totalRows: transcriptRows,
        visibleRows: visibleTranscriptRows,
        followOutput: true,
        hiddenAbove: 0,
        hiddenBelow: 0,
        newOutput: 0,
      }
    : viewport;

  useEffect(() => {
    const next = viewportModel.setContent(transcriptRows, visibleTranscriptRows);
    setViewport((current) =>
      sameViewportSnapshot(current, next) ? current : next
    );
  }, [transcriptRows, viewportModel, visibleTranscriptRows]);

  useEffect(() => {
    setSuggestionIndex(0);
    setDismissedCommandKey((current) =>
      current === undefined || current === commandPaletteKey ? current : undefined,
    );
  }, [commandPaletteKey]);

  useEffect(() => {
    setSuggestionIndex((current) => suggestions.length === 0
      ? 0
      : Math.min(current, suggestions.length - 1));
    if (suggestions.length === 0) {
      setPaletteLayout(undefined);
      setPaletteOffset(0);
    }
  }, [suggestions.length]);

  // Keep the 6-row visible window on the selection so every prefix-matched
  // command stays keyboard-reachable; the window never scrolls otherwise.
  useEffect(() => {
    setPaletteOffset((current) => {
      const maxOffset = Math.max(0, suggestions.length - COMMAND_PALETTE_VISIBLE);
      const clamped = Math.min(current, maxOffset);
      if (suggestionIndex < clamped) return suggestionIndex;
      if (suggestionIndex >= clamped + COMMAND_PALETTE_VISIBLE) {
        return Math.max(0, suggestionIndex - COMMAND_PALETTE_VISIBLE + 1);
      }
      return clamped;
    });
  }, [suggestionIndex, suggestions.length]);

  useEffect(() => {
    let cancelled = false;
    if (activeInputPrompt !== undefined || rawSuggestions.length > 0) {
      setPathCompletion(undefined);
      setPathCompletionIndex(0);
      return () => {
        cancelled = true;
      };
    }
    if (dismissedPathKey.current === pathCompletionKey) {
      return () => {
        cancelled = true;
      };
    }

    void completeWorkspacePath(value, cursor, workingDirectory).then((result) => {
      if (cancelled) return;
      setPathCompletion(result);
      setPathCompletionIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeInputPrompt,
    cursor,
    pathCompletionKey,
    rawSuggestions.length,
    value,
    workingDirectory,
  ]);

  const submitPrompt = (submitted: string): void => {
    // A partial protocol prefix can never complete once the turn ends; drop
    // it so it cannot leak into the next turn's input.
    kittyQueryResponseFilter.reset();
    applyComposer("", 0);
    setPasteTruncated(false);
    setHistoryIndex(-1);
    dismissedPathKey.current = undefined;
    setPathCompletion(undefined);
    setPathCompletionIndex(0);
    setViewport(viewportModel.end());
    if (activeInputPrompt !== undefined) {
      onApprovalAnswer?.(submitted);
      return;
    }
    if (isExitCommand(submitted)) {
      onExit();
      return;
    }
    if (submitted.trim().length > 0) {
      setHistory((items) => [...items, submitted]);
      onSubmit(submitted);
    }
  };

  const insertText = (text: string): void => {
    if (text.length === 0) return;
    const chars = Array.from(composerRef.current.value);
    const insertion = Array.from(text);
    const room = MAX_PASTE_CHARS - chars.length;
    if (room <= 0) {
      setPasteTruncated(true);
      return;
    }
    const capped = insertion.slice(0, room);
    if (capped.length < insertion.length) setPasteTruncated(true);
    chars.splice(composerRef.current.cursor, 0, capped.join(""));
    applyComposer(chars.join(""), composerRef.current.cursor + capped.length);
  };

  // Acts on one highlighted palette row: complete commands submit directly,
  // template commands with an argument placeholder are filled into the
  // composer so the user can complete the argument (which also closes the
  // palette because the filled text no longer prefix-matches any command).
  const acceptCommandSuggestion = (index: number): void => {
    if (suggestions.length === 0) return;
    const selected = Math.min(Math.max(index, 0), suggestions.length - 1);
    const suggestion = suggestions[selected];
    if (suggestion === undefined) return;
    if (commandSuggestionNeedsInput(suggestion.command)) {
      applyComposer(suggestion.command, Array.from(suggestion.command).length);
    } else {
      submitPrompt(suggestion.command);
    }
  };

  const choosePathSuggestion = (index: number): void => {
    const suggestion = pathCompletion?.suggestions[index];
    if (!suggestion || pathCompletion === undefined) return;
    const chars = Array.from(composerRef.current.value);
    const replacement = `@${suggestion.path}`;
    chars.splice(
      pathCompletion.tokenStart,
      pathCompletion.tokenEnd - pathCompletion.tokenStart,
      replacement,
    );
    applyComposer(
      chars.join(""),
      pathCompletion.tokenStart + Array.from(replacement).length,
    );
    setPathCompletion(undefined);
    setPathCompletionIndex(0);
    dismissedPathKey.current = undefined;
  };

  usePaste((text: string) => {
    // Ink 7 routes bracketed paste through a dedicated channel, preserving
    // newlines and keeping the composer key router focused on key presses.
    const normalized = Array.from(text.replace(/\r\n?/gu, "\n"));
    setPasteTruncated(normalized.length > MAX_PASTE_CHARS);
    setEditorTruncated(false);
    insertText(normalized.slice(0, MAX_PASTE_CHARS).join(""));
  });

  useInput((input, key) => {
    const kittyQuery = kittyQueryResponseFilter.push(input);
    if (kittyQuery.consumed) {
      if (kittyQuery.input.length === 0) return;
      input = kittyQuery.input;
    }
    // Ink 7 detaches its readable listener during suspendTerminal(). A PTY
    // can replay the command bytes that were buffered at the handoff when the
    // listener is reattached; consume one such event before it can submit the
    // freshly loaded editor draft. Ctrl-C remains a real cancellation signal.
    if (store.getSnapshot().inputSuppressed === true) {
      store.setInputSuppressed(false);
      if (key.ctrl && (input === "c" || input === "\u0003")) {
        onCancel();
      }
      return;
    }
    const mouseInput = viewportMouseInput.push(input);
    for (const direction of mouseInput.directions) {
      if (focusOwner === "commandPalette" && suggestions.length > 0) {
        // With the palette open the wheel moves the highlighted row instead
        // of the transcript, bounded at the list ends without wrapping.
        setSuggestionIndex((index) => {
          const current = Math.min(Math.max(index, 0), suggestions.length - 1);
          return direction === "up"
            ? Math.max(0, current - 1)
            : Math.min(suggestions.length - 1, current + 1);
        });
        continue;
      }
      moveViewport(direction, "wheel");
    }
    for (const move of mouseInput.moves) {
      rememberMousePosition(move);
    }
    for (const click of mouseInput.clicks) {
      rememberMousePosition({ x: click.x, y: click.y });
      const paletteRow = focusOwner === "commandPalette"
        ? commandPaletteRowAt(click, activePaletteLayout, suggestions.length)
        : undefined;
      if (paletteRow !== undefined) {
        // Rows are window-relative; the offset maps them onto the full
        // suggestion list. The first click selects the row; clicking the
        // already-selected row accepts it, mirroring the Enter behavior.
        const absoluteRow = paletteRow + paletteOffset;
        const currentSelection = Math.min(
          Math.max(suggestionIndex, 0),
          suggestions.length - 1,
        );
        if (absoluteRow === currentSelection) {
          acceptCommandSuggestion(absoluteRow);
        } else {
          setSuggestionIndex(absoluteRow);
        }
        continue;
      }
      if (isBackToBottomClick(
        click,
        navigationRow,
        viewportModel.snapshot(),
        columns,
      )) {
        setViewport(viewportModel.end());
      }
    }
    if (mouseInput.consumed) {
      if (mouseInput.remaining.length === 0) return;
      input = mouseInput.remaining;
    }
    // When the kitty keyboard protocol is active, Ink also delivers key-release
    // events with the same fields as presses; acting on them would register
    // every key twice, so only press events reach the composer.
    if (key.eventType !== undefined && key.eventType !== "press") return;
    if (key.ctrl && (input === "c" || input === "\u0003")) {
      onCancel();
      return;
    }
    // Some terminals expose Home/End as raw escape sequences without Ink's
    // parsed key flags. Handle those sequences before the generic Escape path.
    const draft = composerRef.current;
    const sessionPicker = snapshot.sessionPicker;
    const rawHome = input === "\u001b[H" || input === "\u001b[1~";
    const rawEnd = input === "\u001b[F" || input === "\u001b[4~";
    if (
      (focusOwner === "composer" || focusOwner === "retry") &&
      draft.value.length === 0 &&
      pathCompletion === undefined &&
      suggestions.length === 0 &&
      (rawHome || rawEnd)
    ) {
      const next = rawHome ? viewportModel.home() : viewportModel.end();
      setViewport(next);
      return;
    }
    if (key.escape) {
      switch (focusOwner) {
        case "prompt":
          onApprovalAnswer?.("");
          break;
        case "sessionPicker":
          onDismissSessionPicker?.();
          break;
        case "pathCompletion":
          dismissedPathKey.current = pathCompletionKey;
          setPathCompletion(undefined);
          setPathCompletionIndex(0);
          break;
        case "commandPalette":
          setDismissedCommandKey(commandPaletteKey);
          setSuggestionIndex(0);
          break;
        case "retry":
          if (onDismissRetry) {
            onDismissRetry();
          } else {
            store.setRetry(undefined);
          }
          break;
        case "composer":
          onCancel();
          break;
      }
      return;
    }
    if (focusOwner === "sessionPicker" && sessionPicker !== undefined) {
      if (key.upArrow) {
        const next = sessionPicker.selectedIndex - 1;
        store.setSessionPickerIndex(
          next < 0 ? sessionPicker.rows.length - 1 : next,
        );
        return;
      }
      if (key.downArrow) {
        const next = sessionPicker.selectedIndex + 1;
        store.setSessionPickerIndex(
          next >= sessionPicker.rows.length ? 0 : next,
        );
        return;
      }
      if (key.return) {
        onSessionResume?.(sessionPicker.selectedIndex);
        return;
      }
      return;
    }
    if (
      (focusOwner === "composer" || focusOwner === "retry") &&
      key.pageUp
    ) {
      moveViewport("up");
      return;
    }
    if (
      (focusOwner === "composer" || focusOwner === "retry") &&
      key.pageDown
    ) {
      moveViewport("down");
      return;
    }
    if (
      (focusOwner === "composer" || focusOwner === "retry") &&
      draft.value.length === 0 &&
      pathCompletion === undefined &&
      suggestions.length === 0 &&
      key.home
    ) {
      const next = viewportModel.home();
      setViewport(next);
      return;
    }
    if (
      (focusOwner === "composer" || focusOwner === "retry") &&
      draft.value.length === 0 &&
      pathCompletion === undefined &&
      suggestions.length === 0 &&
      key.end
    ) {
      const next = viewportModel.end();
      setViewport(next);
      return;
    }
    if (
      focusOwner === "retry" &&
      !busy &&
      draft.value.length === 0 &&
      input.toLowerCase() === "r"
    ) {
      onRetry?.();
      return;
    }
    // Shift+Enter (kitty keyboard protocol) inserts a newline instead of
    // submitting; plain Enter still submits exactly as before.
    if (key.return && key.shift) {
      insertText("\n");
      return;
    }
    // A chunk with MULTIPLE line breaks is a paste: insert it as one bounded
    // block instead of submitting at the first line break, which used to drop
    // everything after it. Ink does not expose bracketed-paste markers, so a
    // single trailing break still submits — "text\r" from expect-style drivers
    // and one-line pastes keep the old submit behavior.
    if ((input.match(/[\r\n]/gu)?.length ?? 0) >= 2) {
      const withoutTrailingBreak = input.replace(/[\r\n]+$/u, "");
      const normalized = Array.from(withoutTrailingBreak.replace(/\r\n?/gu, "\n"));
      setPasteTruncated(normalized.length > MAX_PASTE_CHARS);
      setEditorTruncated(false);
      insertText(normalized.slice(0, MAX_PASTE_CHARS).join(""));
      return;
    }
    // With the command palette open, Enter acts on the highlighted row instead
    // of submitting the raw composer draft (which is just the typed prefix,
    // e.g. "/"). The suggestions are recomputed from the ref-backed draft so a
    // key event that arrives right after a click accepted a row (before the
    // next render) falls through to the normal submit path instead of
    // re-accepting the stale palette.
    if (
      focusOwner === "commandPalette" &&
      key.return &&
      !key.shift &&
      suggestions.length > 0 &&
      commandSuggestions(draft.value, commands).length > 0
    ) {
      acceptCommandSuggestion(suggestionIndex);
      return;
    }
    // Some PTYs normalize carriage return to line feed while Ink is in raw
    // mode. Treat both forms as submit so Enter never leaves text stranded in
    // the composer.
    const lineBreak = input.search(/[\r\n]/);
    if (key.return || lineBreak >= 0) {
      const textBeforeSubmit = lineBreak >= 0
        ? input.slice(0, lineBreak)
        : "";
      const chars = Array.from(draft.value);
      chars.splice(draft.cursor, 0, textBeforeSubmit);
      submitPrompt(chars.join(""));
      return;
    }
    if (focusOwner === "pathCompletion" && key.tab && pathCompletion?.suggestions.length) {
      choosePathSuggestion(pathCompletionIndex);
      return;
    }
    if (focusOwner === "commandPalette" && key.tab && suggestions.length > 0) {
      const selected = Math.min(Math.max(suggestionIndex, 0), suggestions.length - 1);
      const suggestion = suggestions[selected]?.command ?? "";
      applyComposer(suggestion, Array.from(suggestion).length);
      return;
    }
    if (focusOwner === "pathCompletion" && pathCompletion?.suggestions.length && key.upArrow) {
      setPathCompletionIndex((index) =>
        index <= 0 ? pathCompletion.suggestions.length - 1 : index - 1,
      );
      return;
    }
    if (focusOwner === "pathCompletion" && pathCompletion?.suggestions.length && key.downArrow) {
      setPathCompletionIndex((index) =>
        index >= pathCompletion.suggestions.length - 1 ? 0 : index + 1,
      );
      return;
    }
    if (focusOwner === "commandPalette" && suggestions.length > 0 && key.upArrow) {
      setSuggestionIndex((index) =>
        index <= 0 ? suggestions.length - 1 : index - 1,
      );
      return;
    }
    if (focusOwner === "commandPalette" && suggestions.length > 0 && key.downArrow) {
      setSuggestionIndex((index) =>
        index >= suggestions.length - 1 ? 0 : index + 1,
      );
      return;
    }
    if (key.upArrow) {
      if (history.length === 0) return;
      const nextIndex = historyIndex < 0
        ? history.length - 1
        : Math.max(0, historyIndex - 1);
      const next = history[nextIndex] ?? "";
      setHistoryIndex(nextIndex);
      applyComposer(next, Array.from(next).length);
      return;
    }
    if (key.downArrow) {
      if (historyIndex < 0) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        applyComposer("", 0);
        return;
      }
      const next = history[nextIndex] ?? "";
      setHistoryIndex(nextIndex);
      applyComposer(next, Array.from(next).length);
      return;
    }
    if (key.leftArrow) {
      applyComposer(draft.value, Math.max(0, draft.cursor - 1));
      return;
    }
    if (key.rightArrow) {
      applyComposer(draft.value, Math.min(Array.from(draft.value).length, draft.cursor + 1));
      return;
    }
    if (key.home) {
      applyComposer(draft.value, 0);
      return;
    }
    if (key.end) {
      applyComposer(draft.value, Array.from(draft.value).length);
      return;
    }
    // macOS Terminal sends the Delete key as DEL (0x7f), which Ink exposes
    // as `key.delete`. Treat both terminal backspace variants as deleting the
    // character before the caret; otherwise deleting at the end is a no-op
    // because the old `key.delete` branch tried to delete forward.
    if (key.backspace || key.delete) {
      const chars = Array.from(draft.value);
      if (draft.cursor === 0) return;
      chars.splice(draft.cursor - 1, 1);
      applyComposer(chars.join(""), draft.cursor - 1);
      return;
    }
    if (input === "\u000c") {
      applyComposer("", 0);
      return;
    }
    if (input.length > 0 && !key.ctrl && !key.meta && !key.escape) {
      insertText(input);
    }
  });

  const promptLabel = activeTextPrompt !== undefined
    ? "Enter tool names or 'none'"
    : activeApprovalPrompt !== undefined
      ? "y / n"
      : "Type your message or @path/to/file";
  return (
    <InkThemeProvider theme={getInkTheme(inputSnapshot.theme)}>
      <Box flexDirection="column" width={columns} height={stdout.isTTY ? viewportLayout.frameRows : undefined}>
      {/* Non-TTY renders (renderToString) have no fixed viewport to scroll:
          offsetting the content would just amputate its top rows, so the
          scroll offset only applies where the frame is height-constrained. */}
      <Box height={stdout.isTTY ? visibleTranscriptRows : undefined} flexShrink={0} overflow="hidden" flexDirection="column">
      <Box
        ref={contentRef}
        flexShrink={0}
        flexDirection="column"
        width={columns}
        marginTop={stdout.isTTY ? -renderedViewport.offset : undefined}
      >
        <WelcomePanel provider={provider} model={model} sessionId={displayedSessionId}
          workingDirectory={workingDirectory} executor={executor} mcpCount={mcpCount} columns={columns} />
        <TranscriptViewport
          snapshot={snapshot} entries={transcriptEntries}
          summary={showRunSummary ? snapshot.summary : undefined}
          columns={columns}
          viewport={{ ...renderedViewport, offset: 0, totalRows: 0, visibleRows: Number.MAX_SAFE_INTEGER, followOutput: false }}
        />
        {snapshot.historyView !== undefined ? (
          <HistoryPanel
            title={snapshot.historyView.title}
            rows={snapshot.historyView.rows}
            columns={columns}
          />
        ) : null}
        {snapshot.sessionPicker !== undefined ? (
          <SessionPicker
            title={snapshot.sessionPicker.title}
            rows={snapshot.sessionPicker.rows}
            selectedIndex={snapshot.sessionPicker.selectedIndex}
            columns={columns}
          />
        ) : null}
        {snapshot.plan !== undefined ? (
          <PlanReviewPanel
            prompt={snapshot.plan.prompt}
            review={snapshot.plan.review}
            status={snapshot.plan.status}
            columns={columns}
          />
        ) : null}
        {snapshot.collaboration !== undefined ? (
          <CollaborationPanel
            collaboration={snapshot.collaboration}
            columns={columns}
          />
        ) : null}
        {snapshot.mcp !== undefined ? (
          <McpPanel snapshot={snapshot.mcp} columns={columns} />
        ) : null}
        {snapshot.notices.length > 0 ? (
          <NoticePanel notices={snapshot.notices} columns={columns} />
        ) : null}
        {snapshot.retry !== undefined ? (
          <RetryPanel
            prompt={snapshot.retry.prompt}
            error={snapshot.retry.error}
            columns={columns}
          />
        ) : null}
        {snapshot.cards.length > 0 ? (
          <ToolTimeline cards={snapshot.cards} columns={columns} />
        ) : null}
        {suggestions.length > 0 ? (
          <CommandPalette
            suggestions={suggestions}
            selectedIndex={suggestionIndex}
            offset={paletteOffset}
            columns={columns}
            onLayout={setPaletteLayout}
          />
        ) : null}
        {pathCompletion?.suggestions.length ? (
          <PathCompletionPanel
            completion={pathCompletion}
            selectedIndex={pathCompletionIndex}
            columns={columns}
          />
        ) : null}
        {queuedPrompts.length > 0 ? (
          <QueuePanel prompts={queuedPrompts} columns={columns} />
        ) : null}

      </Box>
      </Box>
      <Box ref={shellRef} flexShrink={0} flexDirection="column">

        <NavigationBar
          viewport={viewport}
          hovered={navigationHovered}
          columns={columns}
        />
        {activeInputPrompt !== undefined ? (
          <Box marginTop={1} width={columns - 2}>
            <Text color={getInkTheme(inputSnapshot.theme).warning} wrap="wrap">! {activeInputPrompt}</Text>
          </Box>
        ) : null}
        <StatusLine snapshot={snapshot} busy={busy} />
        <Composer
          value={value}
          cursor={cursor}
          placeholder={promptLabel}
          width={columns - 2}
          approval={activeInputPrompt !== undefined}
          notice={pasteTruncated
            ? `Pasted content truncated to ${MAX_PASTE_CHARS} characters`
            : editorTruncated
              ? `Editor draft truncated to ${MAX_EDITOR_CHARS} characters`
              : undefined}
          imeCursor={IME_CURSOR_ENABLED}
          terminalRows={viewportLayout.frameRows}
        />
        <Footer
          workingDirectory={workingDirectory}
          sessionId={displayedSessionId}
          executor={executor}
          provider={snapshot.conversation?.sessionId === displayedSessionId
            ? snapshot.conversation.provider
            : provider}
          model={snapshot.conversation?.sessionId === displayedSessionId
            ? snapshot.conversation.model
            : model}
          promptTokens={snapshot.conversation?.sessionId === displayedSessionId
            ? snapshot.conversation.promptTokens
            : undefined}
          width={columns - 2}
        />
      </Box>
      </Box>
    </InkThemeProvider>
  );
}

function measureBoxHeight(node: DOMElement | null): number | undefined {
  if (node === null) return undefined;
  try {
    const height = measureElement(node).height;
    return Number.isFinite(height) ? Math.max(0, Math.floor(height)) : undefined;
  } catch {
    // Ink may detach a ref while a render is being replaced. The next commit
    // will measure the newly attached node.
    return undefined;
  }
}

function WelcomePanel(props: {
  provider: string;
  model: string;
  sessionId: string;
  workingDirectory: string;
  executor: string;
  mcpCount: number;
  columns: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  const markWidth = Math.min(64, Math.max(20, props.columns - 4));
  const mark = renderSignalLoomMark({
    width: markWidth,
    color: false,
    gradient: false,
  }).split("\n");

  return (
    <Box flexDirection="column" paddingX={1}>
      {mark.map((line, index) => (
        <Text key={`${index}-${line}`} color={process.env.NO_COLOR ? undefined : theme.logo[index % theme.logo.length]}>
          {line}
        </Text>
      ))}
      <Text bold color={theme.text}>DEV AGENT</Text>
      <Text color={theme.muted}>SIGNAL LOOM // local coding workbench</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.info}>Tips for getting started:</Text>
        <Text>1. Ask questions, edit files, or run commands.</Text>
        <Text>2. Be specific for the best results.</Text>
        <Text>3. Type / or : for commands.</Text>
        <Text>4. Wheel/PageUp/PageDown browse; Home/End jump to bounds.</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.muted}>Provider: <Text color={theme.text}>{props.provider}</Text></Text>
        <Text color={theme.muted}>Model: <Text color={theme.text}>{props.model}</Text></Text>
        <Text color={theme.muted}>Session: <Text color={theme.text}>{props.sessionId}</Text></Text>
        <Text color={theme.muted}>Workspace: <Text color={theme.text}>{shortenPath(props.workingDirectory)}</Text></Text>
        <Text color={theme.muted}>Executor: <Text color={theme.text}>{props.executor}</Text> · MCP: <Text color={theme.text}>{props.mcpCount}</Text></Text>
      </Box>
    </Box>
  );
}

/**
 * Returns a one-line, bounded title for the latest user task. The title is a
 * presentation affordance only; the full prompt remains in the transcript.
 */
export function deriveStickyTaskTitle(
  entries: readonly TuiStateSnapshot["transcript"][number][],
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.role !== "user") continue;
    const normalized = entry.text
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized.length === 0) continue;
    return truncateToDisplayWidth(Array.from(normalized).slice(0, 512).join(""), 512);
  }
  return undefined;
}

function StickyTaskHeader({
  title,
  columns,
}: {
  readonly title: string;
  readonly columns: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  const line = fitDisplayLine(` ${title}`, Math.max(1, columns - 2));
  return (
    <Box width={columns} paddingX={1} height={1}>
      <Text color={theme.text} backgroundColor={theme.dim}>{line}</Text>
    </Box>
  );
}

type MousePoint = Pick<MouseMove, "x" | "y">;
type NavigationViewport = Pick<
  InkViewportSnapshot,
  "followOutput" | "hiddenAbove" | "hiddenBelow" | "newOutput"
>;

function isBrowsingViewport(viewport: NavigationViewport): boolean {
  return !viewport.followOutput &&
    (viewport.hiddenAbove > 0 || viewport.hiddenBelow > 0 || viewport.newOutput > 0);
}

function navigationBarText(viewport: NavigationViewport): string {
  return [
    "↓ Back to bottom · End latest",
    viewport.hiddenAbove > 0 ? `${viewport.hiddenAbove} rows above` : "",
    viewport.hiddenBelow > 0 ? `${viewport.hiddenBelow} rows below` : "",
    viewport.newOutput > 0 ? "new output below" : "",
  ].filter((part) => part.length > 0).join(" · ");
}

function navigationBarBounds(
  viewport: NavigationViewport,
  terminalRows: number,
  terminalColumns: number,
): { readonly row: number; readonly startColumn: number; readonly endColumn: number } | undefined {
  if (!isBrowsingViewport(viewport)) return undefined;
  const labelWidth = displayWidth(truncateToDisplayWidth(navigationBarText(viewport), Math.max(1, terminalColumns - 2)));
  const startColumn = Math.max(
    1,
    Math.floor((Math.max(1, Math.floor(terminalColumns)) - labelWidth) / 2) + 1,
  );
  return {
    row: Math.max(1, Math.floor(terminalRows)),
    startColumn,
    endColumn: startColumn + Math.max(1, labelWidth) - 1,
  };
}

function isPointInsideNavigationBar(
  point: MousePoint,
  viewport: NavigationViewport,
  terminalRows: number,
  terminalColumns: number,
): boolean {
  const bounds = navigationBarBounds(viewport, terminalRows, terminalColumns);
  return bounds !== undefined &&
    point.y === bounds.row &&
    point.x >= bounds.startColumn &&
    point.x <= bounds.endColumn;
}

export function isNavigationBarHovered(
  point: MousePoint,
  terminalRows: number,
  viewport: NavigationViewport,
  terminalColumns: number,
): boolean {
  return isPointInsideNavigationBar(point, viewport, terminalRows, terminalColumns);
}

export function isBackToBottomClick(
  click: MouseClick,
  terminalRows: number,
  viewport: NavigationViewport,
  terminalColumns: number,
): boolean {
  if (viewport.followOutput || click.action !== "press") return false;
  if ((click.button & 64) !== 0 || (click.button & 32) !== 0) return false;
  if ((click.button & 3) !== 0) return false;
  return isPointInsideNavigationBar(click, viewport, terminalRows, terminalColumns);
}

function NavigationBar({
  viewport,
  hovered,
  columns,
}: {
  readonly viewport: InkViewportSnapshot;
  readonly hovered: boolean;
  readonly columns: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  if (!isBrowsingViewport(viewport)) {
    return <Box height={1} />;
  }

  const label = truncateToDisplayWidth(navigationBarText(viewport), Math.max(1, columns - 2));
  return (
    <Box width={columns} paddingX={1} height={1} justifyContent="center">
      <Text
        color={hovered ? "#131923" : theme.primary}
        backgroundColor={hovered ? theme.primary : undefined}
      >
        {label}
      </Text>
    </Box>
  );
}

function TranscriptViewport({
  snapshot,
  entries,
  summary,
  columns,
  viewport,
}: {
  readonly snapshot: InkRuntimeSnapshot;
  readonly entries: readonly TuiStateSnapshot["transcript"][number][];
  readonly summary?: InkRunSummary;
  readonly columns: number;
  readonly viewport: InkViewportSnapshot;
}): React.JSX.Element {
  const theme = useInkTheme();
  const ranges = transcriptRanges(entries, columns, summary);
  const firstVisibleRow = viewport.offset;
  const lastVisibleRow = firstVisibleRow + Math.max(1, viewport.visibleRows);
  const visibleItems = selectTranscriptItems(ranges, viewport);
  // Always clip an overflowing transcript frame. A single Markdown response
  // can be larger than the viewport, and the selected range may therefore be
  // taller than the budget even though the viewport is intentionally showing
  // only its intersecting rows.
  const viewportHeight = viewport.totalRows > viewport.visibleRows
    ? Math.max(1, viewport.visibleRows)
    : undefined;
  return (
    <Box flexDirection="column" width={columns}>
      {snapshot.thought.active || snapshot.thought.summary !== undefined ? (
        <ThoughtLine
          active={snapshot.thought.active}
          startedAt={snapshot.thought.startedAt}
          elapsedMs={snapshot.thought.elapsedMs}
          state={snapshot.state}
          steps={snapshot.thought.steps}
        />
      ) : null}
      <Box
        flexDirection="column"
        paddingX={1}
        width={columns}
        {...(viewportHeight === undefined
          ? {}
          : { height: viewportHeight, overflow: "hidden" as const })}
      >
        {visibleItems.map((range) => {
          // Preserve the item's global row position inside the clipped
          // viewport. Without this negative offset, an oversized entry that
          // intersects the window would always render from its first line,
          // making PageUp appear to do nothing.
          const rowOffset = range.start < firstVisibleRow
            ? firstVisibleRow - range.start
            : 0;
          return range.item.type === "summary" ? (
            <SummaryPanel
              key="run-summary"
              summary={range.item.summary}
              rowOffset={-rowOffset}
            />
          ) : (
            <TranscriptEntry
              key={range.item.entry.id}
              entry={range.item.entry}
              activeThinking={
                snapshot.state === "thinking" &&
                range.item.entry.runId === snapshot.activeRunId
              }
              width={columns}
              rowOffset={-rowOffset}
            />
          );
        })}
      </Box>
      {snapshot.error !== undefined ? (
        <Text color={theme.error}>× {snapshot.error}</Text>
      ) : null}
    </Box>
  );
}

function visibleTranscriptEntries(
  snapshot: InkRuntimeSnapshot,
): readonly TuiStateSnapshot["transcript"][number][] {
  return snapshot.transcript.filter((entry) =>
    entry.role === "user" ||
    entry.text.length > 0 ||
    entry.runId === snapshot.activeRunId
  );
}

type TranscriptViewportItem =
  | { readonly type: "transcript"; readonly entry: TuiStateSnapshot["transcript"][number] }
  | { readonly type: "summary"; readonly summary: InkRunSummary };

interface TranscriptRange {
  readonly item: TranscriptViewportItem;
  readonly start: number;
  readonly end: number;
}

function selectTranscriptItems(
  ranges: readonly TranscriptRange[],
  viewport: InkViewportSnapshot,
): readonly TranscriptRange[] {
  if (ranges.length === 0) return [];
  const budget = Math.max(1, viewport.visibleRows);

  if (viewport.followOutput) {
    const transcriptRangesOnly = ranges.filter((range) => range.item.type === "transcript");
    const summaryRange = ranges.find((range) => range.item.type === "summary");
    const selected: TranscriptRange[] = [];
    let used = 0;

    for (let index = transcriptRangesOnly.length - 1; index >= 0; index -= 1) {
      const range = transcriptRangesOnly[index]!;
      const rows = range.end - range.start;
      if (selected.length > 0 && used + rows > budget) break;
      selected.unshift(range);
      used += rows;
      if (used >= budget) break;
    }

    if (summaryRange !== undefined) {
      const summaryRows = summaryRange.end - summaryRange.start;
      while (selected.length > 1 && used + summaryRows > budget) {
        const removed = selected.shift();
        used -= removed === undefined ? 0 : removed.end - removed.start;
      }
      if (used + summaryRows <= budget) {
        selected.push(summaryRange);
      }
    }
    return selected;
  }

  const firstVisibleRow = viewport.offset;
  const lastVisibleRow = firstVisibleRow + budget;
  const intersecting = ranges.filter((range) =>
    range.end > firstVisibleRow && range.start < lastVisibleRow,
  );
  const contained = intersecting.filter((range) =>
    range.start >= firstVisibleRow && range.end <= lastVisibleRow,
  );
  if (contained.length > 0) return contained;
  return intersecting.length > 0 ? [intersecting[0]!] : [];
}

function transcriptRanges(
  entries: readonly TuiStateSnapshot["transcript"][number][],
  width: number,
  summary?: InkRunSummary,
): readonly TranscriptRange[] {
  const ranges: TranscriptRange[] = [];
  let cursor = 0;
  for (const entry of entries) {
    const start = cursor;
    cursor += estimateTranscriptEntryRows(entry, width);
    ranges.push({ item: { type: "transcript", entry }, start, end: cursor });
  }
  if (summary !== undefined) {
    const start = cursor;
    cursor += estimateSummaryPanelRows(summary, width);
    ranges.push({ item: { type: "summary", summary }, start, end: cursor });
  }
  return ranges;
}

function estimateTranscriptRows(
  entries: readonly TuiStateSnapshot["transcript"][number][],
  width: number,
  summary?: InkRunSummary,
): number {
  return entries.reduce(
    (total, entry) => total + estimateTranscriptEntryRows(entry, width),
    estimateSummaryPanelRows(summary, width),
  );
}

function estimateSummaryPanelRows(
  summary: InkRunSummary | undefined,
  width: number,
): number {
  if (summary === undefined) return 0;
  const contentWidth = Math.max(1, width - 2);
  return 1 + summaryPanelLines(summary).reduce(
    (total, line) => total + splitByDisplayWidth(line, contentWidth).length,
    0,
  );
}

function summaryPanelLines(summary: InkRunSummary): readonly string[] {
  const lines = [`[state=${summary.status} turns=${summary.turns}]`];
  // Token usage deliberately stays off this panel: the composer footer's
  // `Context:` cell already reports last-request prompt tokens, and the
  // committed transcript contract keeps `[usage]` lines out of the frame.
  lines.push(
    `[timing] queue=${formatTiming(summary.queueMs)} first-token=${formatTiming(summary.firstTokenMs)} model=${formatTiming(summary.modelMs)} tool=${formatTiming(summary.toolMs)} total=${formatTiming(summary.totalMs)}`,
  );
  return lines;
}

function estimateTranscriptEntryRows(
  entry: TuiStateSnapshot["transcript"][number],
  width: number,
): number {
  if (entry.role === "assistant") {
    const markdownWidth = Math.max(24, width - 2);
    const markdownRows = measureMarkdownRows(entry.text, markdownWidth);
    return Math.max(1, markdownRows) + 2;
  }

  const contentWidth = Math.max(24, width - 4);
  const textRows = (entry.text.length === 0 ? [""] : entry.text.split("\n"))
    .reduce(
      (total, line) => total + splitByDisplayWidth(line, contentWidth).length,
      0,
    );
  return Math.max(1, textRows) + 1;
}

function sameViewportSnapshot(
  left: InkViewportSnapshot,
  right: InkViewportSnapshot,
): boolean {
  return left.offset === right.offset &&
    left.totalRows === right.totalRows &&
    left.visibleRows === right.visibleRows &&
    left.followOutput === right.followOutput &&
    left.hiddenAbove === right.hiddenAbove &&
    left.hiddenBelow === right.hiddenBelow &&
    left.newOutput === right.newOutput;
}

function TranscriptEntry({
  entry,
  activeThinking,
  width,
  rowOffset = 0,
}: {
  entry: TuiStateSnapshot["transcript"][number];
  activeThinking: boolean;
  width: number;
  rowOffset?: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  return (
    <Box flexDirection="column" marginTop={1 + rowOffset}>
      {entry.role === "user" ? (
        <Text color={theme.primary}>› {entry.text}</Text>
      ) : entry.role === "reasoning" ? (
        <Text dimColor italic>Thinking {entry.text}</Text>
      ) : entry.text.length === 0 ? (
        <ThinkingIndicator active={activeThinking} />
      ) : (
        <Box flexDirection="column">
          <Text color={theme.accent}>✦</Text>
          <MarkdownView text={entry.text} width={Math.max(24, width - 2)} />
        </Box>
      )}
    </Box>
  );
}

function NoticePanel({
  notices,
  columns,
}: {
  notices: readonly string[];
  columns: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginTop={1}
      width={columns - 2}
    >
      {notices.map((notice, index) => (
        <Text key={`${index}-${notice}`} color={theme.warning} wrap="wrap">{notice}</Text>
      ))}
    </Box>
  );
}

function PathCompletionPanel({
  completion,
  selectedIndex,
  columns,
}: {
  completion: PathCompletionResult;
  selectedIndex: number;
  columns: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginTop={1}
      width={columns - 2}
    >
      <Text color={theme.info}>PATH COMPLETION</Text>
      {completion.suggestions.map((suggestion, index) => (
        <Text key={`${suggestion.path}-${index}`} wrap="truncate-end">
          <Text color={index === selectedIndex ? theme.primary : theme.muted}>
            {index === selectedIndex ? "› " : "  "}
          </Text>
          <Text color={suggestion.isDirectory ? theme.info : theme.text}>
            {suggestion.path}
          </Text>
        </Text>
      ))}
      <Text color={theme.muted}>Tab select · ↑↓ move · esc close</Text>
    </Box>
  );
}

function SummaryPanel({
  summary,
  rowOffset = 0,
}: {
  summary: InkRunSummary;
  rowOffset?: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  return (
    <Box flexDirection="column" marginTop={1 + rowOffset}>
      {summaryPanelLines(summary).map((line, index) => (
        <Text key={index} color={theme.muted}>{line}</Text>
      ))}
    </Box>
  );
}

function QueuePanel({
  prompts,
  columns,
}: {
  prompts: readonly string[];
  columns: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.dim}
      paddingX={1}
      marginTop={1}
      width={columns - 2}
    >
      <Text color={theme.primary}>WAITING QUEUE</Text>
      {prompts.map((prompt, index) => (
        <Text key={`${index}-${prompt}`} wrap="truncate-end">
          <Text color={theme.primary}>{index + 1}. </Text>{prompt}
        </Text>
      ))}
    </Box>
  );
}

function StatusLine({
  snapshot,
  busy,
}: {
  snapshot: InkRuntimeSnapshot;
  busy: boolean;
}): React.JSX.Element {
  const theme = useInkTheme();
  if (!busy) {
    return (
      <Box marginTop={1} paddingX={1}>
        <Text color={theme.muted}>{statusLabel(snapshot.state)}</Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1} paddingX={1}>
      <Text color={theme.success}>Working · </Text>
      <RotatingStatus
        active
        state={snapshot.state}
        steps={snapshot.thought.steps}
      />
      <Text color={theme.success}> · esc to interrupt</Text>
    </Box>
  );
}

function Composer({
  value,
  cursor,
  placeholder,
  width,
  approval,
  notice,
  imeCursor = false,
  terminalRows,
}: {
  value: string;
  cursor: number;
  placeholder: string;
  width: number;
  approval: boolean;
  notice?: string;
  imeCursor?: boolean;
  terminalRows?: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  const { setCursorPosition } = useCursor();
  const boxRef = useRef<DOMElement | null>(null);
  const [boxHeight, setBoxHeight] = useState(0);
  // measureElement reports the rendered height of the bordered composer box,
  // which grows with wrapped content; keep it current on every commit.
  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    try {
      const measured = measureElement(node);
      if (measured.height > 0 && measured.height !== boxHeight) setBoxHeight(measured.height);
    } catch {
      // The node is not attached yet; the next commit measures it.
    }
  });
  useEffect(() => {
    if (!imeCursor || boxHeight <= 0 || terminalRows === undefined) {
      setCursorPosition(undefined);
      return;
    }
    const chars = Array.from(value);
    const linesBeforeCaret = chars.slice(0, cursor).join("").split("\n");
    const caretLine = linesBeforeCaret.length - 1;
    const caretCol = displayWidth(linesBeforeCaret[linesBeforeCaret.length - 1] ?? "");
    // Layout contract: the footer occupies the last frame row and the
    // composer sits directly above it, so the caret row works out to
    // (frame bottom - composer height - marginTop) + top border + caret line.
    const y = terminalRows - boxHeight - 1 + caretLine;
    const x = 3 + caretCol;
    if (y < 0 || y >= terminalRows) {
      setCursorPosition(undefined);
      return;
    }
    setCursorPosition({ x, y });
  }, [imeCursor, boxHeight, value, cursor, terminalRows, setCursorPosition]);
  const caretPrefix = Array.from(value).slice(0, cursor).join("");
  const caretLine = caretPrefix.split("\n").length - 1;
  const startLine = Math.max(0, caretLine - 3);
  const valueLines = value.split("\n");
  const visibleValue = valueLines.slice(startLine, startLine + 4).join("\n");
  const hiddenChars = Array.from(valueLines.slice(0, startLine).join("\n")).length + (startLine > 0 ? 1 : 0);
  const chars = Array.from(visibleValue);
  cursor = Math.max(0, cursor - hiddenChars);
  const before = chars.slice(0, cursor).join("");
  const cursorAtEnd = chars[cursor] === undefined;
  const active = chars[cursor] ?? "█";
  const after = chars.slice(cursor + (chars[cursor] === undefined ? 0 : 1)).join("");

  return (
    <>
      {notice ? <Text color={theme.composer}>{notice}</Text> : null}
      <Box
        ref={(node: DOMElement | null) => {
          boxRef.current = node;
        }}
        borderStyle="round"
        borderColor={theme.composer}
        paddingX={1}
        marginTop={1}
        width={Math.max(20, width)}
        height={Math.min(6, Math.max(3, (visibleValue || placeholder).split("\n").reduce((sum, line) => sum + splitByDisplayWidth(line, Math.max(1, width - 6)).length, 0) + 2))}
        overflow="hidden"
        aria-role="textbox"
        aria-state={{ busy: approval }}
      >
        <Text><Text color={theme.prompt}>› </Text>
        {value.length === 0 ? (
          <><Text color={theme.composer}>█</Text><Text color={theme.muted}>{placeholder}</Text></>
        ) : (
          <>
            <Text>{before}</Text>
            <Text
              backgroundColor={cursorAtEnd ? undefined : "#eef4ff"}
              color={cursorAtEnd ? theme.composer : "#131923"}
            >
              {active}
            </Text>
            <Text>{after}</Text>
          </>
        )}</Text>
      </Box>
    </>
  );
}

function Footer({
  workingDirectory,
  sessionId,
  executor,
  provider,
  model,
  promptTokens,
  width,
}: {
  readonly workingDirectory: string;
  readonly sessionId: string;
  readonly executor: string;
  readonly provider: string;
  readonly model: string;
  readonly promptTokens?: number;
  readonly width: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  const available = Math.max(20, width - 2);
  const context = promptTokens === undefined
    ? "Context: unknown"
    : `Context: ${promptTokens.toLocaleString()} tokens (last request)`;
  const right = `${provider}/${model} · ${context} · ${sessionId} · ${executor} · ${theme.name}`;
  const left = truncateToDisplayWidth(shortenPath(workingDirectory), Math.max(1, available - displayWidth(right) - 2));
  const text = `${left}  ${right}`;
  return (
    <Box width={Math.max(20, width)} paddingX={1} height={1}>
      <Text dimColor wrap="truncate-end">{truncateToDisplayWidth(text, available)}</Text>
    </Box>
  );
}

function commandSuggestionNeedsInput(command: string): boolean {
  return /<[^>\r\n]+>|\[[^\r\n\]]+\]|\|/u.test(command);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index >= needle.length) return true;
  }
  return false;
}

function commandSuggestions(
  value: string,
  commands: readonly CommandHint[],
): readonly CommandHint[] {
  const prefix = value.trimStart();
  if (!prefix.startsWith(":") && !prefix.startsWith("/")) {
    return [];
  }
  // A fully typed or accepted command closes the palette; otherwise it would
  // keep prefix-matching itself and Enter could never submit it.
  if (commands.some((command) => command.command === prefix)) {
    return [];
  }
  const normalized = prefix.slice(1).toLowerCase();
  if (normalized.length === 0) return commands;
  // Rank prefix matches above substring matches above subsequence matches so
  // typing "ed" surfaces :editor first while "story" still finds :history.
  // Equal ranks keep the declared command order (Array.sort is stable).
  const rank = (command: CommandHint): number => {
    const name = command.command.replace(/^[:/]/, "").toLowerCase();
    if (name.startsWith(normalized)) return 0;
    if (name.includes(normalized)) return 1;
    return isSubsequence(normalized, name) ? 2 : 3;
  };
  return commands
    .map((command) => ({ command, score: rank(command) }))
    .filter((entry) => entry.score < 3)
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.command);
}

function statusLabel(state: TuiStateSnapshot["state"]): string {
  switch (state) {
    case "ready":
      return "READY / idle";
    case "thinking":
      return "THINKING";
    case "streaming":
      return "STREAMING";
    case "waiting-approval":
      return "WAITING FOR APPROVAL";
    case "tool-running":
      return "TOOL RUNNING";
    case "validating":
      return "VALIDATING";
    default:
      return state.toUpperCase();
  }
}

function isExitCommand(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "exit" || normalized === "quit" ||
    normalized === ":quit" || normalized === "/quit";
}

function shortenPath(value: string): string {
  const home = process.env.HOME?.replace(/\/+$/, "");
  const clean = value.replace(/\/+$/, "") || "/";
  if (home && clean === home) return "~";
  if (home && clean.startsWith(`${home}/`)) return `~/${clean.slice(home.length + 1)}`;
  return clean;
}

function formatTiming(value: number | undefined): string {
  return value === undefined ? "n/a" : `${Math.max(0, Math.round(value))}ms`;
}
