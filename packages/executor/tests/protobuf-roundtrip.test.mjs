// Verifies that the TypeScript-side protobuf encoding logic produces bytes
// that the Rust-side (mock binary) can correctly decode, and vice versa.
//
// This test replicates the encoding logic from rust-executor.ts (without
// importing protobufjs) and the decoding logic from the mock binary,
// then verifies that requests and responses survive a round-trip through
// the length-prefixed stdio framing.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = fileURLToPath(new URL(".", import.meta.url));
const mockBinary = join(here, "mock-executor-binary.mjs");

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

function encodeTag(fieldNumber, wireType) {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeString(fieldNumber, str) {
  const strBytes = Buffer.from(str, "utf8");
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(strBytes.length), ...strBytes];
}

function encodeVarintField(fieldNumber, value) {
  if (value === 0 || value === false) return [];
  return [...encodeTag(fieldNumber, 0), ...encodeVarint(value)];
}

function encodeEmbedded(fieldNumber, encodedBytes) {
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(encodedBytes.length), ...encodedBytes];
}

function encodeRunRequest(req) {
  let bytes = [];
  if (req.command) bytes = bytes.concat(encodeString(1, req.command));
  for (const arg of req.args ?? []) {
    bytes = bytes.concat(encodeString(2, arg));
  }
  if (req.cwd) bytes = bytes.concat(encodeString(3, req.cwd));
  for (const [k, v] of Object.entries(req.env ?? {})) {
    const entry = [...encodeString(1, k), ...encodeString(2, v)];
    bytes = bytes.concat(encodeEmbedded(4, entry));
  }
  if (req.input) bytes = bytes.concat(encodeString(5, req.input));
  if (req.timeoutMs) bytes = bytes.concat(encodeVarintField(6, req.timeoutMs));
  if (req.maxOutputBytes) bytes = bytes.concat(encodeVarintField(7, req.maxOutputBytes));
  return bytes;
}

function encodeEnvelope(env) {
  let bytes = [];
  if (env.requestId) bytes = bytes.concat(encodeVarintField(1, env.requestId));
  if (env.run) {
    bytes = bytes.concat(encodeEmbedded(2, encodeRunRequest(env.run)));
  } else if (env.runSandboxed) {
    const runBytes = encodeRunRequest(env.runSandboxed.run ?? {});
    const profileBytes = encodeSandboxProfile(env.runSandboxed.profile ?? {});
    const inner = [...encodeEmbedded(1, runBytes), ...encodeEmbedded(2, profileBytes)];
    bytes = bytes.concat(encodeEmbedded(3, inner));
  } else if (env.healthCheck !== undefined) {
    bytes = bytes.concat(encodeEmbedded(4, []));
  }
  return bytes;
}

function encodeSandboxProfile(profile) {
  let bytes = [];
  if (profile.name) bytes = bytes.concat(encodeString(1, profile.name));
  if (profile.network) bytes = bytes.concat(encodeVarintField(2, profile.network));
  for (const p of profile.writablePaths ?? []) {
    bytes = bytes.concat(encodeString(3, p));
  }
  for (const p of profile.readonlyPaths ?? []) {
    bytes = bytes.concat(encodeString(4, p));
  }
  for (const [k, v] of Object.entries(profile.environment ?? {})) {
    const entry = [...encodeString(1, k), ...encodeString(2, v)];
    bytes = bytes.concat(encodeEmbedded(5, entry));
  }
  if (profile.timeoutMs) bytes = bytes.concat(encodeVarintField(6, profile.timeoutMs));
  if (profile.policyScript) bytes = bytes.concat(encodeString(7, profile.policyScript));
  return bytes;
}

function decodeResponse(buf) {
  const result = {};
  let offset = 0;
  while (offset < buf.length) {
    const tag = buf[offset++];
    const field = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
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
      if (field === 2) result.runResult = decodeRunResult(data);
      else if (field === 3) result.healthCheckResult = decodeHealthCheck(data);
      else if (field === 4) result.error = decodeError(data);
    }
  }
  return result;
}

function decodeRunResult(buf) {
  const result = {};
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
  const result = {};
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
      else if (field === 2) {
        result.capabilities = (result.capabilities ?? []).concat(data.toString("utf8"));
      }
    }
  }
  return result;
}

function decodeError(buf) {
  const result = {};
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

function sendAndReceive(envelopeBytes, behavior) {
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

test("TS-encoded RunRequest is correctly decoded by Rust-side mock", async () => {
  const env = encodeEnvelope({
    requestId: 1,
    run: { command: "echo", args: ["hello", "world"] },
  });
  const response = await sendAndReceive(env, "reflect");
  assert.equal(response.requestId, 1);
  const parsed = JSON.parse(response.runResult?.stdout ?? "{}");
  assert.equal(parsed.command, "echo");
  assert.deepEqual(parsed.args, ["hello", "world"]);
});

test("TS-encoded RunRequest with all fields round-trips correctly", async () => {
  const env = encodeEnvelope({
    requestId: 99,
    run: {
      command: "cargo",
      args: ["build", "--release"],
      cwd: "/workspace",
      env: { RUST_BACKTRACE: "1", CARGO_TARGET_DIR: "/tmp/target" },
      input: "stdin-content",
      timeoutMs: 60000,
      maxOutputBytes: 65536,
    },
  });
  const response = await sendAndReceive(env, "reflect");
  assert.equal(response.requestId, 99);
  const parsed = JSON.parse(response.runResult?.stdout ?? "{}");
  assert.equal(parsed.command, "cargo");
  assert.deepEqual(parsed.args, ["build", "--release"]);
  assert.equal(parsed.cwd, "/workspace");
  assert.equal(parsed.env.RUST_BACKTRACE, "1");
  assert.equal(parsed.env.CARGO_TARGET_DIR, "/tmp/target");
  assert.equal(parsed.input, "stdin-content");
  assert.equal(parsed.timeoutMs, 60000);
  assert.equal(parsed.maxOutputBytes, 65536);
});

test("a truncated RunResult survives the round-trip", async () => {
  const env = encodeEnvelope({
    requestId: 11,
    run: { command: "yes", maxOutputBytes: 1024 },
  });
  const response = await sendAndReceive(env, "truncate");
  assert.equal(response.requestId, 11);
  assert.equal(response.runResult?.bytesTruncated, true);
  assert.equal(response.runResult?.stdout, "partial-output");
});

test("TS-encoded RunSandboxedRequest round-trips correctly", async () => {
  const env = encodeEnvelope({
    requestId: 7,
    runSandboxed: {
      run: { command: "npm", args: ["install"] },
      profile: {
        name: "ci",
        network: 2,
        writablePaths: ["/workspace", "/tmp"],
        readonlyPaths: ["/etc", "/usr"],
        environment: { CI: "1", NODE_ENV: "production" },
        timeoutMs: 120000,
        policyScript: "allow_read('/etc'); deny_network()",
      },
    },
  });
  const response = await sendAndReceive(env, "default");
  assert.equal(response.requestId, 7);
  assert.equal(response.runResult?.stdout, "sandboxed:npm");
  assert.equal(response.runResult?.exitCode === 0 || response.runResult?.exitCode === undefined, true);
});

test("TS-encoded HealthCheck gets a valid response", async () => {
  const env = encodeEnvelope({ requestId: 0, healthCheck: {} });
  const response = await sendAndReceive(env);
  assert.equal(response.healthCheckResult?.runtimeVersion, "0.0.0-mock");
  assert.deepEqual(response.healthCheckResult?.capabilities, ["run", "run_sandboxed"]);
});

test("Error response is correctly decoded by TS-side logic", async () => {
  const env = encodeEnvelope({ requestId: 5, run: { command: "fail" } });
  const response = await sendAndReceive(env, "error:SANDBOX_DENIED");
  assert.equal(response.requestId, 5);
  assert.equal(response.error?.code, "SANDBOX_DENIED");
  assert.match(response.error?.message, /mock error/);
});
