import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const desktopEntry = join(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");

function listen(server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve((server.address() as any).port);
    });
  });
}

function close(server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function runDesktopEntry(port: number): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [desktopEntry], {
      env: {
        ...process.env,
        DEV_AGENT_DESKTOP_HOST: "127.0.0.1",
        DEV_AGENT_DESKTOP_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("desktop entry did not exit within the test timeout"));
    }, 2_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("desktop entry reuses a healthy existing instance on the fixed port", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ status: "ok", executorMode: "local" }));
      return;
    }
    if (request.url === "/") {
      response.setHeader("content-type", "text/html");
      response.end('<main class="workbench">dev-agent Signal Loom</main>');
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const port = await listen(server);
  try {
    const result = await runDesktopEntry(port);
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.match(result.stdout, new RegExp(`already running on http://127\\.0\\.0\\.1:${port}`));
    assert.equal(result.stderr, "");
  } finally {
    await close(server);
  }
});

test("desktop entry refuses an unrelated process without selecting another port", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/plain");
    response.end("unrelated service");
  });
  const port = await listen(server);
  try {
    const result = await runDesktopEntry(port);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /already in use/i);
    assert.doesNotMatch(result.stdout + result.stderr, /4318|4319/);
  } finally {
    await close(server);
  }
});
