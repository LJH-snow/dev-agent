import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

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
  {
    name: "recursive delete",
    // Short (`-r`, `-rf`, `-fr`) and long (`--recursive`) options both count;
    // `rm --force file` without recursion does not.
    pattern:
      /\brm\s+(?:[^|;&]*\s)?(?:-(?!-)[a-zA-Z]*[rR][a-zA-Z]*|--recursive\b)/,
  },
  { name: "privilege escalation", pattern: /(^|[\s;&|])sudo\s/ },
  { name: "disk formatting", pattern: /\bmkfs(?:\.\w+)?\b/ },
  { name: "raw disk write", pattern: /\bdd\b[^|;&]*\bof=/ },
  { name: "power control", pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/ },
  {
    name: "force push",
    // `-f`, `--force`, its lease variants, and `+refspec` all rewrite history.
    pattern:
      /\bgit\s+push\b[^|;&]*(?:--force(?:-with-lease|-if-includes)?\b|(?:^|\s)-f(?:\s|$)|(?:^|\s)\+[^\s|;&]+)/,
  },
  {
    name: "git command execution",
    // `-c`/`--config-env`/`--exec-path` and the pack options let git spawn
    // another process (e.g. `-c alias.x=!cmd`), so they need a decision.
    pattern:
      /\bgit\b[^|;&]*(?:(?:^|\s)-c|(?:^|\s)--(?:config-env|exec-path|upload-pack|receive-pack)(?:\s|=|$))/,
  },
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

/**
 * A stable key for "always allow" decisions: the command plus up to two
 * leading non-flag tokens, so `npm test` and `npm test -- --watch` share a key
 * while `npm run test` and `npm run build` do not. Returns undefined for tools
 * that run no command.
 */
export function normalizeApprovalKey(request: ApprovalRequest): string | undefined {
  const command = shellScript(request) ?? commandText(request);
  if (!command) {
    return undefined;
  }

  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const [name, ...rest] = tokens;
  if (!name) {
    return undefined;
  }
  const leading = rest.filter((token) => !token.startsWith("-")).slice(0, 2);
  return leading.length > 0 ? `${name} ${leading.join(" ")}` : name;
}

/** The script handed to `sh -c`-style invocations, when there is one. */
function shellScript(request: ApprovalRequest): string | undefined {
  if (request.toolName !== "shell") {
    return undefined;
  }
  const input = asRecord(request.input);
  const command = typeof input.command === "string" ? input.command : "";
  if (!/(^|\/)(sh|bash|zsh)$/.test(command)) {
    return undefined;
  }
  const args = toStringArray(input.args);
  const flagIndex = args.indexOf("-c");
  const script = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
  return typeof script === "string" && script.trim().length > 0 ? script : undefined;
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
  const insideByPath = isWithin(root, target);
  const resolved = resolveForBoundaryCheck(root, target);
  if (insideByPath && resolved.inside) {
    return undefined;
  }

  // Report the real location when we could compute one: a symlink escape shows
  // the requested path looking innocent and the resolved path outside.
  const detail = resolved.path && !resolved.inside ? ` (resolves to ${resolved.path})` : "";
  return `filesystem ${String(input.action)} outside the working directory: ${target}${detail}`;
}

/** True when `target` is `root` itself or sits underneath it. */
function isWithin(root: string, target: string): boolean {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return target === root || target.startsWith(prefix);
}

interface ResolvedBoundary {
  /** Real path when it could be computed, otherwise undefined. */
  readonly path?: string;
  /** False when the real path escapes `root` (or could not be resolved). */
  readonly inside: boolean;
}

/**
 * Resolves symlinks before deciding whether a write stays inside the working
 * directory. Comparing the requested path as a string let a symlink inside the
 * workspace point at a file outside it: the write followed the link, so the
 * policy allowed an out-of-workspace overwrite.
 *
 * The target itself may not exist yet (`write` of a new file, `mkdir`), so the
 * deepest existing ancestor is resolved and the missing tail is appended.
 */
function resolveForBoundaryCheck(root: string, target: string): ResolvedBoundary {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    // The workspace does not exist yet (fresh checkout, tests with a virtual
    // path). Nothing inside it can be a symlink, so the string comparison the
    // caller already did is the whole story -- and refusing here would block
    // legitimate in-workspace writes.
    return { inside: true };
  }

  let existing = target;
  const missing: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) {
      return { inside: false };
    }
    missing.unshift(existing.slice(parent.length + 1));
    existing = parent;
  }

  try {
    const realExisting = realpathSync(existing);
    const realTarget = missing.length > 0 ? join(realExisting, ...missing) : realExisting;
    return { path: realTarget, inside: isWithin(realRoot, realTarget) };
  } catch {
    return { inside: false };
  }
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
