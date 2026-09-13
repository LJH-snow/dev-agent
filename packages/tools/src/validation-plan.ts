import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  createValidationId,
  type ValidationCheck,
  type ValidationCommand,
  type ValidationPlan,
  type ValidationPlanStatus,
} from "@dev-agent/agent-core";
import type { ChangeSetReview } from "./change-set.js";

const DEFAULT_TYPECHECK_TIMEOUT_MS = 120_000;
const DEFAULT_TEST_TIMEOUT_MS = 180_000;
const DEFAULT_RUST_TIMEOUT_MS = 300_000;
const DEFAULT_DIFF_CHECK_TIMEOUT_MS = 30_000;

export interface ValidationPlanTimeouts {
  readonly typecheckMs?: number;
  readonly testMs?: number;
  readonly rustMs?: number;
  readonly diffCheckMs?: number;
}

export interface ValidationPlanContext {
  readonly workingDirectory: string;
  /** Set false when the workspace is not a Git checkout. */
  readonly isGitRepository?: boolean;
  readonly timeouts?: ValidationPlanTimeouts;
}

interface PackageScope {
  readonly name: string;
  readonly hasSource: boolean;
  readonly hasTests: boolean;
}

interface NormalizedReviewFile {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly changed: boolean;
}

const TYPESCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/i;
const TEST_FILE = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const DOC_OR_CONFIG_FILE = /(?:^|\/)(?:README(?:\.[^.]+)?|CHANGELOG(?:\.[^.]+)?|docs\/)|\.(?:md|mdx|txt|ya?ml|json|toml|ini|conf)$/i;

/**
 * Derives a deterministic, structured validation plan from review metadata.
 * No diff text or model-provided command is ever copied into a command.
 */
export function deriveValidationPlan(
  review: ChangeSetReview,
  context: ValidationPlanContext
): ValidationPlan {
  const root = resolve(context.workingDirectory);
  const normalized = normalizeReviewFiles(review, root);
  const validationId = createValidationId(review.changeSetId);

  if (normalized.status !== "ready") {
    return planWithoutChecks(
      validationId,
      review.changeSetId,
      normalized.status,
      normalized.reason
    );
  }

  const changedFiles = normalized.files.filter((file) => file.changed);
  if (changedFiles.length === 0) {
    return planWithoutChecks(
      validationId,
      review.changeSetId,
      "skipped",
      "no changed files require validation"
    );
  }

  const packages = new Map<string, PackageScope>();
  let hasRust = false;
  const diffPaths: string[] = [];

  for (const file of changedFiles) {
    const packageScope = packageScopeFor(file.path);
    if (packageScope) {
      const previous = packages.get(packageScope.name);
      packages.set(packageScope.name, {
        name: packageScope.name,
        hasSource: (previous?.hasSource ?? false) || packageScope.hasSource,
        hasTests: (previous?.hasTests ?? false) || packageScope.hasTests,
      });
    }
    if (isRustRuntimePath(file.path)) {
      hasRust = true;
    }
    if (context.isGitRepository !== false && isDiffCheckPath(file.path)) {
      diffPaths.push(file.path);
    }
  }

  const checks: ValidationCheck[] = [];
  const timeouts = context.timeouts;
  const packageNames = [...packages.keys()].sort(compareLexically);
  for (const packageName of packageNames) {
    const scope = packages.get(packageName)!;
    if (scope.hasSource) {
      checks.push(
        packageCheck(
          packageName,
          "typecheck",
          root,
          timeout(timeouts?.typecheckMs, DEFAULT_TYPECHECK_TIMEOUT_MS)
        )
      );
    }
    if (scope.hasTests || scope.hasSource) {
      checks.push(
        packageCheck(
          packageName,
          "test",
          root,
          timeout(timeouts?.testMs, DEFAULT_TEST_TIMEOUT_MS)
        )
      );
    }
  }

  if (hasRust) {
    const rustCwd = join(root, "runtime", "rust");
    checks.push(
      check("rust:fmt", "Format-check the Rust runtime", {
        executable: "cargo",
        args: ["fmt", "--check"],
        cwd: rustCwd,
        timeoutMs: timeout(timeouts?.rustMs, DEFAULT_RUST_TIMEOUT_MS),
      }),
      check("rust:clippy", "Lint the Rust runtime", {
        executable: "cargo",
        args: ["clippy", "--all-targets", "--", "-D", "warnings"],
        cwd: rustCwd,
        timeoutMs: timeout(timeouts?.rustMs, DEFAULT_RUST_TIMEOUT_MS),
      }),
      check("rust:test", "Test the Rust runtime", {
        executable: "cargo",
        args: ["test"],
        cwd: rustCwd,
        timeoutMs: timeout(timeouts?.rustMs, DEFAULT_RUST_TIMEOUT_MS),
      })
    );
  }

  diffPaths.sort(compareLexically);
  if (diffPaths.length > 0) {
    checks.push(
      check("workspace:diff-check", "Check changed paths for whitespace errors", {
        executable: "git",
        args: ["diff", "--check", "--", ...diffPaths],
        cwd: root,
        timeoutMs: timeout(timeouts?.diffCheckMs, DEFAULT_DIFF_CHECK_TIMEOUT_MS),
      })
    );
  }

  if (checks.length === 0) {
    return planWithoutChecks(
      validationId,
      review.changeSetId,
      "skipped",
      "no safe validation checks could be derived from the changed paths"
    );
  }

  return {
    validationId,
    changeSetId: review.changeSetId,
    status: "ready",
    checks,
    summary: `${checks.length} validation check${checks.length === 1 ? "" : "s"} planned`,
  };
}

function normalizeReviewFiles(
  review: ChangeSetReview,
  root: string
):
  | { readonly status: "ready"; readonly files: readonly NormalizedReviewFile[] }
  | { readonly status: Exclude<ValidationPlanStatus, "ready">; readonly reason: string } {
  const seen = new Set<string>();
  const files: NormalizedReviewFile[] = [];

  for (const file of review.files) {
    if (file.path.includes("\0")) {
      return { status: "blocked", reason: `review path contains a NUL byte: ${file.path}` };
    }
    const target = resolve(root, file.path);
    const relativePath = relative(root, target);
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      return {
        status: "blocked",
        reason: `review path is outside the working directory or not relative: ${file.path}`,
      };
    }
    const normalizedPath = relativePath.split(sep).join("/");
    if (seen.has(normalizedPath)) {
      return { status: "blocked", reason: `duplicate path in review: ${normalizedPath}` };
    }
    seen.add(normalizedPath);
    files.push({
      path: normalizedPath,
      kind: file.kind,
      changed: file.kind === "directory"
        ? !file.beforeExists || !file.afterExists || file.beforeHash !== file.afterHash
        : file.beforeExists !== file.afterExists || file.beforeHash !== file.afterHash,
    });
  }

  return { status: "ready", files };
}

function packageScopeFor(path: string): PackageScope | undefined {
  const match = /^(?:packages|apps)\/([^/]+)(?:\/|$)/.exec(path);
  if (!match) {
    return undefined;
  }
  const directory = match[1]!;
  const packageName = `@dev-agent/${directory}`;
  const rest = path.slice(match[0].length);
  const isTest = TEST_FILE.test(rest);
  const isSource = TYPESCRIPT_FILE.test(rest) || /^(?:package\.json|tsconfig(?:\.[^/]+)?\.json)$/.test(rest);
  if (!isSource && !isTest) {
    return undefined;
  }
  return { name: packageName, hasSource: isSource && !isTest, hasTests: isTest };
}

function isRustRuntimePath(path: string): boolean {
  return /^(?:runtime\/rust\/.*\.(?:rs)|runtime\/rust\/Cargo\.(?:toml|lock))$/i.test(path);
}

function isDiffCheckPath(path: string): boolean {
  return DOC_OR_CONFIG_FILE.test(path) && !packageScopeFor(path) && !isRustRuntimePath(path);
}

function packageCheck(
  packageName: string,
  script: "typecheck" | "test",
  cwd: string,
  timeoutMs: number
): ValidationCheck {
  return check(
    `package:${packageName}:${script}`,
    `${script === "typecheck" ? "Typecheck" : "Test"} ${packageName}`,
    {
      executable: "pnpm",
      args: ["--filter", packageName, script],
      cwd,
      timeoutMs,
    }
  );
}

function check(id: string, label: string, command: ValidationCommand): ValidationCheck {
  return { id, label, command };
}

function timeout(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function planWithoutChecks(
  validationId: string,
  changeSetId: string,
  status: Exclude<ValidationPlanStatus, "ready">,
  reason: string
): ValidationPlan {
  return {
    validationId,
    changeSetId,
    status,
    checks: [],
    summary: status === "blocked" ? "validation is blocked" : "validation is skipped",
    reason,
  };
}

function compareLexically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
