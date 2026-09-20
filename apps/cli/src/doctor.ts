import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_RUST_EXECUTOR_MAX_FRAME_BYTES,
  resolveExecutorMode,
  type ExecutorMode,
} from "@dev-agent/executor";
import { redactSensitiveText, sanitizeTerminalText } from "./tui-renderer.js";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorStatus;
  readonly detail: string;
}

export type DoctorConfigSource = "explicit" | "project" | "user";

export interface DoctorScope {
  /** The selected working directory is intentionally represented as a scope label, not a path. */
  readonly workingDirectoryScope: "final-cwd";
  readonly projectState: boolean;
  readonly configSource: DoctorConfigSource;
}

export interface DoctorRuntimeSelection {
  readonly source: "explicit-path" | "runtime" | "environment" | "default-local";
  readonly configured: boolean;
  readonly selectedMode: ExecutorMode;
  readonly runtimeVersion?: string;
  readonly protocolVersion?: number;
  readonly target?: string;
  readonly state?: "unsupported" | "missing" | "installed" | "corrupt";
  readonly missingReason?: string;
}

export interface DoctorManagedRuntimeStatus {
  readonly state: "unsupported" | "missing" | "installed" | "corrupt";
  readonly version: string;
  readonly target?: string;
  readonly reason?: string;
}

export interface DoctorReport {
  /** The selected executor backend; health checks separately report availability. */
  readonly executorMode: ExecutorMode;
  readonly scope?: DoctorScope;
  readonly runtime?: DoctorRuntimeSelection;
  readonly checks: readonly DoctorCheck[];
  readonly summary: { readonly ok: number; readonly warn: number; readonly fail: number };
}

export interface RustProbeResult {
  readonly runtimeVersion: string;
  /** Missing on pre-v0.2.0 runtimes; the decoder normalizes it to zero. */
  readonly protocolVersion?: number;
  readonly capabilities: string[];
}

export const RUST_RUNTIME_RELEASE_VERSION = "0.2.0";
export const RUST_RUNTIME_PROTOCOL_VERSION = 1;

export interface RustRuntimeContractExpectation {
  readonly releaseVersion: string;
  readonly protocolVersion: number;
}

export type RustRuntimeContractValidation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "runtime-version-mismatch" | "protocol-version-mismatch";
      readonly expected: RustRuntimeContractExpectation;
      readonly actual: { readonly runtimeVersion: string; readonly protocolVersion: number };
    };

/** Pure exact-match validation for the Rust runtime identity contract. */
export function validateRustRuntimeContract(
  probe: Pick<RustProbeResult, "runtimeVersion" | "protocolVersion">,
  expected: RustRuntimeContractExpectation
): RustRuntimeContractValidation {
  const actual = {
    runtimeVersion: probe.runtimeVersion,
    protocolVersion: probe.protocolVersion ?? 0,
  };
  if (actual.runtimeVersion !== expected.releaseVersion) {
    return { ok: false, reason: "runtime-version-mismatch", expected, actual };
  }
  if (actual.protocolVersion !== expected.protocolVersion) {
    return { ok: false, reason: "protocol-version-mismatch", expected, actual };
  }
  return { ok: true };
}

export interface DoctorOptions {
  readonly providerId: string;
  readonly rustBinaryPath?: string;
  readonly sessionDir: string;
  /** Shared config file to inspect; defaults to ~/.dev-agent/config.json. */
  readonly configPath?: string;
  readonly projectState?: boolean;
  readonly configSource?: DoctorConfigSource;
  readonly runtimeSource?: DoctorRuntimeSelection["source"];
  readonly managedRuntimeVersion?: string;
  readonly managedRuntimeStatus?: Promise<DoctorManagedRuntimeStatus>;
  readonly env?: NodeJS.ProcessEnv;
  readonly nodeVersion?: string;
  /** Injectable for tests: returns the version banner, or undefined when missing. */
  readonly commandVersion?: (command: string) => Promise<string | undefined>;
  /** Add a bounded npm registry check for the installed CLI version. */
  readonly checkUpdate?: boolean;
  readonly cliVersion?: string;
  /** Injectable for tests: returns the published CLI version, or undefined on failure. */
  readonly latestCliVersion?: () => Promise<string | undefined>;
  readonly probeRust?: (path: string) => Promise<RustProbeResult>;
}

const MIN_NODE_MAJOR = 20;
const MAX_CONFIG_FILE_BYTES = 1024 * 1024; // 1 MiB
const CLI_LATEST_URL = "https://registry.npmjs.org/@agent_cli%2fcli/latest";
const MAX_UPDATE_RESPONSE_BYTES = 64 * 1024;
const MAX_COMMAND_VERSION_BYTES = 64 * 1024;
const MAX_RUST_PROBE_STDERR_BYTES = 16 * 1024;
const UPDATE_CHECK_TIMEOUT_MS = 5000;

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const commandVersion = options.commandVersion ?? defaultCommandVersion;
  const executorMode = resolveExecutorMode(options.rustBinaryPath);
  const checks: DoctorCheck[] = [];

  const nodeVersion = options.nodeVersion ?? process.version;
  const nodeMajor = Number.parseInt(nodeVersion.replace(/^v/, ""), 10);
  checks.push(
    nodeMajor >= MIN_NODE_MAJOR
      ? { name: "node", status: "ok", detail: `${nodeVersion} (>= ${MIN_NODE_MAJOR} required)` }
      : {
          name: "node",
          status: "fail",
          detail: `${nodeVersion} is older than ${MIN_NODE_MAJOR}`,
        }
  );

  const ripgrep = await commandVersion("rg");
  checks.push(
    ripgrep
      ? { name: "ripgrep", status: "ok", detail: ripgrep }
      : {
          name: "ripgrep",
          status: "fail",
          detail: "rg not found; the search tool shells out to it",
        }
  );

  const protoc = await commandVersion("protoc");
  checks.push(
    protoc
      ? { name: "protoc", status: "ok", detail: protoc }
      : {
          name: "protoc",
          status: "warn",
          detail: "not found; only needed to build runtime/rust",
        }
  );

  const runtimeCheck = await checkRustRuntime(options);
  checks.push(runtimeCheck.check);
  checks.push(checkProvider(options.providerId, env));
  checks.push(
    await checkConfig(options.configPath ?? join(homedir(), ".dev-agent", "config.json"))
  );
  checks.push(await checkSessionDir(options.sessionDir));
  if (options.checkUpdate === true) {
    checks.push(
      await checkCliUpdate(
        options.cliVersion,
        options.latestCliVersion ?? fetchLatestCliVersion
      )
    );
  }

  const summary = { ok: 0, warn: 0, fail: 0 };
  for (const check of checks) {
    summary[check.status] += 1;
  }
  let runtimeVersion: string | undefined;
  let protocolVersion: number | undefined;
  let target: string | undefined;
  let state: DoctorRuntimeSelection["state"];
  let missingReason: string | undefined;
  if (runtimeCheck.probe?.runtimeVersion) {
    runtimeVersion = runtimeCheck.probe.runtimeVersion;
    protocolVersion = runtimeCheck.probe.protocolVersion ?? 0;
    if (options.managedRuntimeStatus) {
      try {
        const managed = await options.managedRuntimeStatus;
        target = managed.target;
        state = managed.state;
      } catch (error) {
        state = "corrupt";
        missingReason = `runtime_status_unavailable (${doctorErrorCode(error)})`;
      }
    }
  } else if (options.managedRuntimeStatus) {
    try {
      const managed = await options.managedRuntimeStatus;
      if (managed.state === "installed") {
        runtimeVersion = managed.version || options.managedRuntimeVersion;
        protocolVersion = RUST_RUNTIME_PROTOCOL_VERSION;
      }
      target = managed.target;
      state = managed.state;
      const reason = managedMissingReason(managed);
      missingReason = reason;
    } catch (error) {
      state = "corrupt";
      missingReason = `runtime_status_unavailable (${doctorErrorCode(error)})`;
    }
  }
  const runtime: DoctorRuntimeSelection = {
    source: options.runtimeSource ?? (options.rustBinaryPath ? "explicit-path" : "default-local"),
    configured: options.rustBinaryPath !== undefined,
    selectedMode: executorMode,
    ...(runtimeVersion === undefined ? {} : { runtimeVersion }),
    ...(protocolVersion === undefined ? {} : { protocolVersion }),
    ...(target === undefined ? {} : { target }),
    ...(state === undefined ? {} : { state }),
    ...(missingReason === undefined ? {} : { missingReason }),
  };
  const scope: DoctorScope = {
    workingDirectoryScope: "final-cwd",
    projectState: options.projectState === true,
    configSource: options.configSource ?? "user",
  };
  return { executorMode, scope, runtime, checks, summary };
}

async function checkCliUpdate(
  currentVersion: string | undefined,
  getLatestVersion: () => Promise<string | undefined>
): Promise<DoctorCheck> {
  const current = currentVersion === undefined ? undefined : parseCliVersion(currentVersion);
  if (current === undefined) {
    return {
      name: "cli update",
      status: "warn",
      detail: "current CLI version unavailable; the update check was skipped",
    };
  }

  let latestText: string | undefined;
  try {
    latestText = await getLatestVersion();
  } catch {
    latestText = undefined;
  }
  const latest = latestText === undefined ? undefined : parseCliVersion(latestText);
  if (latest === undefined) {
    return {
      name: "cli update",
      status: "warn",
      detail: "latest version unavailable; the update check was skipped",
    };
  }

  const comparison = compareCliVersions(current, latest);
  if (comparison >= 0) {
    return {
      name: "cli update",
      status: "ok",
      detail: `up to date: ${current.raw}`,
    };
  }
  return {
    name: "cli update",
    status: "warn",
    detail: `update available: current ${current.raw}, latest ${latest.raw}`,
  };
}

interface ParsedCliVersion {
  readonly raw: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (number | string)[];
}

function parseCliVersion(value: string): ParsedCliVersion | undefined {
  const raw = value.trim();
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw);
  if (!match) {
    return undefined;
  }
  const prerelease =
    match[4] === undefined
      ? []
      : match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return {
    raw,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

function compareCliVersions(left: ParsedCliVersion, right: ParsedCliVersion): number {
  for (const [leftPart, rightPart] of [
    [left.major, right.major],
    [left.minor, right.minor],
    [left.patch, right.patch],
  ] as const) {
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "string") return -1;
    if (typeof leftPart === "string" && typeof rightPart === "number") return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

async function fetchLatestCliVersion(): Promise<string | undefined> {
  if (typeof fetch !== "function") {
    return undefined;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch(CLI_LATEST_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return undefined;
    }
    const body = await readBoundedResponse(response);
    if (body === undefined) {
      return undefined;
    }
    const parsed = JSON.parse(body) as { version?: unknown };
    return typeof parsed.version === "string" && parseCliVersion(parsed.version)
      ? parsed.version
      : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedResponse(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return undefined;
  }
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        text += decoder.decode();
        return text;
      }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_UPDATE_RESPONSE_BYTES) {
        await reader.cancel();
        return undefined;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

export function printDoctorReport(report: DoctorReport): void {
  console.log(`executor mode: ${safeDoctorText(report.executorMode)}`);
  if (report.scope !== undefined) {
    console.log(
      `scope: ${safeDoctorText(report.scope.workingDirectoryScope)} project-state=${String(report.scope.projectState)} config=${safeDoctorText(report.scope.configSource)}`
    );
  }
  if (report.runtime !== undefined) {
    const runtimeFacts = [
      `source=${safeDoctorText(report.runtime.source)}`,
      `configured=${String(report.runtime.configured)}`,
      `mode=${safeDoctorText(report.runtime.selectedMode)}`,
      ...(report.runtime.runtimeVersion === undefined
        ? []
        : [`version=${safeDoctorText(report.runtime.runtimeVersion)}`]),
      ...(report.runtime.protocolVersion === undefined
        ? []
        : [`protocol=${String(report.runtime.protocolVersion)}`]),
      ...(report.runtime.target === undefined
        ? []
        : [`target=${safeDoctorText(report.runtime.target)}`]),
      ...(report.runtime.state === undefined
        ? []
        : [`state=${safeDoctorText(report.runtime.state)}`]),
      ...(report.runtime.missingReason === undefined
        ? []
        : [`missing-reason=${safeDoctorText(report.runtime.missingReason)}`]),
    ];
    console.log(`runtime: ${runtimeFacts.join(" ")}`);
  }
  for (const check of report.checks) {
    console.log(
      `${safeDoctorText(check.status).padEnd(4)} ${safeDoctorText(check.name).padEnd(13)} ${safeDoctorText(check.detail)}`
    );
  }
  const { ok, warn, fail } = report.summary;
  console.log("");
  console.log(`${report.checks.length} checks: ${ok} ok, ${warn} warn, ${fail} fail`);
}

function safeDoctorText(value: unknown): string {
  return redactSensitiveText(sanitizeTerminalText(String(value)));
}

const CONFIG_SECTIONS = [
  "defaultProvider",
  "defaultModel",
  "maxTurns",
  "maxContextChars",
  "summarizeContext",
  "summaryMaxChars",
  "approvalMode",
  "approval",
  "mcpServers",
  "pricing",
] as const;

/**
 * Every reader silently ignores a broken config, so doctor is the one place
 * that says so instead of letting the file look active.
 */
async function checkConfig(path: string): Promise<DoctorCheck> {
  let raw: string;
  try {
    if ((await stat(path)).size > MAX_CONFIG_FILE_BYTES) {
      return {
        name: "config",
        status: "warn",
        detail: "config file exceeds the 1 MiB read limit; the file is ignored",
      };
    }
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { name: "config", status: "ok", detail: "config file not found; defaults are used" };
    }
    return {
      name: "config",
      status: "warn",
      detail: `config file could not be read (${doctorErrorCode(error)})`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      name: "config",
      status: "warn",
      detail: "config file is not valid JSON; the file is ignored",
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      name: "config",
      status: "warn",
      detail: "config file must contain a JSON object; the file is ignored",
    };
  }

  const record = parsed as Record<string, unknown>;
  const known = CONFIG_SECTIONS.filter((key) => record[key] !== undefined);
  const summary =
    known.length > 0
      ? `${known.length} recognised section${known.length === 1 ? "" : "s"} (${known.join(", ")})`
      : "no recognised sections";
  return { name: "config", status: "ok", detail: `config file (${summary})` };
}

interface DoctorRuntimeCheck {
  readonly check: DoctorCheck;
  readonly probe?: RustProbeResult;
}

async function checkRustRuntime(options: DoctorOptions): Promise<DoctorRuntimeCheck> {
  if (!options.rustBinaryPath) {
    return {
      check: {
        name: "rust runtime",
        status: "warn",
        detail: "not configured; tools run through LocalExecutor without the sandbox",
      },
    };
  }
  if (!existsSync(options.rustBinaryPath)) {
    return {
      check: {
        name: "rust runtime",
        status: "fail",
        detail: "configured binary not found",
      },
    };
  }

  try {
    const probe = await (options.probeRust ?? probeRustBinary)(options.rustBinaryPath);
    const validation = validateRustRuntimeContract(probe, {
      releaseVersion: RUST_RUNTIME_RELEASE_VERSION,
      protocolVersion: RUST_RUNTIME_PROTOCOL_VERSION,
    });
    const protocolVersion = probe.protocolVersion ?? 0;
    if (!validation.ok) {
      return {
        check: {
          name: "rust runtime",
          status: "fail",
          detail: `unsupported runtime contract (version ${probe.runtimeVersion}, protocol version ${protocolVersion}; expected ${validation.expected.releaseVersion}, protocol version ${validation.expected.protocolVersion})`,
        },
        probe,
      };
    }
    return {
      check: {
        name: "rust runtime",
        status: "ok",
        detail: `available (version ${probe.runtimeVersion}, protocol version ${protocolVersion}, capabilities: ${probe.capabilities.join(", ")})`,
      },
      probe,
    };
  } catch (error) {
    return {
      check: {
        name: "rust runtime",
        status: "fail",
        detail: `health check failed (${doctorErrorCode(error)})`,
      },
    };
  }
}

function managedMissingReason(status: DoctorManagedRuntimeStatus): string | undefined {
  if (status.state === "missing") return "runtime_not_installed";
  if (status.state === "unsupported") return status.reason ? status.reason : "unsupported_platform";
  if (status.state === "corrupt") return status.reason ? `runtime_corrupt: ${status.reason}` : "runtime_corrupt";
  return undefined;
}

function checkProvider(providerId: string, env: NodeJS.ProcessEnv): DoctorCheck {
  const keysByProvider: Record<string, readonly string[]> = {
    ollama: [],
    openai: ["OPENAI_API_KEY", "DEV_AGENT_OPENAI_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY", "DEV_AGENT_ANTHROPIC_API_KEY"],
    gemini: ["GEMINI_API_KEY", "DEV_AGENT_GEMINI_API_KEY"],
  };

  const keys = keysByProvider[providerId];
  if (!keys) {
    return {
      name: "provider",
      status: "fail",
      detail: `unsupported provider '${providerId}'`,
    };
  }
  if (keys.length === 0) {
    return { name: "provider", status: "ok", detail: `${providerId} (no API key required)` };
  }

  const present = keys.find((key) => env[key]);
  return present
    ? { name: "provider", status: "ok", detail: `${providerId} (${present} set)` }
    : {
        name: "provider",
        status: "fail",
        detail: `${providerId} needs one of: ${keys.join(", ")}`,
      };
}

async function checkSessionDir(dir: string): Promise<DoctorCheck> {
  const probe = join(dir, ".doctor-probe");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, "ok", "utf8");
    await rm(probe, { force: true });
    return { name: "sessions", status: "ok", detail: "session directory (writable)" };
  } catch (error) {
    return {
      name: "sessions",
      status: "fail",
      detail: `session directory is not writable (${doctorErrorCode(error)})`,
    };
  }
}

function doctorErrorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : "unknown error";
}

function defaultCommandVersion(command: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = Buffer.alloc(0);
    let oversized = false;
    child.stdout.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (output.length + bytes.length > MAX_COMMAND_VERSION_BYTES) {
        oversized = true;
        child.kill();
        return;
      }
      output = Buffer.concat([output, bytes]);
    });
    child.stderr.resume();
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      if (oversized) {
        resolve(undefined);
        return;
      }
      const firstLine = output.toString("utf8").split("\n")[0]?.trim();
      resolve(code === 0 && firstLine ? firstLine : undefined);
    });
  });
}

/** Sends a HealthCheck envelope to the runtime and decodes the answer. */
export function probeRustBinary(path: string): Promise<RustProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, { stdio: ["pipe", "pipe", "pipe"] });
    const maxFrameBytes = DEFAULT_RUST_EXECUTOR_MAX_FRAME_BYTES;
    const maxOutputBytes = maxFrameBytes + 4;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let oversized = false;
    let frameLengthChecked = false;

    const stopForOversizedResponse = (): void => {
      if (oversized) {
        return;
      }
      oversized = true;
      child.kill();
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      if (oversized) {
        return;
      }
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stdoutBytes + bytes.length > maxOutputBytes) {
        stopForOversizedResponse();
        return;
      }
      stdoutChunks.push(bytes);
      stdoutBytes += bytes.length;
      if (!frameLengthChecked && stdoutBytes >= 4) {
        frameLengthChecked = true;
        const prefix = Buffer.concat(stdoutChunks, stdoutBytes);
        if (prefix.readUInt32BE(0) > maxFrameBytes) {
          stopForOversizedResponse();
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      if (stderrBytes >= MAX_RUST_PROBE_STDERR_BYTES) {
        return;
      }
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = MAX_RUST_PROBE_STDERR_BYTES - stderrBytes;
      const bounded = bytes.subarray(0, remaining);
      stderrChunks.push(bounded);
      stderrBytes += bounded.length;
    });
    child.on("error", (error) => {
      if (!oversized) {
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (oversized) {
        reject(
          new Error(
            `Rust executor response exceeds the ${maxFrameBytes} byte frame limit`
          )
        );
        return;
      }
      const stdout = Buffer.concat(stdoutChunks, stdoutBytes);
      const stderr = Buffer.concat(stderrChunks, stderrBytes).toString("utf8");
      if (code !== 0) {
        reject(new Error(`Rust executor exited with code ${code}: ${stderr}`));
        return;
      }
      if (stdout.length < 4) {
        reject(new Error("Rust executor returned no response"));
        return;
      }
      const length = stdout.readUInt32BE(0);
      const payload = stdout.subarray(4, 4 + length);
      try {
        const healthCheck = decodeHealthCheckResponse(payload);
        if (!healthCheck) {
          reject(new Error("Rust executor returned an unexpected response"));
          return;
        }
        resolve(healthCheck);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    // HealthCheck envelope: request_id=1, health_check=4.
    const envelope = [0x08, 0x01, 0x22, 0x00];
    const frame = Buffer.alloc(4 + envelope.length);
    frame.writeUInt32BE(envelope.length, 0);
    Buffer.from(envelope).copy(frame, 4);
    child.stdin.write(frame);
    child.stdin.end();
  });
}

function readProtobufVarint(
  buffer: Buffer,
  offset: number
): { readonly value: number; readonly offset: number } {
  let value = 0;
  let shift = 0;
  while (offset < buffer.length) {
    const byte = buffer.readUInt8(offset);
    offset += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value, offset };
    }
    shift += 7;
  }
  throw new Error("malformed protobuf varint");
}

function decodeLengthDelimited(
  buffer: Buffer,
  offset: number
): { readonly data: Buffer; readonly offset: number } {
  const length = readProtobufVarint(buffer, offset);
  const end = length.offset + length.value;
  if (end > buffer.length) {
    throw new Error("malformed protobuf length-delimited field");
  }
  return {
    data: buffer.subarray(length.offset, end),
    offset: end,
  };
}

function decodeHealthCheckResult(data: Buffer): RustProbeResult {
  let offset = 0;
  let version = "";
  let protocolVersion = 0;
  const capabilities: string[] = [];
  while (offset < data.length) {
    const tag = readProtobufVarint(data, offset);
    offset = tag.offset;
    const field = tag.value >>> 3;
    const wireType = tag.value & 0x07;
    if (wireType === 0) {
      const value = readProtobufVarint(data, offset);
      offset = value.offset;
      if (field === 3) {
        protocolVersion = value.value;
      }
      continue;
    }
    if (wireType !== 2) {
      offset = readProtobufVarint(data, offset).offset;
      continue;
    }
    const fieldData = decodeLengthDelimited(data, offset);
    offset = fieldData.offset;
    if (field === 1) {
      version = fieldData.data.toString("utf8");
    } else if (field === 2) {
      capabilities.push(fieldData.data.toString("utf8"));
    }
  }
  return { runtimeVersion: version, protocolVersion, capabilities };
}

function decodeErrorResult(data: Buffer): string {
  let offset = 0;
  let message = "";
  let code = "";
  while (offset < data.length) {
    const tag = readProtobufVarint(data, offset);
    offset = tag.offset;
    const field = tag.value >>> 3;
    const wireType = tag.value & 0x07;
    if (wireType !== 2) {
      offset = readProtobufVarint(data, offset).offset;
      continue;
    }
    const fieldData = decodeLengthDelimited(data, offset);
    offset = fieldData.offset;
    if (field === 1) {
      message = fieldData.data.toString("utf8");
    } else if (field === 2) {
      code = fieldData.data.toString("utf8");
    }
  }
  return `${code}: ${message}`;
}

function decodeHealthCheckResponse(payload: Buffer): RustProbeResult | undefined {
  let offset = 0;
  let healthCheckData: Buffer | undefined;
  while (offset < payload.length) {
    const tag = readProtobufVarint(payload, offset);
    offset = tag.offset;
    const field = tag.value >>> 3;
    const wireType = tag.value & 0x07;
    if (wireType === 0) {
      offset = readProtobufVarint(payload, offset).offset;
      continue;
    }
    if (wireType !== 2) {
      return undefined;
    }
    const fieldData = decodeLengthDelimited(payload, offset);
    offset = fieldData.offset;
    if (field === 3) {
      healthCheckData = fieldData.data;
    } else if (field === 4) {
      throw new Error(`Rust executor returned an error: ${decodeErrorResult(fieldData.data)}`);
    }
  }
  return healthCheckData ? decodeHealthCheckResult(healthCheckData) : undefined;
}
