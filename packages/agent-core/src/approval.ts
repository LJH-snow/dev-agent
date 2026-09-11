import { resolve, sep } from "node:path";

/**
 * Approval policies decide whether a tool call may run.
 *
 * A denial is written back as the tool's result so the model can adapt, rather
 * than failing the whole run.
 */

export type ApprovalDecision = "allow" | "deny";

export interface ApprovalOutcome {
  readonly decision: ApprovalDecision;
  /** Shown to the model and the caller when a call is denied. */
  readonly reason?: string;
}

export interface ApprovalRequest {
  readonly toolName: string;
  readonly input: unknown;
  readonly sessionId: string;
  readonly workingDirectory: string;
}

export interface ApprovalPolicy {
  decide(
    request: ApprovalRequest
  ): Promise<ApprovalOutcome | ApprovalDecision> | ApprovalOutcome | ApprovalDecision;
}

export interface DangerousPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

/** Command shapes that deserve a decision before they run. */
export const DANGEROUS_PATTERNS: readonly DangerousPattern[] = [
  { name: "recursive delete", pattern: /\brm\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*[rR][a-zA-Z]*/ },
  { name: "privilege escalation", pattern: /(^|[\s;&|])sudo\s/ },
  { name: "disk formatting", pattern: /\bmkfs(?:\.\w+)?\b/ },
  { name: "raw disk write", pattern: /\bdd\b[^|;&]*\bof=/ },
  { name: "power control", pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/ },
  { name: "force push", pattern: /\bgit\s+push\b[^|;&]*--force(?:-with-lease)?\b/ },
  {
    name: "pipe to shell",
    pattern: /\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba|z|d|k)?sh\b/,
  },
  { name: "world-writable", pattern: /\bchmod\b[^|;&]*(?:-R\s+)?777\b/ },
  { name: "fork bomb", pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
  { name: "history rewrite", pattern: /\bgit\s+(?:reset\s+--hard|clean\b[^|;&]*-[a-zA-Z]*f)/ },
  { name: "privileged container", pattern: /\b(?:nsenter\b|docker\s+run\s+--privileged\b)/ },
];

export interface DenyDangerousOptions {
  /** Extra patterns, matched the same way as the built-in ones. */
  readonly patterns?: readonly RegExp[];
  /** Set false to skip the "write outside the working directory" check. */
  readonly checkFilesystem?: boolean;
  /**
   * Commands containing any of these substrings are always allowed, even when
   * a pattern matches. Meant for user-approved workflows like "npm test".
   */
  readonly allowlist?: readonly string[];
}

/** The `approval` section of `~/.dev-agent/config.json`. */
export interface ApprovalConfig {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

export interface CompiledApprovalConfig {
  readonly allowlist: readonly string[];
  readonly patterns: readonly RegExp[];
}

/**
 * Turns the config strings into what `denyDangerousPolicy` wants. Malformed
 * regular expressions are skipped (with the rest of the list still applied)
 * rather than failing every tool call.
 */
export function compileApprovalConfig(
  config: ApprovalConfig | undefined
): CompiledApprovalConfig {
  const allowlist = (config?.allow ?? []).map((entry) => entry.trim()).filter(Boolean);
  const patterns: RegExp[] = [];

  for (const source of config?.deny ?? []) {
    const trimmed = source.trim();
    if (!trimmed) {
      continue;
    }
    try {
      patterns.push(new RegExp(trimmed));
    } catch {
      // Ignore an unusable pattern instead of breaking every call.
    }
  }

  return { allowlist, patterns };
}

/** Allows everything: the default, matching the behaviour before policies existed. */
export function allowAllPolicy(): ApprovalPolicy {
  return { decide: () => ({ decision: "allow" }) };
}

/** Denies commands that match a dangerous pattern or write outside the workspace. */
export function denyDangerousPolicy(options: DenyDangerousOptions = {}): ApprovalPolicy {
  const patterns: readonly DangerousPattern[] = [
    ...DANGEROUS_PATTERNS,
    ...(options.patterns ?? []).map((pattern, index) => ({
      name: `custom pattern ${index + 1}`,
      pattern,
    })),
  ];
  const checkFilesystem = options.checkFilesystem ?? true;
  const allowlist = options.allowlist ?? [];

  return {
    decide(request) {
      const command = commandText(request);
      if (command !== undefined) {
        if (allowlist.some((entry) => command.includes(entry))) {
          return { decision: "allow" };
        }
        for (const { name, pattern } of patterns) {
          // Reset so a caller-supplied /g pattern cannot skip matches.
          pattern.lastIndex = 0;
          if (pattern.test(command)) {
            return { decision: "deny", reason: `${name}: ${command.trim()}` };
          }
        }
      }

      if (checkFilesystem) {
        const outside = outsideWorkingDirectoryWrite(request);
        if (outside) {
          return { decision: "deny", reason: outside };
        }
      }

      return { decision: "allow" };
    },
  };
}

/** The command line a tool would run, when it runs one at all. */
export function commandText(request: ApprovalRequest): string | undefined {
  const input = asRecord(request.input);

  if (request.toolName === "git") {
    const args = toStringArray(input.args);
    return args.length > 0 ? `git ${args.join(" ")}` : undefined;
  }

  if (request.toolName === "shell") {
    const command = typeof input.command === "string" ? input.command : "";
    if (!command) {
      return undefined;
    }
    return [command, ...toStringArray(input.args)].join(" ");
  }

  return undefined;
}

function outsideWorkingDirectoryWrite(request: ApprovalRequest): string | undefined {
  if (request.toolName !== "filesystem") {
    return undefined;
  }
  const input = asRecord(request.input);
  if (
    input.action !== "write" &&
    input.action !== "edit" &&
    input.action !== "patch" &&
    input.action !== "mkdir"
  ) {
    return undefined;
  }
  const path = typeof input.path === "string" ? input.path : "";
  if (!path) {
    return undefined;
  }

  const root = resolve(request.workingDirectory);
  const target = resolve(request.workingDirectory, path);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target === root || target.startsWith(prefix)) {
    return undefined;
  }
  return `filesystem ${String(input.action)} outside the working directory: ${target}`;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return value as Record<string, unknown>;
}
