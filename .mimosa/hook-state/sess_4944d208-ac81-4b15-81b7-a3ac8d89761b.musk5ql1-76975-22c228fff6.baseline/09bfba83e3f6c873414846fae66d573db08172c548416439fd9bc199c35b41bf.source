import { Box, Text } from "ink";

import type {
  InkMcpServerSnapshot,
  InkMcpServerState,
  InkMcpSnapshot,
} from "./runtime-store.js";
import { useInkTheme } from "./theme.js";

export function McpPanel({
  snapshot,
  columns,
}: {
  readonly snapshot: InkMcpSnapshot | undefined;
  readonly columns: number;
}): React.JSX.Element | null {
  const theme = useInkTheme();
  if (snapshot === undefined) return null;

  return (
    <Box
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
        snapshot.servers.map((server) => <McpServerRow key={server.name} server={server} />)
      )}
      <Text color={theme.warning}>
        :mcp status · :mcp test · :mcp templates
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
