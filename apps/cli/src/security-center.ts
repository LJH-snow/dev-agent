export {
  formatSecurityScan,
  scanWorkspace,
  type SecurityFinding,
  type SecurityFindingCategory,
  type SecurityFindingSeverity,
  type SecurityScanOptions,
  type SecurityScanResult,
} from "@dev-agent/agent-core";

export type SecurityCommand = { readonly handled: true; readonly action: "scan" | "history" | "help" | "invalid" } | { readonly handled: false };

export function parseSecurityCommand(command: string): SecurityCommand | undefined {
  const normalized = command.trim().replace(/^\//u, ":");
  if (normalized === ":security" || normalized === ":security scan") return { handled: true, action: "scan" };
  if (normalized === ":security history") return { handled: true, action: "history" };
  if (normalized === ":security help") return { handled: true, action: "help" };
  if (normalized.startsWith(":security")) return { handled: true, action: "invalid" };
  return undefined;
}
