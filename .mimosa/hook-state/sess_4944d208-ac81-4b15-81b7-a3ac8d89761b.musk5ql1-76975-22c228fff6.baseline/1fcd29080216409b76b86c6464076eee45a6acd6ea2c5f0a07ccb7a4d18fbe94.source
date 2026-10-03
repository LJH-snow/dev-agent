// Self-test for the mock executor binary's protobuf wire format implementation.
// Validates that the mock binary correctly encodes and decodes the executor
// protocol messages, which is a prerequisite for the TS↔Rust boundary to work.

// Validates that the mock binary correctly encodes and decodes the executor
// protocol messages, which is a prerequisite for the TS↔Rust boundary to work.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = fileURLToPath(new URL(".", import.meta.url));
const mockBinary = join(here, "..", "tests", "mock-executor-binary.mjs");

function encodeVarint(value) {
  const bytes = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v & 0x7f);
  return bytes;
}

function encodeRunRequest({
  command = "",
  args = [],
  cwd,
  env = {} as Record<string, string>,
  input,
  timeoutMs,
  maxOutputBytes,
}) {
  const bytes = [];
  // command (field 1, string)
  const cmdBytes = Buffer.from(command, "utf8");
  bytes.push(0x0a, cmdBytes.length, ...cmdBytes);
  // args (field 2, repeated string)
  for (const arg of args) {
    const argBytes = Buffer.from(arg, "utf8");
    bytes.push(0x12, argBytes.length, ...argBytes);
  }
  // cwd (field 3, string)
  if (cwd) {
    const cwdBytes = Buffer.from(cwd, "utf8");
    bytes.push(0x1a, cwdBytes.length, ...cwdBytes);
  }
  // env (field 4, map<string,string>) — tag = (4 << 3) | 2 = 0x22
  for (const [k, v] of Object.entries(env)) {
    const keyBytes = Buffer.from(k, "utf8");
    const valBytes = Buffer.from(v, "utf8");
    const entry = [0x0a, keyBytes.length, ...keyBytes, 0x12, valBytes.length, ...valBytes];
    bytes.push(0x22, entry.length, ...entry);
  }
  // input (field 5, string) — tag = (5 << 3) | 2 = 0x2a
  if (input) {
    const inBytes = Buffer.from(input, "utf8");
    bytes.push(0x2a, inBytes.length, ...inBytes);
  }
  // timeoutMs (field 6, varint) — tag = (6 << 3) | 0 = 0x30
  if (timeoutMs) {
    bytes.push(0x30, ...encodeVarint(timeoutMs));
  }
  // maxOutputBytes (field 7, varint) — tag = (7 << 3) | 0 = 0x38
  if (maxOutputBytes) {
    bytes.push(0x38, ...encodeVarint(maxOutputBytes));
  }
  return bytes;
}

function encodeEnvelope({
  requestId,
  run,
  runSandboxed,
  healthCheck,
}: { requestId?: any; run?: any; runSandboxed?: any; healthCheck?: any }) {
  const bytes = [];
  // requestId (field 1, varint)
  if (requestId !== undefined) bytes.push(0x08, requestId);
  // run (field 2, embedded)
  if (run) {
    const runBytes = encodeRunRequest(run);
    bytes.push(0x12, runBytes.length, ...runBytes);
  }
  // runSandboxed (field 3, embedded)
  if (runSandboxed) {
    const runBytes = encodeRunRequest(runSandboxed.run ?? {});
    const profileBytes = encodeSandboxProfile(runSandboxed.profile ?? {});
    const inner = [0x0a, runBytes.length, ...runBytes, 0x12, profileBytes.length, ...profileBytes];
    bytes.push(0x1a, inner.length, ...inner);
  }
  // healthCheck (field 4, empty embedded)
  if (healthCheck !== undefined) {
    bytes.push(0x22, 0x00);
  }
  return bytes;
}

function encodeSandboxProfile({
  name = "",
  network = 0,
  writablePaths = [],
  readonlyPaths = [],
  environment = {} as Record<string, string>,
  timeoutMs,
  policyScript,
}) {
  const bytes = [];
  if (name) {
    const b = Buffer.from(name, "utf8");
    bytes.push(0x0a, b.length, ...b);
  }
  if (network) bytes.push(0x10, network);
  for (const p of writablePaths) {
    const b = Buffer.from(p, "utf8");
    bytes.push(0x1a, b.length, ...b);
  }
  for (const p of readonlyPaths) {
    const b = Buffer.from(p, "utf8");
    bytes.push(0x22, b.length, ...b);
  }
  for (const [k, v] of Object.entries(environment)) {
    const keyBytes = Buffer.from(k, "utf8");
    const valBytes = Buffer.from(v, "utf8");
    const entry = [0x0a, keyBytes.length, ...keyBytes, 0x12, valBytes.length, ...valBytes];
    bytes.push(0x2a, entry.length, ...entry);
  }
  if (timeoutMs) bytes.push(0x30, timeoutMs);
  if (policyScript) {
    const b = Buffer.from(policyScript, "utf8");
    bytes.push(0x3a, b.length, ...b);
  }
  return bytes;
}

function decodeResponse(buf) {
  const result: any = {};
  let offset = 0;
  while (offset < buf.length) {
    const tag = buf[offset++];
    const field = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
      // varint
      let value = 0;
      let shift = 0;
      while (offset < buf.length) {
        const byte = buf[offset++];
        value |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      if (field === 1) result.requestId = value;
    } else if (wireType === 2) {
      // length-delimited
      let len = 0;
      let shift = 0;
      while (offset < buf.length) {
        const byte = buf[offset++];
        len |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      const data = buf.subarray(offset, offset + len);
      offset += len;
      if (field === 2) {
        // runResult
        result.runResult = decodeRunResult(data);
      } else if (field === 3) {
        // healthCheckResult
        result.healthCheckResult = decodeHealthCheck(data);
      } else if (field === 4) {
        // error
        result.error = decodeError(data);
      }
    }
  }
  return result;
}

function decodeRunResult(buf) {
  const result: any = {};
  let offset = 0;
  while (offset < buf.length) {
    const tag = buf[offset++];
    const field = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      let len = 0;
      let shift = 0;
      while (offset < buf.length) {
        const byte = buf[offset++];
        len |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      const data = buf.subarray(offset, offset + len);
      offset += len;
      if (field === 1) result.stdout = data.toString("utf8");
      else if (field === 2) result.stderr = data.toString("utf8");
    } else if (wireType === 0) {
      let value = 0;
      let shift = 0;
      while (offset < buf.length) {
        const byte = buf[offset++];
        value |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      if (field === 3) result.exitCode = value;
      else if (field === 4) result.timedOut = value === 1;
      else if (field === 5) result.bytesTruncated = value === 1;
    }
  }
  return result;
}

function decodeHealthCheck(buf) {
  const result: any = {};
  let offset = 0;
  while (offset < buf.length) {
    const tag = buf[offset++];
    const field = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      let len = 0;
      let shift = 0;
      while (offset < buf.length) {
        const byte = buf[offset++];
        len |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      const data = buf.subarray(offset, offset + len);
      offset += len;
      if (field === 1) result.runtimeVersion = data.toString("utf8");
      else if (field === 2) result.capabilities = (result.capabilities ?? []).concat(data.toString("utf8"));
    }
  }
  return result;
}

function decodeError(buf) {
  const result: any = {};
  let offset = 0;
  while (offset < buf.length) {
    const tag = buf[offset++];
    const field = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      let len = 0;
      let shift = 0;
      while (offset < buf.length) {
        const byte = buf[offset++];
        len |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      const data = buf.subarray(offset, offset + len);
      offset += len;
      if (field === 1) result.message = data.toString("utf8");
      else if (field === 2) result.code = data.toString("utf8");
    }
  }
  return result;
}

function sendAndReceive(envelopeBytes, behavior = "default"): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [mockBinary], {
      env: { ...process.env, MOCK_EXECUTOR_BEHAVIOR: behavior ?? "default" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    child.stdout.on("data", (chunk) => { stdout = Buffer.concat([stdout, chunk]); });
    child.on("close", () => {
      if (stdout.length < 4) return reject(new Error("no response"));
      const len = stdout.readUInt32BE(0);
      resolve(decodeResponse(stdout.subarray(4, 4 + len)));
    });
    const frame = Buffer.alloc(4 + envelopeBytes.length);
    frame.writeUInt32BE(envelopeBytes.length, 0);
    Buffer.from(envelopeBytes).copy(frame, 4);
    child.stdin.write(frame);
    child.stdin.end();
  });
}

test("mock binary echoes back a RunResult for a simple command", async () => {
  const env = encodeEnvelope({ requestId: 1, run: { command: "echo", args: ["hello"] } });
  const response = await sendAndReceive(env);
  assert.equal(response.requestId, 1);
  assert.equal(response.runResult?.stdout, "mock:echo");
  assert.equal(response.runResult?.stderr, "");
  // exitCode 0 is the protobuf default, so it may be omitted from the wire.
  assert.ok(response.runResult?.exitCode === 0 || response.runResult?.exitCode === undefined);
});

test("mock binary reflects the full RunRequest payload", async () => {
  const env = encodeEnvelope({
    requestId: 42,
    run: {
      command: "build",
      args: ["--release"],
      cwd: "/workspace",
      env: { CI: "1" },
      input: "data",
      timeoutMs: 30,
      maxOutputBytes: 4096,
    },
  });
  const response = await sendAndReceive(env, "reflect");
  assert.equal(response.requestId, 42);
  const parsed = JSON.parse(response.runResult?.stdout ?? "{}");
  assert.equal(parsed.command, "build");
  assert.deepEqual(parsed.args, ["--release"]);
  assert.equal(parsed.cwd, "/workspace");
  assert.equal(parsed.env.CI, "1");
  assert.equal(parsed.input, "data");
  assert.equal(parsed.timeoutMs, 30);
  assert.equal(parsed.maxOutputBytes, 4096);
});

test("mock binary reports truncated output when asked to", async () => {
  const env = encodeEnvelope({ requestId: 3, run: { command: "yes", maxOutputBytes: 1024 } });
  const response = await sendAndReceive(env, "truncate");
  assert.equal(response.runResult?.bytesTruncated, true);
  assert.equal(response.runResult?.stdout, "partial-output");
});

test("mock binary returns an error for error behavior", async () => {
  const env = encodeEnvelope({ requestId: 7, run: { command: "fail" } });
  const response = await sendAndReceive(env, "error:EXECUTOR_ERROR");
  assert.equal(response.requestId, 7);
  assert.equal(response.error?.code, "EXECUTOR_ERROR");
  assert.match(response.error?.message, /mock error/);
});

test("mock binary handles sandboxed requests", async () => {
  const env = encodeEnvelope({
    requestId: 99,
    runSandboxed: {
      run: { command: "cargo", args: ["build"] },
      profile: {
        name: "ci",
        network: 2,
        writablePaths: ["/workspace"],
        readonlyPaths: ["/etc"],
        environment: { CI: "1" },
        timeoutMs: 30000,
        policyScript: "allow_read('/etc')",
      },
    },
  });
  const response = await sendAndReceive(env);
  assert.equal(response.requestId, 99);
  assert.equal(response.runResult?.stdout, "sandboxed:cargo");
});

test("mock binary responds to health check", async () => {
  const env = encodeEnvelope({ requestId: 0, healthCheck: {} });
  const response = await sendAndReceive(env);
  assert.equal(response.healthCheckResult?.runtimeVersion, "0.0.0-mock");
  assert.deepEqual(response.healthCheckResult?.capabilities, ["run", "run_sandboxed"]);
});
