import assert from "node:assert/strict";
import { once } from "node:events";
import { realpathSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { createDesktopServer } from "../dist/server.js";
import { DesktopTaskTerminalManager, TaskTerminalError } from "../dist/task-terminal.js";

const publicModuleUrl = pathToFileURL(fileURLToPath(new URL("../public/task-terminal-ui.js", import.meta.url))).href;
const { normalizeLoopbackPreviewUrl, TerminalCommandHistory } = await import(publicModuleUrl);

async function waitFor(
  check: () => boolean,
  timeoutMs = 4000,
): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("terminal processes are bound to a session and accept bounded stdin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-terminal-"));
  const manager = new DesktopTaskTerminalManager();
  try {
    const command = `node -e "process.stdin.once('data', data => { process.stdout.write('received:' + data, () => process.exit(0)) })"`;
    const started = manager.start("task-one", directory, command);
    assert.equal(started.state, "running");
    assert.throws(
      () => manager.get("task-two", started.id),
      (error: unknown) => error instanceof TaskTerminalError && error.statusCode === 404,
    );

    manager.writeInput("task-one", started.id, "hello-terminal\n");
    await waitFor(() => manager.get("task-one", started.id).state !== "running");
    const completed = manager.get("task-one", started.id);
    assert.equal(completed.state, "exited");
    assert.ok(completed.events.some((event) => event.stream === "stdout" && event.text.includes("received:hello-terminal")));
    assert.ok(completed.events.some((event) => event.stream === "input" && event.text.includes("[input ")));
    assert.equal(manager.list("task-one").length, 1);
    assert.equal(manager.list("task-two").length, 0);
  } finally {
    manager.closeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("terminal lifecycle callback exposes only bounded state metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-terminal-lifecycle-"));
  const lifecycle = [];
  const manager = new DesktopTaskTerminalManager({
    onLifecycle: (event) => lifecycle.push(event),
  });
  try {
    const run = manager.start("task-lifecycle", directory, "node -e \"process.stdout.write('done')\"");
    assert.deepEqual(lifecycle, [{ sessionId: "task-lifecycle", status: "started" }]);
    await waitFor(() => manager.get("task-lifecycle", run.id).state !== "running");
    assert.deepEqual(lifecycle, [
      { sessionId: "task-lifecycle", status: "started" },
      { sessionId: "task-lifecycle", status: "completed" },
    ]);
    assert.doesNotMatch(JSON.stringify(lifecycle), /done|Users|path|command/i);
  } finally {
    manager.closeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("terminal refuses missing, non-directory, and symlinked working directories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-terminal-cwd-"));
  const manager = new DesktopTaskTerminalManager();
  const file = join(directory, "not-a-directory.txt");
  const missing = join(directory, "missing");
  const link = join(directory, "directory-link");
  try {
    await writeFile(file, "file\n", "utf8");
    for (const cwd of [missing, file]) {
      assert.throws(
        () => manager.start("task-cwd", cwd, "echo should-not-run"),
        (error: unknown) => error instanceof TaskTerminalError
          && error.statusCode === 409
          && error.code === "terminal-working-directory-invalid",
      );
    }
    if (process.platform !== "win32") {
      await symlink(directory, link, "dir");
      assert.throws(
        () => manager.start("task-cwd", link, "echo should-not-run"),
        (error: unknown) => error instanceof TaskTerminalError
          && error.statusCode === 409
          && error.code === "terminal-working-directory-invalid",
      );
    }
  } finally {
    manager.closeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("terminal uses a canonical cwd and keeps command/input secrets out of metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-terminal-metadata-"));
  const manager = new DesktopTaskTerminalManager();
  try {
    const expectedCwd = realpathSync(directory);
    const run = manager.start(
      "task-metadata",
      directory,
      `TOKEN=super-secret-123 node -e "process.stdout.write(process.cwd()); setTimeout(() => {}, 1000)"`,
    );
    assert.doesNotMatch(run.command, /super-secret-123/);
    assert.match(run.command, /redacted/);

    manager.writeInput("task-metadata", run.id, "password=super-secret-456\n");
    assert.doesNotMatch(JSON.stringify(manager.get("task-metadata", run.id)), /super-secret-[0-9]+/);

    await waitFor(() => manager.get("task-metadata", run.id).events.some(
      (event) => event.stream === "stdout" && event.text.includes(expectedCwd),
    ));
    manager.stop("task-metadata", run.id);
    await waitFor(() => manager.get("task-metadata", run.id).state !== "running");
    const completed = manager.get("task-metadata", run.id);
    assert.ok(completed.events.some((event) => event.stream === "stdout" && event.text.includes(expectedCwd)));
  } finally {
    manager.closeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("terminal session cleanup escalates to the process group when needed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-terminal-cleanup-"));
  const manager = new DesktopTaskTerminalManager();
  try {
    const run = manager.start(
      "task-cleanup",
      directory,
      `node -e "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"`,
    );
    assert.equal(await manager.stopSession("task-cleanup"), true);
    await waitFor(() => manager.get("task-cleanup", run.id).state !== "running");
    assert.equal(manager.get("task-cleanup", run.id).state, "stopped");
  } finally {
    manager.closeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("terminal output and process counts are bounded, and process groups can be stopped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-terminal-bounds-"));
  const manager = new DesktopTaskTerminalManager();
  try {
    const outputRun = manager.start(
      "task-output",
      directory,
      `node -e "process.stdout.write('x'.repeat(300000))"`,
    );
    await waitFor(() => manager.get("task-output", outputRun.id).state !== "running");
    const output = manager.get("task-output", outputRun.id);
    assert.equal(output.outputTruncated, true);
    assert.ok(output.events.reduce((bytes, event) => bytes + Buffer.byteLength(event.text, "utf8"), 0) <= 256 * 1024);

    const processes = Array.from({ length: 4 }, () => manager.start(
      "task-limit",
      directory,
      `node -e "setInterval(() => {}, 1000)"`,
    ));
    assert.throws(
      () => manager.start("task-limit", directory, "echo fifth"),
      (error: unknown) => error instanceof TaskTerminalError && error.code === "terminal-session-limit",
    );
    for (const process of processes) manager.stop("task-limit", process.id);
    await waitFor(() => processes.every((process) => manager.get("task-limit", process.id).state === "stopped"));
  } finally {
    manager.closeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("terminal command history is bounded, deduplicated, and restores the draft", () => {
  const history = new TerminalCommandHistory(2);
  history.add(" first ");
  history.add("second");
  history.add("third");
  history.add("second");

  assert.deepEqual(history.entries, ["third", "second"]);
  assert.deepEqual(history.previous("draft"), { value: "second", active: true });
  assert.deepEqual(history.previous(), { value: "third", active: true });
  assert.deepEqual(history.next(), { value: "second", active: true });
  assert.deepEqual(history.next(), { value: "draft", active: false });
  assert.deepEqual(history.next(), { value: "draft", active: false });

  history.add("x".repeat(5000));
  assert.equal(history.entries.at(-1)?.length, 4096);
});

test("browser preview accepts explicit-port loopback HTTP(S) URLs only", () => {
  assert.equal(normalizeLoopbackPreviewUrl("http://localhost:5173/"), "http://localhost:5173/");
  assert.equal(normalizeLoopbackPreviewUrl("https://127.0.0.1:8443/app"), "https://127.0.0.1:8443/app");
  assert.equal(normalizeLoopbackPreviewUrl("http://example.com:5173"), undefined);
  assert.equal(normalizeLoopbackPreviewUrl("https://localhost"), undefined);
  assert.equal(normalizeLoopbackPreviewUrl("javascript:alert(1)"), undefined);
  assert.equal(normalizeLoopbackPreviewUrl("http://user:pass@localhost:5173"), undefined);
});

test("terminal API accepts only loopback clients and loopback browser origins", async () => {
  const server = createDesktopServer({
    host: "127.0.0.1",
    session: { id: "terminal-security", run: async () => undefined },
    capabilityToken: "test-capability-token",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const localWithoutOrigin = await fetch(`${baseUrl}/api/terminal`);
    assert.equal(localWithoutOrigin.status, 200);

    const sameLoopbackOrigin = await fetch(`${baseUrl}/api/terminal`, {
      headers: { origin: baseUrl },
    });
    assert.equal(sameLoopbackOrigin.status, 200);

    const missingCapability = await fetch(`${baseUrl}/api/terminal`, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "terminal-security", command: "echo blocked" }),
    });
    assert.equal(missingCapability.status, 403);
    assert.deepEqual(await missingCapability.json(), {
      error: "desktop capability token is required",
      code: "desktop-capability-required",
    });

    const differentLoopbackOrigin = await fetch(`${baseUrl}/api/terminal`, {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    assert.equal(differentLoopbackOrigin.status, 403);

    const untrustedOrigin = await fetch(`${baseUrl}/api/terminal`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "terminal-security", command: "touch SHOULD_NOT_RUN" }),
    });
    assert.equal(untrustedOrigin.status, 403);
    assert.match(await untrustedOrigin.text(), /trusted loopback requests/);

    const trustedMutation = await fetch(`${baseUrl}/api/terminal`, {
      method: "POST",
      headers: {
        origin: baseUrl,
        "content-type": "application/json",
        "x-dev-agent-capability": "test-capability-token",
      },
      body: JSON.stringify({ sessionId: "terminal-security", command: "printf token-ok" }),
    });
    assert.equal(trustedMutation.status, 201);
    const terminal = await trustedMutation.json() as { id: string };
    await fetch(`${baseUrl}/api/terminal/terminal-security/${terminal.id}`, {
      method: "DELETE",
      headers: { origin: baseUrl, "x-dev-agent-capability": "test-capability-token" },
    });
  } finally {
    server.close();
    await once(server, "close");
  }

  const directory = await mkdtemp(join(tmpdir(), "dev-agent-terminal-socket-"));
  const socketPath = join(directory, "desktop.sock");
  const socketServer = createDesktopServer({
    host: "127.0.0.1",
    session: { id: "terminal-security", run: async () => undefined },
  });
  socketServer.listen(socketPath);
  await once(socketServer, "listening");
  try {
    const remoteLikeUnixRequest = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      const request = httpRequest({ socketPath, path: "/api/terminal", method: "GET" }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { body += chunk; });
        response.on("end", () => resolve({ statusCode: response.statusCode, body }));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(remoteLikeUnixRequest.statusCode, 403);
  } finally {
    socketServer.close();
    await once(socketServer, "close");
    await rm(directory, { recursive: true, force: true });
  }
});

test("terminal and preview panels are wired to session state and safe text rendering", async () => {
  const html = await (await import("node:fs/promises")).readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const styles = await (await import("node:fs/promises")).readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const controller = await (await import("node:fs/promises")).readFile(new URL("../public/task-terminal-ui.js", import.meta.url), "utf8");
  assert.match(html, /id="task-terminal-panel"/);
  assert.match(html, /id="task-preview-frame"[^>]*sandbox="allow-scripts allow-forms"/);
  assert.match(html, /id="task-terminal-reconnect"/);
  assert.match(html, /id="task-terminal-follow"/);
  assert.match(html, /id="task-terminal-clear"/);
  assert.match(html, /id="task-terminal-export"/);
  assert.match(html, /id="task-preview-clear"/);
  assert.match(html, /createTaskTerminalUI\(/);
  assert.match(controller, /output\.textContent = outputText/);
  assert.match(controller, /normalizeLoopbackPreviewUrl/);
  assert.match(controller, /outputTruncated/);
  assert.match(controller, /reconnectOutput/);
  assert.match(controller, /TerminalCommandHistory/);
  assert.match(controller, /ArrowUp/);
  assert.match(controller, /ArrowDown/);
  assert.match(controller, /followOutput/);
  assert.match(controller, /recordLifecycle/);
  assert.match(controller, /emitLifecycle\("preview", "started"\)/);
  assert.match(controller, /updateOutputFollowState/);
  assert.match(controller, /createObjectURL/);
  assert.doesNotMatch(controller, /\.innerHTML\s*=/);
  assert.match(html, /await loadSessions\(\);[\s\S]{0,220}await loadSessionView\(currentSessionId\);[\s\S]{0,220}await taskTerminalUI\.refresh\(\)/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*--assistant-bg:\s*#1a252b/);
  assert.match(styles, /\.task-terminal-output/);
  assert.match(styles, /\.task-preview-frame/);
});
