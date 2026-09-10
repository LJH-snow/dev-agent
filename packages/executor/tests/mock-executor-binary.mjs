#!/usr/bin/env node

// Mock Rust executor binary for testing the TS↔Rust boundary without a Rust toolchain
// or external dependencies. Implements just enough protobuf wire format to encode
// and decode the executor protocol messages.
//
// Behavior is controlled via the MOCK_EXECUTOR_BEHAVIOR environment variable:
//   default         → echoes back a RunResult with stdout "mock:{command}"
//   reflect          → echoes back the exact RunRequest payload as JSON in stdout
//   truncate         → responds with a RunResult that reports truncated output
//   slow             → answers a run after a delay, so a cancel can arrive first
//   error:CODE       → responds with an ErrorResult using the given code
//   hang             → never responds (for timeout/disconnect tests)

import { Buffer } from "node:buffer";

// ---------------------------------------------------------------------------
// Minimal protobuf wire format implementation
// ---------------------------------------------------------------------------

const WIRE_VARINT = 0;
const WIRE_LEN_DELIMITED = 2;

function encodeVarint(value) {
  const bytes = [];
  let v = value;
  if (v < 0) {
    // Handle negative numbers as 10-byte two's complement (simplified)
    v = v & 0xffffffffffffffff;
  }
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
  return [...encodeTag(fieldNumber, WIRE_LEN_DELIMITED), ...encodeVarint(strBytes.length), ...strBytes];
}

function encodeVarintField(fieldNumber, value) {
  if (value === 0 || value === false) return [];
  return [...encodeTag(fieldNumber, WIRE_VARINT), ...encodeVarint(value)];
}

function encodeEmbedded(fieldNumber, encodedBytes) {
  return [...encodeTag(fieldNumber, WIRE_LEN_DELIMITED), ...encodeVarint(encodedBytes.length), ...encodedBytes];
}

function decodeVarint(buf, offset) {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < buf.length) {
    const byte = buf[offset + bytesRead];
    bytesRead++;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result, bytesRead };
}

function decodeMessage(buf, offset, length) {
  const result = {};
  const repeated = {};
  const end = offset + length;
  while (offset < end) {
    const tag = decodeVarint(buf, offset);
    offset += tag.bytesRead;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 0x07;
    if (wireType === WIRE_VARINT) {
      const val = decodeVarint(buf, offset);
      offset += val.bytesRead;
      if (fieldNumber in result) {
        const existing = repeated[fieldNumber] ?? [result[fieldNumber]];
        existing.push(val.value);
        repeated[fieldNumber] = existing;
      } else {
        result[fieldNumber] = val.value;
      }
    } else if (wireType === WIRE_LEN_DELIMITED) {
      const len = decodeVarint(buf, offset);
      offset += len.bytesRead;
      const data = buf.subarray(offset, offset + len.value);
      if (fieldNumber in result) {
        const existing = repeated[fieldNumber] ?? [result[fieldNumber]];
        existing.push(data);
        repeated[fieldNumber] = existing;
      } else {
        result[fieldNumber] = data;
      }
      offset += len.value;
    } else {
      // Skip unknown wire types
      break;
    }
  }
  for (const field of Object.keys(repeated)) {
    result[`${field}_repeated`] = repeated[Number(field)];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Message encoders/decoders for the executor protocol
// ---------------------------------------------------------------------------

// Field numbers from executor.proto:
// RunRequest: command=1, args=2, cwd=3, env=4, input=5, timeout_ms=6, max_output_bytes=7
function encodeRunRequest(msg) {
  let bytes = [];
  if (msg.command) bytes = bytes.concat(encodeString(1, msg.command));
  for (const arg of msg.args ?? []) {
    bytes = bytes.concat(encodeString(2, arg));
  }
  if (msg.cwd) bytes = bytes.concat(encodeString(3, msg.cwd));
  for (const [k, v] of Object.entries(msg.env ?? {})) {
    // env is a map<string,string>: key=1, value=2 inside the map entry (field 4 of RunRequest)
    let entry = [];
    entry = entry.concat(encodeString(1, k));
    entry = entry.concat(encodeString(2, v));
    bytes = bytes.concat(encodeEmbedded(4, entry));
  }
  if (msg.input) bytes = bytes.concat(encodeString(5, msg.input));
  if (msg.timeoutMs) bytes = bytes.concat(encodeVarintField(6, msg.timeoutMs));
  if (msg.maxOutputBytes) bytes = bytes.concat(encodeVarintField(7, msg.maxOutputBytes));
  return bytes;
}

// SandboxProfile: name=1, network=2, writable_paths=3, readonly_paths=4, environment=5, timeout_ms=6, policy_script=7
function encodeSandboxProfile(msg) {
  let bytes = [];
  if (msg.name) bytes = bytes.concat(encodeString(1, msg.name));
  if (msg.network) bytes = bytes.concat(encodeVarintField(2, msg.network));
  for (const p of msg.writablePaths ?? []) {
    bytes = bytes.concat(encodeString(3, p));
  }
  for (const p of msg.readonlyPaths ?? []) {
    bytes = bytes.concat(encodeString(4, p));
  }
  for (const [k, v] of Object.entries(msg.environment ?? {})) {
    let entry = [];
    entry = entry.concat(encodeString(1, k));
    entry = entry.concat(encodeString(2, v));
    bytes = bytes.concat(encodeEmbedded(5, entry));
  }
  if (msg.timeoutMs) bytes = bytes.concat(encodeVarintField(6, msg.timeoutMs));
  if (msg.policyScript) bytes = bytes.concat(encodeString(7, msg.policyScript));
  return bytes;
}

// Envelope: request_id=1, run=2, run_sandboxed=3, health_check=4, cancel=5
function encodeEnvelope(msg) {
  let bytes = [];
  if (msg.requestId) bytes = bytes.concat(encodeVarintField(1, msg.requestId));
  if (msg.payload?.run) {
    bytes = bytes.concat(encodeEmbedded(2, encodeRunRequest(msg.payload.run)));
  } else if (msg.payload?.runSandboxed) {
    const inner = encodeRunRequest(msg.payload.runSandboxed.run ?? []);
    const profile = encodeSandboxProfile(msg.payload.runSandboxed.profile ?? []);
    // RunSandboxedRequest: run=1, profile=2
    let sandboxedBytes = [];
    sandboxedBytes = sandboxedBytes.concat(encodeEmbedded(1, inner));
    sandboxedBytes = sandboxedBytes.concat(encodeEmbedded(2, profile));
    bytes = bytes.concat(encodeEmbedded(3, sandboxedBytes));
  } else if (msg.payload?.healthCheck !== undefined) {
    // HealthCheck is an empty message
    bytes = bytes.concat(encodeEmbedded(4, []));
  } else if (msg.payload?.cancel) {
    // CancelRequest: request_id=1
    const inner = encodeVarintField(1, msg.payload.cancel.requestId);
    bytes = bytes.concat(encodeEmbedded(5, inner));
  }
  return bytes;
}

// Response: request_id=1, run_result=2, health_check_result=3, error=4
function encodeResponse(msg) {
  let bytes = [];
  if (msg.requestId) bytes = bytes.concat(encodeVarintField(1, msg.requestId));
  if (msg.runResult) {
    // RunResult: stdout=1, stderr=2, exit_code=3, timed_out=4, bytes_truncated=5
    let inner = [];
    inner = inner.concat(encodeString(1, msg.runResult.stdout));
    inner = inner.concat(encodeString(2, msg.runResult.stderr));
    inner = inner.concat(encodeVarintField(3, msg.runResult.exitCode));
    if (msg.runResult.timedOut) inner = inner.concat(encodeVarintField(4, 1));
    if (msg.runResult.bytesTruncated) inner = inner.concat(encodeVarintField(5, 1));
    bytes = bytes.concat(encodeEmbedded(2, inner));
  }
  if (msg.healthCheckResult) {
    // HealthCheckResult: runtime_version=1, capabilities=2
    let inner = [];
    inner = inner.concat(encodeString(1, msg.healthCheckResult.runtimeVersion));
    for (const cap of msg.healthCheckResult.capabilities ?? []) {
      inner = inner.concat(encodeString(2, cap));
    }
    bytes = bytes.concat(encodeEmbedded(3, inner));
  }
  if (msg.error) {
    // ErrorResult: message=1, code=2
    let inner = [];
    inner = inner.concat(encodeString(1, msg.error.message));
    inner = inner.concat(encodeString(2, msg.error.code));
    bytes = bytes.concat(encodeEmbedded(4, inner));
  }
  return bytes;
}

function decodeEnvelope(buf) {
  const fields = decodeMessage(buf, 0, buf.length);
  const result = {};
  if (fields[1] !== undefined) result.requestId = fields[1];
  if (fields[2] !== undefined) {
    result.payload = { run: decodeRunRequest(fields[2]) };
  } else if (fields[3] !== undefined) {
    const sandboxed = decodeMessage(fields[3], 0, fields[3].length);
    result.payload = {
      runSandboxed: {
        run: sandboxed[1] ? decodeRunRequest(sandboxed[1]) : {},
        profile: sandboxed[2] ? decodeSandboxProfile(sandboxed[2]) : {},
      },
    };
  } else if (fields[4] !== undefined) {
    result.payload = { healthCheck: {} };
  } else if (fields[5] !== undefined) {
    const cancel = decodeMessage(fields[5], 0, fields[5].length);
    result.payload = { cancel: { requestId: cancel[1] ?? 0 } };
  }
  return result;
}

function decodeRunRequest(buf) {
  const fields = decodeMessage(buf, 0, buf.length);
  return {
    command: fields[1] ? fields[1].toString("utf8") : "",
    args: fields["2_repeated"] ? fields["2_repeated"].map((b) => b.toString("utf8")) : (fields[2] ? [fields[2].toString("utf8")] : []),
    cwd: fields[3] ? fields[3].toString("utf8") : undefined,
    env: fields["4_repeated"] ? decodeMapFromRepeated(fields["4_repeated"]) : (fields[4] ? decodeMap(fields[4]) : undefined),
    input: fields[5] ? fields[5].toString("utf8") : undefined,
    timeoutMs: fields[6] ?? undefined,
    maxOutputBytes: fields[7] ?? undefined,
  };
}

function decodeSandboxProfile(buf) {
  const fields = decodeMessage(buf, 0, buf.length);
  return {
    name: fields[1] ? fields[1].toString("utf8") : "",
    network: fields[2] ?? 0,
    writablePaths: fields["3_repeated"] ? fields["3_repeated"].map((b) => b.toString("utf8")) : (fields[3] ? [fields[3].toString("utf8")] : []),
    readonlyPaths: fields["4_repeated"] ? fields["4_repeated"].map((b) => b.toString("utf8")) : (fields[4] ? [fields[4].toString("utf8")] : []),
    environment: fields["5_repeated"] ? decodeMapFromRepeated(fields["5_repeated"]) : (fields[5] ? decodeMap(fields[5]) : undefined),
    timeoutMs: fields[6] ?? undefined,
    policyScript: fields[7] ? fields[7].toString("utf8") : undefined,
  };
}

function decodeMap(buf) {
  const fields = decodeMessage(buf, 0, buf.length);
  return {
    [fields[1]?.toString("utf8") ?? ""]: fields[2]?.toString("utf8") ?? "",
  };
}

function decodeMapFromRepeated(buffers) {
  const result = {};
  for (const buf of buffers) {
    const entry = decodeMap(buf);
    Object.assign(result, entry);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const behavior = process.env.MOCK_EXECUTOR_BEHAVIOR ?? "default";

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    if (buffer.length < 4) break;
    const length = buffer.readUInt32BE(0);
    if (buffer.length < 4 + length) break;
    const encoded = buffer.subarray(4, 4 + length);
    buffer = buffer.subarray(4 + length);
    handleRequest(encoded);
  }
});

function handleRequest(encoded) {
  if (behavior === "hang") return;
  const envelope = decodeEnvelope(encoded);
  const requestId = envelope.requestId;

  // A cancel answers for the request it targets; the run itself is not
  // expected to produce another response in this mock.
  if (envelope.payload?.cancel) {
    writeFrame(
      encodeResponse({
        requestId: envelope.payload.cancel.requestId,
        error: { message: `mock cancelled ${envelope.payload.cancel.requestId}`, code: "CANCELLED" },
      })
    );
    return;
  }

  let response;

  if (behavior.startsWith("error:")) {
    const code = behavior.slice("error:".length);
    response = { requestId, error: { message: `mock error (${code})`, code } };
  } else if (envelope.payload?.run) {
    const run = envelope.payload.run;
    if (behavior === "reflect") {
      response = { requestId, runResult: { stdout: JSON.stringify(run), stderr: "", exitCode: 0, timedOut: false } };
    } else if (behavior === "truncate") {
      response = { requestId, runResult: { stdout: "partial-output", stderr: "", exitCode: -1, timedOut: false, bytesTruncated: true } };
    } else {
      response = { requestId, runResult: { stdout: `mock:${run.command}`, stderr: "", exitCode: 0, timedOut: false } };
    }
  } else if (envelope.payload?.runSandboxed) {
    const run = envelope.payload.runSandboxed.run ?? { command: "" };
    response = { requestId, runResult: { stdout: `sandboxed:${run.command}`, stderr: "", exitCode: 0, timedOut: false } };
  } else if (envelope.payload?.healthCheck) {
    response = { requestId, healthCheckResult: { runtimeVersion: "0.0.0-mock", capabilities: ["run", "run_sandboxed"] } };
  } else {
    response = { requestId, error: { message: "empty envelope", code: "INVALID_REQUEST" } };
  }

  if (behavior === "slow" && (envelope.payload?.run || envelope.payload?.runSandboxed)) {
    setTimeout(() => writeFrame(encodeResponse(response)), 2000);
    return;
  }

  writeFrame(encodeResponse(response));
}

function writeFrame(bytes) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length, 0);
  process.stdout.write(header);
  process.stdout.write(Buffer.from(bytes));
}
