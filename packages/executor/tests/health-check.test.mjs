// Validates the health check protocol used by the CLI's --check-rust flag.
// Sends a HealthCheck envelope to the mock binary and verifies the response
// contains the expected runtime version and capabilities.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = fileURLToPath(new URL(".", import.meta.url));
const mockBinary = join(here, "mock-executor-binary.mjs");

function decodeHealthCheckResponse(buf) {
  let offset = 0;
  let healthCheckData;
  while (offset < buf.length) {
    const tag = buf[offset++];
    const field = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
      while (offset < buf.length && (buf[offset] & 0x80) !== 0) offset++;
      offset++;
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
      if (field === 3) healthCheckData = data;
    }
  }

  const result = {};
  if (healthCheckData) {
    offset = 0;
    while (offset < healthCheckData.length) {
      const tag = healthCheckData[offset++];
      const field = tag >>> 3;
      const wireType = tag & 0x07;
      if (wireType === 2) {
        let len = 0;
        let shift = 0;
        while (offset < healthCheckData.length) {
          const byte = healthCheckData[offset++];
          len |= (byte & 0x7f) << shift;
          if ((byte & 0x80) === 0) break;
          shift += 7;
        }
        const data = healthCheckData.subarray(offset, offset + len);
        offset += len;
        if (field === 1) result.runtimeVersion = data.toString("utf8");
        else if (field === 2) {
          result.capabilities = (result.capabilities ?? []).concat(data.toString("utf8"));
        }
      }
    }
  }
  return result;
}

function sendHealthCheck() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [mockBinary], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    child.stdout.on("data", (chunk) => { stdout = Buffer.concat([stdout, chunk]); });
    child.on("close", () => {
      if (stdout.length < 4) return reject(new Error("no response"));
      const len = stdout.readUInt32BE(0);
      resolve(decodeHealthCheckResponse(stdout.subarray(4, 4 + len)));
    });
    const envelope = [0x08, 0x01, 0x22, 0x00];
    const frame = Buffer.alloc(4 + envelope.length);
    frame.writeUInt32BE(envelope.length, 0);
    Buffer.from(envelope).copy(frame, 4);
    child.stdin.write(frame);
    child.stdin.end();
  });
}

test("health check returns runtime version and capabilities", async () => {
  const response = await sendHealthCheck();
  assert.equal(response.runtimeVersion, "0.0.0-mock");
  assert.deepEqual(response.capabilities, ["run", "run_sandboxed"]);
});

test("health check response has valid framing", async () => {
  const child = spawn("node", [mockBinary], {
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = Buffer.alloc(0);
  const result = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { stdout = Buffer.concat([stdout, chunk]); });
    child.on("close", () => {
      if (stdout.length < 4) return reject(new Error("no response"));
      const len = stdout.readUInt32BE(0);
      assert.equal(len, stdout.length - 4);
      resolve(true);
    });
    const envelope = [0x08, 0x01, 0x22, 0x00];
    const frame = Buffer.alloc(4 + envelope.length);
    frame.writeUInt32BE(envelope.length, 0);
    Buffer.from(envelope).copy(frame, 4);
    child.stdin.write(frame);
    child.stdin.end();
  });
  assert.equal(await result, true);
});
