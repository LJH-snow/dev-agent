import { useEffect, useRef } from "react";
import { Box, Text, measureElement, type DOMElement } from "ink";

import type { PanelLayout } from "./panel-hitbox.js";
import type {
  InkMcpServerSnapshot,
  InkMcpServerState,
  InkMcpSnapshot,
} from "./runtime-store.js";
import { useInkTheme } from "./theme.js";

export interface McpPanelProps {
  readonly snapshot: InkMcpSnapshot | undefined;
  readonly columns: number;
  /** First server row painted in the scrolling visible window. */
  readonly offset?: number;
  readonly onLayout?: (layout: PanelLayout) => void;
}

/** Rows painted above the first server row: top border + header. */
export const MCP_PANEL_HEADER_ROWS = 2;
/**
 * Server registries can grow long; painting every row would push the composer
 * and footer out of the terminal, so the card renders a bounded window that
 * the pointer can scroll while hovering it.
 */
export const MCP_SERVERS_VISIBLE = 8;

export function McpPanel({
  snapshot,
  columns,
  offset = 0,
  onLayout,
}: McpPanelProps): React.JSX.Element | null {
  const theme = useInkTheme();
  const boxRef = useRef<DOMElement | null>(null);
  const reportedLayoutRef = useRef("");
  // Same measured-layout contract as the session picker so pointer hit-testing
  // stays aligned with what is painted; the change guard keeps re-measures
  // from re-rendering the whole app.
  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    try {
      const measured = measureElement(node);
      if (measured.height <= 0) return;
      const key = `${measured.y}:${measured.height}`;
      if (key !== reportedLayoutRef.current) {
        reportedLayoutRef.current = key;
        onLayout?.({ top: measured.y, height: measured.height });
      }
    } catch {
      // The node is not attached yet; the next commit measures it.
    }
  });
  if (snapshot === undefined) return null;

  const visible = snapshot.servers.slice(offset, offset + MCP_SERVERS_VISIBLE);
  const windowEnd = Math.min(offset + MCP_SERVERS_VISIBLE, snapshot.servers.length);
  return (
    <Box
      ref={boxRef}
      flexDirection="column"
      borderStyle="round"
      borderColor={panelBorderColor(snapshot, theme)}
      paddingX={1}
      marginTop={1}
      width={Math.max(24, columns - 2)}
    >
      <Text color={theme.info} bold>
        ✦ MCP CAPABILITIES · {snapshot.status.toUpperCase()} · {snapshot.totals.servers} server{snapshot.totals.servers === 1 ? "" : "s"}
      </Text>
      {snapshot.servers.length === 0 ? (
        <Text dimColor>No MCP servers configured. Use :mcp add or :mcp templates.</Text>
      ) : (
        visible.map((server) => <McpServerRow key={server.name} server={server} />)
      )}
      <Text color={theme.warning}>
        {snapshot.servers.length > MCP_SERVERS_VISIBLE
          ? `:mcp status · :mcp test · :mcp templates · ${offset + 1}–${windowEnd}/${snapshot.servers.length}`
          : ":mcp status · :mcp test · :mcp templates"}
      </Text>
    </Box>
  );
}

function McpServerRow({ server }: { readonly server: InkMcpServerSnapshot }): React.JSX.Element {
  const theme = useInkTheme();
  const stateColor = mcpStateColor(server.state, theme);
  const counts = `T${server.tools} R${server.resources} P${server.prompts}`;
  const latency = server.latencyMs === undefined ? "" : ` · ${server.latencyMs}ms`;
  const retry = server.reconnectAttempt === undefined
    ? ""
    : ` · attempt ${server.reconnectAttempt}`;
  const reason = server.reason === undefined ? "" : ` · ${server.reason}`;
  return (
    <Text wrap="truncate-end">
      <Text color={stateColor} bold>{mcpStateGlyph(server.state)} </Text>
      <Text color={theme.text} bold>{server.name}</Text>
      <Text dimColor> · {server.state} · {counts}{latency}{retry}</Text>
      {reason ? <Text color={theme.warning}>{reason}</Text> : null}
    </Text>
  );
}

function mcpStateGlyph(state: InkMcpServerState): string {
  switch (state) {
    case "ready":
      return "✓";
    case "connecting":
      return "◌";
    case "reconnecting":
      return "↻";
    case "timeout":
      return "⌛";
    case "failed":
    case "invalid":
      return "×";
    case "disabled":
      return "∅";
    case "changed":
      return "!";
    case "skipped":
      return "·";
    case "configured":
    default:
      return "○";
  }
}

function mcpStateColor(
  state: InkMcpServerState,
  theme: ReturnType<typeof useInkTheme>,
): string {
  switch (state) {
    case "ready":
      return theme.success;
    case "connecting":
    case "reconnecting":
      return theme.info;
    case "timeout":
    case "changed":
    case "disabled":
      return theme.warning;
    case "failed":
    case "invalid":
      return theme.error;
    case "configured":
    case "skipped":
    default:
      return theme.muted;
  }
}

function panelBorderColor(
  snapshot: InkMcpSnapshot,
  theme: ReturnType<typeof useInkTheme>,
): string {
  if (snapshot.status === "degraded") return theme.warning;
  if (snapshot.status === "ready") return theme.success;
  if (snapshot.status === "disabled") return theme.muted;
  return theme.info;
}
