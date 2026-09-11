import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorStatus;
  readonly detail: string;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly summary: { readonly ok: number; readonly warn: number; readonly fail: number };
}

export interface RustProbeResult {
  readonly runtimeVersion: string;
  readonly capabilities: string[];
}

export interface DoctorOptions {
  readonly providerId: string;
  readonly rustBinaryPath?: string;
  readonly sessionDir: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly nodeVersion?: string;
  /** Injectable for tests: returns the version banner, or undefined when missing. */
  readonly commandVersion?: (command: string) => Promise<string | undefined>;
  readonly probeRust?: (path: string) => Promise<RustProbeResult>;
}

const MIN_NODE_MAJOR = 20;

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const commandVersion = options.commandVersion ?? defaultCommandVersion;
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

  checks.push(await checkRustRuntime(options));
  checks.push(checkProvider(options.providerId, env));
  checks.push(await checkSessionDir(options.sessionDir));

  const summary = { ok: 0, warn: 0, fail: 0 };
  for (const check of checks) {
    summary[check.status] += 1;
  }
  return { checks, summary };
}

export function printDoctorReport(report: DoctorReport): void {
  for (const check of report.checks) {
    console.log(`${check.status.padEnd(4)} ${check.name.padEnd(13)} ${check.detail}`);
  }
  const { ok, warn, fail } = report.summary;
  console.log("");
  console.log(`${report.checks.length} checks: ${ok} ok, ${warn} warn, ${fail} fail`);
}

async function checkRustRuntime(options: DoctorOptions): Promise<DoctorCheck> {
  if (!options.rustBinaryPath) {
    return {
      name: "rust runtime",
      status: "warn",
      detail: "not configured; tools run through LocalExecutor without the sandbox",
    };
  }
  if (!existsSync(options.rustBinaryPath)) {
    return {
      name: "rust runtime",
      status: "fail",
      detail: `${options.rustBinaryPath} not found`,
    };
  }

  try {
    const probe = await (options.probeRust ?? probeRustBinary)(options.rustBinaryPath);
    return {
      name: "rust runtime",
      status: "ok",
      detail: `${options.rustBinaryPath} (version ${probe.runtimeVersion}, capabilities: ${probe.capabilities.join(", ")})`,
    };
  } catch (error) {
    return {
      name: "rust runtime",
      status: "fail",
      detail: `health check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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
    return { name: "sessions", status: "ok", detail: `${dir} (writable)` };
  } catch (error) {
    return {
      name: "sessions",
      status: "fail",
      detail: `${dir} is not writable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function defaultCommandVersion(command: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      const firstLine = output.split("\n")[0]?.trim();
      resolve(code === 0 && firstLine ? firstLine : undefined);
    });
  });
}

/** Sends a HealthCheck envelope to the runtime and decodes the answer. */
export function probeRustBinary(path: string): Promise<RustProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
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
  const capabilities: string[] = [];
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
      version = fieldData.data.toString("utf8");
    } else if (field === 2) {
      capabilities.push(fieldData.data.toString("utf8"));
    }
  }
  return { runtimeVersion: version, capabilities };
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
