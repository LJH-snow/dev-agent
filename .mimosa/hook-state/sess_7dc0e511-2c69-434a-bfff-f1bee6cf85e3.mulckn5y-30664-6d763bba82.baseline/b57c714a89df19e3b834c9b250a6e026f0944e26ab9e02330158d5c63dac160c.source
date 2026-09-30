import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type SecurityFindingSeverity = "high" | "medium" | "low";
export type SecurityFindingCategory = "secret" | "sensitive-file" | "mcp" | "workspace-boundary";
export interface SecurityFinding {
  readonly severity: SecurityFindingSeverity;
  readonly category: SecurityFindingCategory;
  readonly location: string;
  readonly summary: string;
}
export interface SecurityScanResult {
  readonly status: "clean" | "findings" | "partial";
  readonly findings: readonly SecurityFinding[];
  readonly filesScanned: number;
  readonly bytesScanned: number;
  readonly skippedEntries: number;
}
export interface SecurityScanOptions {
  readonly workingDirectory: string;
  readonly mcpServers?: readonly unknown[];
  readonly maxFiles?: number;
  readonly maxBytes?: number;
}
export type SecurityCommand = { readonly handled: true; readonly action: "scan" | "help" | "invalid" } | { readonly handled: false };

const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "output", ".playwright-cli"]);
const SECRET_PATTERNS = [
  /(?:api[_-]?key|access[_-]?token|password|passphrase|secret|authorization|bearer)\s*[:=]\s*[^\s,;]+/iu,
  /\bsk-[a-z0-9_-]{12,}\b/iu,
  /-----BEGIN\s+(?:OPENSSH|RSA|EC|PRIVATE)\s+KEY-----/iu,
];
const SENSITIVE_FILE = /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|jks)|id_(?:rsa|ed25519)|credentials(?:\..*)?)$/iu;
const SHELL_COMMAND = /(?:^|[\\/])(?:sh|bash|zsh|fish|cmd|powershell|pwsh)(?:\.exe)?$/iu;
const SECRET_ENV = /(?:key|token|secret|password|credential|authorization|cookie)/iu;
const MAX_FINDINGS = 128;

export async function scanWorkspace(options: SecurityScanOptions): Promise<SecurityScanResult> {
  const root = resolve(options.workingDirectory);
  const maxFiles = bounded(options.maxFiles, 512);
  const maxBytes = bounded(options.maxBytes, 4 * 1024 * 1024);
  const findings: SecurityFinding[] = [];
  let filesScanned = 0;
  let bytesScanned = 0;
  let skippedEntries = 0;
  const queue = [root];
  while (queue.length > 0 && filesScanned < maxFiles && bytesScanned < maxBytes) {
    const directory = queue.shift()!;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { skippedEntries++; continue; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (findings.length >= MAX_FINDINGS || filesScanned >= maxFiles || bytesScanned >= maxBytes) break;
      const absolute = resolve(directory, entry.name);
      const location = safeLocation(root, absolute);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) queue.push(absolute);
        else skippedEntries++;
        continue;
      }
      if (entry.isSymbolicLink()) {
        try {
          const target = await realpath(absolute);
          if (!isWithin(root, target)) addFinding(findings, { severity: "high", category: "workspace-boundary", location, summary: "Symlink points outside the workspace." });
        } catch { skippedEntries++; }
        continue;
      }
      if (!entry.isFile()) { skippedEntries++; continue; }
      if (SENSITIVE_FILE.test(entry.name)) addFinding(findings, { severity: "medium", category: "sensitive-file", location, summary: "Sensitive-looking file should be excluded from commits and uploads." });
      try {
        const stat = await lstat(absolute);
        if (stat.size > 128 * 1024) { skippedEntries++; continue; }
        const bytes = await readFile(absolute);
        bytesScanned += bytes.byteLength;
        filesScanned++;
        if (looksText(bytes)) {
          const text = bytes.toString("utf8");
          if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) addFinding(findings, { severity: "high", category: "secret", location, summary: "Secret-like material detected; rotate it and remove it from tracked files." });
        }
      } catch { skippedEntries++; }
    }
  }
  inspectMcp(options.mcpServers, findings);
  const status = findings.length === 0 ? (skippedEntries > 0 ? "partial" : "clean") : "findings";
  return { status, findings, filesScanned, bytesScanned, skippedEntries };
}

export function parseSecurityCommand(command: string): SecurityCommand | undefined {
  const normalized = command.trim().replace(/^\//u, ":");
  if (normalized === ":security" || normalized === ":security scan") return { handled: true, action: "scan" };
  if (normalized === ":security help") return { handled: true, action: "help" };
  if (normalized.startsWith(":security")) return { handled: true, action: "invalid" };
  return undefined;
}

export function formatSecurityScan(result: SecurityScanResult): string {
  const lines = [`Security Center · ${result.status}`, `Scanned ${result.filesScanned} file(s), ${result.bytesScanned} byte(s).`];
  if (result.findings.length === 0) lines.push(result.status === "partial" ? "No findings in the bounded scan; some entries were skipped." : "No findings.");
  else {
    lines.push(`Findings: ${result.findings.length}`);
    for (const finding of result.findings) lines.push(`- [${finding.severity}] ${finding.category} · ${finding.location} · ${finding.summary}`);
  }
  return lines.join("\n");
}

function inspectMcp(servers: readonly unknown[] | undefined, findings: SecurityFinding[]): void {
  if (!Array.isArray(servers)) return;
  for (const [index, raw] of servers.entries()) {
    if (!isRecord(raw)) continue;
    const command = typeof raw.command === "string" ? raw.command : "";
    const env = isRecord(raw.env) ? raw.env : undefined;
    if (SHELL_COMMAND.test(command) || (Array.isArray(raw.args) && raw.args.some((arg) => typeof arg === "string" && /^-c$/u.test(arg)))) {
      addFinding(findings, { severity: "medium", category: "mcp", location: `mcp[${index}]`, summary: "MCP entry invokes a shell; review command and arguments before enabling it." });
    }
    if (env && Object.keys(env).some((key) => SECRET_ENV.test(key))) {
      addFinding(findings, { severity: "medium", category: "mcp", location: `mcp[${index}]`, summary: "MCP entry receives secret-like environment variables; prefer a managed secret reference." });
    }
  }
}
function addFinding(findings: SecurityFinding[], finding: SecurityFinding): void { if (!findings.some((item) => item.category === finding.category && item.location === finding.location && item.summary === finding.summary)) findings.push(finding); }
function safeLocation(root: string, path: string): string { const value = relative(root, path).split(sep).join("/"); return value && !value.startsWith("../") && value !== ".." ? value : "<workspace>"; }
function isWithin(root: string, path: string): boolean { const r = resolve(root); const p = resolve(path); return p === r || p.startsWith(`${r}${sep}`); }
function looksText(bytes: Buffer): boolean { return bytes.subarray(0, Math.min(bytes.length, 2048)).every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128); }
function bounded(value: number | undefined, fallback: number): number { return value !== undefined && Number.isSafeInteger(value) && value > 0 ? Math.min(value, fallback * 4) : fallback; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
