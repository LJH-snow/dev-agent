import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as protobuf from "protobufjs";

type ProtobufModule = typeof protobuf;

import { DEFAULT_MAX_OUTPUT_BYTES } from "./local-executor.js";
import { ExecutorCancelledError } from "./errors.js";

// protobufjs is CommonJS; Node's ESM loader exposes its API on `default`.
const protobufImpl: ProtobufModule = (
  protobuf as unknown as { readonly default?: ProtobufModule }
).default ?? protobuf;

import type {
  Executor,
  ExecutorResult,
  ExecutorRunOptions,
  SandboxNetworkPolicy,
  SandboxExecutor,
  SandboxProfile,
} from "./index.js";

const PROTO_STATIC = `syntax = "proto3";
package dev_agent.executor;
message RunRequest {
  string command = 1;
  repeated string args = 2;
  optional string cwd = 3;
  map<string, string> env = 4;
  optional string input = 5;
  optional uint64 timeout_ms = 6;
  optional uint64 max_output_bytes = 7;
}
message RunResult {
  string stdout = 1;
  string stderr = 2;
  int32 exit_code = 3;
  bool timed_out = 4;
  bool bytes_truncated = 5;
}
message SandboxProfile {
  string name = 1;
  uint32 network = 2;
  repeated string writable_paths = 3;
  repeated string readonly_paths = 4;
  map<string, string> environment = 5;
  optional uint64 timeout_ms = 6;
  optional string policy_script = 7;
}
message RunSandboxedRequest {
  RunRequest run = 1;
  SandboxProfile profile = 2;
}
message HealthCheck {}
message HealthCheckResult {
  string runtime_version = 1;
  repeated string capabilities = 2;
}
message ErrorResult {
  string message = 1;
  string code = 2;
}
message Envelope {
  optional uint32 request_id = 1;
  oneof payload {
    RunRequest run = 2;
    RunSandboxedRequest run_sandboxed = 3;
    HealthCheck health_check = 4;
    CancelRequest cancel = 5;
  }
}
message CancelRequest {
  uint32 request_id = 1;
}
message Response {
  optional uint32 request_id = 1;
  oneof payload {
    RunResult run_result = 2;
    HealthCheckResult health_check_result = 3;
    ErrorResult error = 4;
  }
}`;

interface PendingRequest {
  readonly command: string;
  resolve(value: ExecutorResult): void;
  reject(reason: unknown): void;
}

export interface RustExecutorOptions {
  readonly binaryPath: string;
  readonly protoPath?: string;
  /** Requests allowed to run at once; further calls are rejected. Defaults to 5. */
  readonly maxConcurrentExecutions?: number;
}

const NETWORK_POLICY_MAP: Readonly<Record<SandboxNetworkPolicy, number>> = {
  enabled: 1,
  disabled: 2,
  loopback: 3,
};

const DEFAULT_MAX_CONCURRENT = 5;

export class RustExecutor implements SandboxExecutor {
  private readonly binaryPath: string;
  private readonly protoPath?: string;
  private readonly maxConcurrentExecutions: number;
  private child?: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private buffer = Buffer.alloc(0);
  private root?: protobuf.Root;
  private envelopeType?: protobuf.Type;
  private responseType?: protobuf.Type;
  private started = false;
  private startPromise?: Promise<void>;

  constructor(options: RustExecutorOptions) {
    if (!options.binaryPath.trim()) {
      throw new Error("RustExecutor binaryPath must be a non-empty string");
    }
    this.binaryPath = options.binaryPath;
    this.protoPath = options.protoPath;
    this.maxConcurrentExecutions = options.maxConcurrentExecutions ?? DEFAULT_MAX_CONCURRENT;
  }

  async run(
    command: string,
    args: readonly string[] = [],
    options: ExecutorRunOptions = {}
  ): Promise<ExecutorResult> {
    return this.runSandboxed(command, args, { ...options, profile: undefined });
  }

  async runSandboxed(
    command: string,
    args: readonly string[] = [],
    options: ExecutorRunOptions & { readonly profile?: SandboxProfile } = {}
  ): Promise<ExecutorResult> {
    await this.ensureStarted();

    if (this.pending.size >= this.maxConcurrentExecutions) {
      throw new Error(
        `Concurrent execution limit reached (${this.maxConcurrentExecutions}). Try again later.`
      );
    }

    const env: Record<string, string> = {};
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    const runRequest = {
      command,
      args: [...args],
      cwd: options.cwd,
      env,
      input: options.input,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    };
    const envelope = options.profile
      ? {
          requestId,
          runSandboxed: {
            run: runRequest,
            profile: this.encodeProfile(options.profile),
          },
        }
      : {
          requestId,
          run: runRequest,
        };

    return new Promise<ExecutorResult>((resolve, reject) => {
      const signal = options.signal;
      const onAbort = (): void => {
        // The runtime kills the child and answers with a CANCELLED error, so
        // the promise settles through the normal response path.
        this.writeCancel(requestId);
      };
      const cleanup = (): void => {
        signal?.removeEventListener("abort", onAbort);
      };

      this.pending.set(requestId, {
        command,
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (reason) => {
          cleanup();
          reject(reason);
        },
      });

      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      this.writeEnvelope(envelope);
    });
  }

  async dispose(): Promise<void> {
    if (!this.child) {
      this.started = false;
      this.startPromise = undefined;
      return;
    }
    const child = this.child;
    this.child = undefined;
    this.started = false;
    this.startPromise = undefined;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(() => {
        child.kill();
        resolve();
      }, 500);
    });
  }

  private ensureStarted(): Promise<void> {
    if (this.started) {
      return Promise.resolve();
    }
    // Two calls arriving together must not spawn two runtimes: the second
    // spawn would overwrite `this.child` and orphan the first process.
    this.startPromise ??= this.start().catch((error: unknown) => {
      this.startPromise = undefined;
      throw error;
    });
    return this.startPromise;
  }

  private async start(): Promise<void> {
    if (!existsSync(this.binaryPath)) {
      throw new Error(
        `Rust executor binary not found at ${this.binaryPath}. Build the runtime/rust crate first.`
      );
    }
    const root = await this.loadRoot();
    this.root = root;
    this.envelopeType = root.lookupType("dev_agent.executor.Envelope");
    this.responseType = root.lookupType("dev_agent.executor.Response");

    const child = spawn(this.binaryPath, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.handleData(chunk));
    child.stderr.setEncoding("utf8");
    child.on("error", (error) => this.rejectAll(error));
    child.on("exit", (code, signal) => {
      this.rejectAll(new Error(`Rust executor exited (code=${code} signal=${signal ?? "none"})`));
    });
    this.started = true;
  }

  private async loadRoot(): Promise<protobuf.Root> {
    if (this.root) {
      return this.root;
    }
    if (this.protoPath) {
      try {
        const content = await readFile(this.protoPath, "utf8");
        return protobufImpl.parse(content).root;
      } catch {
        // Fall back to the embedded proto.
      }
    }
    return protobufImpl.parse(PROTO_STATIC).root;
  }

  private encodeProfile(profile: SandboxProfile): Record<string, unknown> {
    return {
      name: profile.name,
      network: NETWORK_POLICY_MAP[profile.network ?? "enabled"] ?? 1,
      writablePaths: profile.writablePaths ?? [],
      readonlyPaths: profile.readonlyPaths ?? [],
      environment: profile.environment ?? {},
      timeoutMs: profile.timeoutMs,
      policyScript: profile.policyScript,
    };
  }

  private writeEnvelope(envelope: Record<string, unknown>): void {
    if (!this.child || !this.envelopeType) {
      return;
    }
    const message = this.envelopeType.create(envelope);
    const buffer = this.envelopeType.encode(message).finish();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(buffer.length, 0);
    this.child.stdin.write(header);
    this.child.stdin.write(buffer);
  }

  private writeCancel(targetRequestId: number): void {
    const envelopeId = this.nextRequestId;
    this.nextRequestId += 1;
    this.writeEnvelope({
      requestId: envelopeId,
      cancel: { requestId: targetRequestId },
    });
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 4) {
        break;
      }
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + length) {
        break;
      }
      const encoded = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      this.handleResponse(encoded);
    }
  }

  private handleResponse(encoded: Buffer): void {
    if (!this.responseType) {
      return;
    }
    const decoded = this.responseType.decode(encoded) as protobuf.Message<{
      requestId?: number;
      runResult?: {
        stdout: string;
        stderr: string;
        exitCode: number;
        timedOut: boolean;
        bytesTruncated?: boolean;
      };
      error?: { message: string; code: string };
    }>;
    const json = decoded.toJSON();
    const pending = json.requestId !== undefined ? this.pending.get(json.requestId) : undefined;
    if (!pending) {
      return;
    }
    this.pending.delete(json.requestId!);
    if (json.error) {
      if (json.error.code === "CANCELLED") {
        pending.reject(new ExecutorCancelledError(pending.command));
      } else {
        pending.reject(new Error(`${json.error.code}: ${json.error.message}`));
      }
      return;
    }
    if (json.runResult) {
      pending.resolve({
        stdout: json.runResult.stdout ?? "",
        stderr: json.runResult.stderr ?? "",
        exitCode: json.runResult.exitCode ?? 0,
        timedOut: json.runResult.timedOut ? true : undefined,
        bytesTruncated: json.runResult.bytesTruncated ? true : undefined,
      });
    }
  }

  private rejectAll(error: unknown): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
