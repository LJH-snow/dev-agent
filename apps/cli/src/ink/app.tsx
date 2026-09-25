import { useCallback, useEffect, useRef, useSyncExternalStore, useState } from "react";
import { Box, Static, Text, useInput, useStdin, useStdout } from "ink";

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
  InkViewportModel,
  type InkViewportSnapshot,
} from "./viewport.js";
import {
  MOUSE_TRACKING_DISABLE,
  MOUSE_TRACKING_ENABLE,
  MouseInputParser,
  type MouseWheelDirection,
} from "./mouse-wheel.js";
import { RetryPanel } from "./retry-panel.js";
import { ThinkingIndicator } from "./thinking-indicator.js";
import { ThoughtLine } from "./thought-line.js";
import { RotatingStatus } from "./rotating-status.js";
import { ToolTimeline } from "./tool-timeline.js";
import { MarkdownView, measureMarkdownRows } from "./markdown.js";
import { CommandPalette } from "./command-palette.js";
import { HistoryPanel } from "./history-panel.js";
import { SessionPicker } from "./session-picker.js";
import { PlanReviewPanel } from "./plan-review-panel.js";
import { CollaborationPanel } from "./collaboration-panel.js";
import { McpPanel } from "./mcp-panel.js";
import { InkThemeProvider, getInkTheme, useInkTheme } from "./theme.js";
import {
  completeWorkspacePath,
  type PathCompletionResult,
} from "../path-completion.js";

type InkStaticItem =
  | {
      readonly kind: "welcome";
      readonly id: "signal-loom-welcome";
    };

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
}

const EMPTY_UI_SNAPSHOT: InkUiSnapshot = {
  busy: false,
  queuedPrompts: [],
  theme: "signal",
};
const NOOP_SUBSCRIBE = (): (() => void) => () => undefined;
const EMPTY_GET_SNAPSHOT = (): InkUiSnapshot => EMPTY_UI_SNAPSHOT;

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
  const { internal_eventEmitter, isRawModeSupported } = useStdin();
  const columns = Math.max(52, stdout.columns ?? process.stdout.columns ?? 80);
  const terminalRows = Math.max(
    12,
    (stdout.rows ?? process.stdout.rows ?? 24) - Math.max(0, terminalRowsOffset),
  );
  // Leave room for the status line, composer, footer, transient panels, and
  // one bottom navigation slot. The navigation slot stays reserved even when
  // its label is hidden, so entering/leaving history does not make the
  // transcript jump under the composer. The task header is accounted for
  // after the current transcript is known below.
  const baseTranscriptRows = Math.max(4, terminalRows - 15);
  const viewportMouseInput = useRef(new MouseInputParser()).current;
  const composerMouseInput = useRef(new MouseInputParser()).current;
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [pathCompletion, setPathCompletion] = useState<PathCompletionResult | undefined>(undefined);
  const [pathCompletionIndex, setPathCompletionIndex] = useState(0);
  const dismissedPathKey = useRef<string | undefined>(undefined);
  const viewportModel = useRef(new InkViewportModel({
    totalRows: 0,
    visibleRows: baseTranscriptRows,
  })).current;
  const staticItems = useRef<InkStaticItem[]>([
    { kind: "welcome", id: "signal-loom-welcome" },
  ]).current;
  const [viewport, setViewport] = useState<InkViewportSnapshot>(() =>
    viewportModel.snapshot(),
  );
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

  useEffect(() => {
    if (!isRawModeSupported) return;
    const handleMouseInput = (input: string): void => {
      const parsed = viewportMouseInput.push(input);
      for (const direction of parsed.directions) {
        moveViewport(direction, "wheel");
      }
    };
    internal_eventEmitter.on("input", handleMouseInput);
    write(MOUSE_TRACKING_ENABLE);
    return () => {
      internal_eventEmitter.off("input", handleMouseInput);
      write(MOUSE_TRACKING_DISABLE);
    };
  }, [internal_eventEmitter, isRawModeSupported, moveViewport, viewportMouseInput, write]);

  const suggestions = commandSuggestions(value, commands);
  const busy = inputSnapshot.busy ||
    (snapshot.state !== "ready" && snapshot.state !== "done" &&
      snapshot.state !== "error" && snapshot.state !== "interrupted");
  const queuedPrompts = inputSnapshot.queuedPrompts.length > 0
    ? inputSnapshot.queuedPrompts
    : snapshot.queuedPrompts;
  const activeApprovalPrompt = inputSnapshot.approvalPrompt ?? approvalPrompt;
  const activeTextPrompt = inputSnapshot.textPrompt ?? textPrompt;
  const activeInputPrompt = activeTextPrompt ?? activeApprovalPrompt;
  const displayedSessionId = inputSnapshot.sessionId ?? sessionId;
  const pathCompletionKey = `${value}\u0000${cursor}`;
  const allTranscriptEntries = visibleTranscriptEntries(snapshot);
  // Keep one authoritative transcript source. Static transcript items cannot
  // be removed once Ink has emitted them, so switching from Static history to
  // a manual viewport would otherwise paint the same turns twice. The welcome
  // panel remains static, while every turn is rendered through this bounded
  // dynamic viewport.
  const transcriptEntries = allTranscriptEntries;
  const taskTitle = deriveStickyTaskTitle(transcriptEntries);
  // The sticky task row is part of the dynamic shell, not the transcript
  // viewport. Reserve one additional row once a task exists so the bottom
  // controls remain anchored instead of being pushed off-screen.
  const visibleTranscriptRows = Math.max(
    4,
    baseTranscriptRows - (taskTitle === undefined ? 0 : 1),
  );
  const transcriptRows = estimateTranscriptRows(
    allTranscriptEntries,
    columns,
    snapshot.summary,
  );
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
    let cancelled = false;
    if (activeInputPrompt !== undefined || suggestions.length > 0) {
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
    suggestions.length,
    value,
    workingDirectory,
  ]);

  const submitPrompt = (submitted: string): void => {
    setValue("");
    setCursor(0);
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
    const chars = Array.from(value);
    chars.splice(cursor, 0, text);
    setValue(chars.join(""));
    setCursor(cursor + Array.from(text).length);
  };

  const choosePathSuggestion = (index: number): void => {
    const suggestion = pathCompletion?.suggestions[index];
    if (!suggestion || pathCompletion === undefined) return;
    const chars = Array.from(value);
    const replacement = `@${suggestion.path}`;
    chars.splice(
      pathCompletion.tokenStart,
      pathCompletion.tokenEnd - pathCompletion.tokenStart,
      replacement,
    );
    setValue(chars.join(""));
    setCursor(pathCompletion.tokenStart + Array.from(replacement).length);
    setPathCompletion(undefined);
    setPathCompletionIndex(0);
    dismissedPathKey.current = undefined;
  };

  useInput((input, key) => {
    const mouseInput = composerMouseInput.push(input);
    if (mouseInput.consumed) {
      if (mouseInput.remaining.length === 0) return;
      input = mouseInput.remaining;
    }
    if (key.ctrl && (input === "c" || input === "\u0003")) {
      onCancel();
      return;
    }
    // Some terminals expose Home/End as raw escape sequences without Ink's
    // parsed key flags. Handle those sequences before the generic Escape path.
    const rawHome = input === "\u001b[H" || input === "\u001b[1~";
    const rawEnd = input === "\u001b[F" || input === "\u001b[4~";
    if (
      snapshot.sessionPicker === undefined &&
      activeInputPrompt === undefined &&
      value.length === 0 &&
      pathCompletion === undefined &&
      suggestions.length === 0 &&
      (rawHome || rawEnd)
    ) {
      const next = rawHome ? viewportModel.home() : viewportModel.end();
      setViewport(next);
      return;
    }
    if (key.escape) {
      if (activeInputPrompt !== undefined) {
        onApprovalAnswer?.("");
      } else if (snapshot.sessionPicker !== undefined) {
        onDismissSessionPicker?.();
      } else if (pathCompletion !== undefined) {
        dismissedPathKey.current = pathCompletionKey;
        setPathCompletion(undefined);
        setPathCompletionIndex(0);
      } else if (snapshot.retry !== undefined) {
        if (onDismissRetry) {
          onDismissRetry();
        } else {
          store.setRetry(undefined);
        }
      } else {
        onCancel();
      }
      return;
    }
    if (snapshot.sessionPicker !== undefined) {
      if (key.upArrow) {
        const next = snapshot.sessionPicker.selectedIndex - 1;
        store.setSessionPickerIndex(
          next < 0 ? snapshot.sessionPicker.rows.length - 1 : next,
        );
        return;
      }
      if (key.downArrow) {
        const next = snapshot.sessionPicker.selectedIndex + 1;
        store.setSessionPickerIndex(
          next >= snapshot.sessionPicker.rows.length ? 0 : next,
        );
        return;
      }
      if (key.return) {
        onSessionResume?.(snapshot.sessionPicker.selectedIndex);
        return;
      }
      return;
    }
    if (
      snapshot.sessionPicker === undefined &&
      activeInputPrompt === undefined &&
      key.pageUp
    ) {
      moveViewport("up");
      return;
    }
    if (
      snapshot.sessionPicker === undefined &&
      activeInputPrompt === undefined &&
      key.pageDown
    ) {
      moveViewport("down");
      return;
    }
    if (
      snapshot.sessionPicker === undefined &&
      activeInputPrompt === undefined &&
      value.length === 0 &&
      pathCompletion === undefined &&
      suggestions.length === 0 &&
      key.home
    ) {
      const next = viewportModel.home();
      setViewport(next);
      return;
    }
    if (
      snapshot.sessionPicker === undefined &&
      activeInputPrompt === undefined &&
      value.length === 0 &&
      pathCompletion === undefined &&
      suggestions.length === 0 &&
      key.end
    ) {
      const next = viewportModel.end();
      setViewport(next);
      return;
    }
    if (
      snapshot.retry !== undefined &&
      !busy &&
      activeInputPrompt === undefined &&
      value.length === 0 &&
      input.toLowerCase() === "r"
    ) {
      onRetry?.();
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
      const chars = Array.from(value);
      chars.splice(cursor, 0, textBeforeSubmit);
      submitPrompt(chars.join(""));
      return;
    }
    if (key.tab && pathCompletion?.suggestions.length) {
      choosePathSuggestion(pathCompletionIndex);
      return;
    }
    if (key.tab && suggestions.length > 0) {
      const suggestion = suggestions[0]?.command ?? "";
      setValue(suggestion);
      setCursor(suggestion.length);
      return;
    }
    if (pathCompletion?.suggestions.length && key.upArrow) {
      setPathCompletionIndex((index) =>
        index <= 0 ? pathCompletion.suggestions.length - 1 : index - 1,
      );
      return;
    }
    if (pathCompletion?.suggestions.length && key.downArrow) {
      setPathCompletionIndex((index) =>
        index >= pathCompletion.suggestions.length - 1 ? 0 : index + 1,
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
      setValue(next);
      setCursor(next.length);
      return;
    }
    if (key.downArrow) {
      if (historyIndex < 0) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        setValue("");
        setCursor(0);
        return;
      }
      const next = history[nextIndex] ?? "";
      setHistoryIndex(nextIndex);
      setValue(next);
      setCursor(next.length);
      return;
    }
    if (key.leftArrow) {
      setCursor((position) => Math.max(0, position - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((position) => Math.min(Array.from(value).length, position + 1));
      return;
    }
    if (key.home) {
      setCursor(0);
      return;
    }
    if (key.end) {
      setCursor(Array.from(value).length);
      return;
    }
    // macOS Terminal sends the Delete key as DEL (0x7f), which Ink exposes
    // as `key.delete`. Treat both terminal backspace variants as deleting the
    // character before the caret; otherwise deleting at the end is a no-op
    // because the old `key.delete` branch tried to delete forward.
    if (key.backspace || key.delete) {
      const chars = Array.from(value);
      if (cursor === 0) return;
      chars.splice(cursor - 1, 1);
      setValue(chars.join(""));
      setCursor(cursor - 1);
      return;
    }
    if (input === "\u000c") {
      setValue("");
      setCursor(0);
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
      <Box flexDirection="column" width={columns}>
      <Static items={staticItems} style={{ width: columns }}>
        {(item) => (
          <WelcomePanel
            key={item.id}
            provider={provider}
            model={model}
            sessionId={displayedSessionId}
            workingDirectory={workingDirectory}
            executor={executor}
            mcpCount={mcpCount}
            columns={columns}
          />
        )}
      </Static>
      <Box flexDirection="column" width={columns}>
        {taskTitle !== undefined ? (
          <StickyTaskHeader title={taskTitle} columns={columns} />
        ) : null}
        <TranscriptViewport
          snapshot={snapshot}
          entries={transcriptEntries}
          summary={snapshot.summary}
          columns={columns}
          viewport={renderedViewport}
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
          <CommandPalette suggestions={suggestions} columns={columns} />
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
        {activeInputPrompt !== undefined ? (
          <Box marginTop={1} width={columns - 2}>
            <Text color={getInkTheme(inputSnapshot.theme).warning} wrap="wrap">! {activeInputPrompt}</Text>
          </Box>
        ) : null}
      </Box>
      <Box flexDirection="column">
        <NavigationBar viewport={viewport} />
        <StatusLine snapshot={snapshot} busy={busy} />
        <Composer
          value={value}
          cursor={cursor}
          placeholder={promptLabel}
          width={columns - 2}
          approval={activeInputPrompt !== undefined}
        />
        <Footer
          workingDirectory={workingDirectory}
          sessionId={displayedSessionId}
          executor={executor}
          width={columns - 2}
        />
      </Box>
      </Box>
    </InkThemeProvider>
  );
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
        <Text>4. After a turn, wheel/PageUp/PageDown browse; Home/End jump to bounds.</Text>
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

function NavigationBar({
  viewport,
}: {
  readonly viewport: InkViewportSnapshot;
}): React.JSX.Element {
  const theme = useInkTheme();
  const browsing = !viewport.followOutput &&
    (viewport.hiddenAbove > 0 || viewport.hiddenBelow > 0 || viewport.newOutput > 0);
  if (!browsing) {
    return <Box height={1} />;
  }

  return (
    <Box paddingX={1} height={1}>
      <Text color={theme.primary}>
        ↓ Back to bottom · End latest
        {viewport.hiddenAbove > 0 ? ` · ${viewport.hiddenAbove} rows above` : ""}
        {viewport.hiddenBelow > 0 ? ` · ${viewport.hiddenBelow} rows below` : ""}
        {viewport.newOutput > 0 ? " · new output below" : ""}
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
  if (summary.usage !== undefined) {
    lines.push(
      `[usage] prompt=${summary.usage.promptTokens ?? 0} completion=${summary.usage.completionTokens ?? 0} total=${summary.usage.totalTokens ?? 0}`,
    );
  }
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
        <Text color={theme.muted}>STATUS / {statusLabel(snapshot.state)} · mode={snapshot.speedMode}</Text>
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
}: {
  value: string;
  cursor: number;
  placeholder: string;
  width: number;
  approval: boolean;
}): React.JSX.Element {
  const theme = useInkTheme();
  const chars = Array.from(value);
  const before = chars.slice(0, cursor).join("");
  const cursorAtEnd = chars[cursor] === undefined;
  const active = chars[cursor] ?? "█";
  const after = chars.slice(cursor + (chars[cursor] === undefined ? 0 : 1)).join("");

  return (
    <Box
      borderStyle="round"
      borderColor={theme.composer}
      paddingX={1}
      marginTop={1}
      width={Math.max(20, width)}
      aria-role="textbox"
      aria-state={{ busy: approval }}
    >
      <Text color={theme.prompt}>› </Text>
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
      )}
    </Box>
  );
}

function Footer({
  workingDirectory,
  sessionId,
  executor,
  width,
}: {
  workingDirectory: string;
  sessionId: string;
  executor: string;
  width: number;
}): React.JSX.Element {
  const theme = useInkTheme();
  const available = Math.max(20, width - 2);
  const right = `${sessionId} · ${executor} · ${theme.name}`;
  const separator = "  ";
  const leftWidth = Math.max(
    1,
    available - displayWidth(right) - displayWidth(separator),
  );
  const left = truncateToDisplayWidth(shortenPath(workingDirectory), leftWidth);
  const gap = " ".repeat(
    Math.max(
      displayWidth(separator),
      available - displayWidth(left) - displayWidth(right),
    ),
  );

  return (
    <Box width={Math.max(20, width)} justifyContent="space-between" paddingX={1}>
      <Text dimColor wrap="truncate-end">{left}{gap}{right}</Text>
    </Box>
  );
}

function commandSuggestions(
  value: string,
  commands: readonly CommandHint[],
): readonly CommandHint[] {
  const prefix = value.trimStart();
  if (!prefix.startsWith(":") && !prefix.startsWith("/")) {
    return [];
  }
  const normalized = prefix.slice(1).toLowerCase();
  return commands.filter((command) => {
    const name = command.command.replace(/^[:/]/, "").toLowerCase();
    return normalized.length === 0 || name.startsWith(normalized);
  });
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
