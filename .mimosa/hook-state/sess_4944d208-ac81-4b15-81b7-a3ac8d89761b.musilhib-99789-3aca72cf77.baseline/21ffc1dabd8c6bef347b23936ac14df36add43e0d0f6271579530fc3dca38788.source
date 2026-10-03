import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChatSession } from "../dist/chat-session.js";
import { createDesktopServer } from "../dist/server.js";

function start(server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address() as any;
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

async function close(server) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function checkpointSession(): any {
  let rewinds = 0;
  return {
    id: "session-checkpoint",
    async run() {},
    createCheckpoint: async () => ({
      id: "checkpoint-created",
      sessionId: "session-checkpoint",
      entryCount: 2,
      createdAt: "2026-09-23T00:00:00.000Z",
    }),
    listCheckpoints: async () => [
      {
        id: "checkpoint-created",
        sessionId: "session-checkpoint",
        entryCount: 2,
        createdAt: "2026-09-23T00:00:00.000Z",
      },
    ],
    rewindToCheckpoint: async (checkpointId: string) => {
      if (checkpointId !== "checkpoint-created") {
        throw new Error(`unknown checkpoint: ${checkpointId}`);
      }
      assert.equal(checkpointId, "checkpoint-created");
      rewinds += 1;
      return {
        checkpoint: {
          id: checkpointId,
          sessionId: "session-checkpoint",
          entryCount: 2,
          createdAt: "2026-09-23T00:00:00.000Z",
        },
        removedEntryCount: rewinds === 1 ? 1 : 0,
        retainedCheckpointIds: [checkpointId],
      };
    },
  };
}

async function startOpenAiStub(chunksFor: () => any) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      JSON.parse(body);
      const frames = chunksFor().map((chunk: unknown) =>
        `data: ${JSON.stringify(chunk)}\n\n`
      );
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`${frames.join("")}data: [DONE]\n\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as any;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function assistantAnswer(requestIndex: number) {
  return [
    {
      choices: [{ delta: { content: `answer ${requestIndex}` } }],
    },
  ];
}

test("ChatSession creates and rewinds a validated conversation checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-checkpoint-"));
  const provider = await startOpenAiStub(() => assistantAnswer(1));
  const previous = {
    provider: process.env.DEV_AGENT_MODEL_PROVIDER,
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    memoryFile: process.env.DEV_AGENT_MEMORY_FILE,
    rustBinary: process.env.DEV_AGENT_RUST_BINARY,
    mcpServers: process.env.DEV_AGENT_MCP_SERVERS,
  };
  process.env.DEV_AGENT_MODEL_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_BASE_URL = provider.baseUrl;
  process.env.DEV_AGENT_MEMORY_FILE = join(directory, "checkpoint-session.json");
  delete process.env.DEV_AGENT_RUST_BINARY;
  process.env.DEV_AGENT_MCP_SERVERS = "[]";

  const session = new ChatSession({
    sessionId: "checkpoint-test",
    workingDirectory: directory,
  });
  try {
    assert.deepEqual(await session.listCheckpoints(), []);
    await session.run("first prompt", () => undefined);
    const checkpoint = await session.createCheckpoint();
    assert.equal(checkpoint.sessionId, "checkpoint-test");
    assert.equal(checkpoint.entryCount, 2);

    await session.run("second prompt", () => undefined);
    assert.deepEqual(
      (await session.listCheckpoints()).map((entry) => entry.id),
      [checkpoint.id],
    );

    const rewind = await session.rewindToCheckpoint(checkpoint.id);
    assert.equal(rewind.checkpoint.id, checkpoint.id);
    assert.equal(rewind.removedEntryCount, 2);
    const repeat = await session.rewindToCheckpoint(checkpoint.id);
    assert.equal(repeat.removedEntryCount, 0);

    await assert.rejects(
      () => session.rewindToCheckpoint("checkpoint-missing"),
      /unknown checkpoint: checkpoint-missing/,
    );
  } finally {
    await session.close();
    await provider.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value as string;
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("Desktop checkpoint routes expose bounded session-owned records", async () => {
  const server = createDesktopServer({ session: checkpointSession() });
  const base = await start(server);
  try {
    const list = await fetch(`${base}/api/sessions/session-checkpoint/checkpoints`);
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), {
      sessionId: "session-checkpoint",
      checkpoints: [
        {
          id: "checkpoint-created",
          sessionId: "session-checkpoint",
          entryCount: 2,
          createdAt: "2026-09-23T00:00:00.000Z",
        },
      ],
    });

    const created = await fetch(
      `${base}/api/sessions/session-checkpoint/checkpoint`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    assert.equal(created.status, 200);
    const checkpoint: any = await created.json();
    assert.equal(checkpoint.checkpoint.id, "checkpoint-created");

    const rewind = await fetch(
      `${base}/api/sessions/session-checkpoint/checkpoint/rewind`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpointId: "checkpoint-created" }),
      },
    );
    assert.equal(rewind.status, 200);
    const result: any = await rewind.json();
    assert.equal(result.result.removedEntryCount, 1);
    assert.equal(result.result.checkpoint.id, "checkpoint-created");

    const missing = await fetch(
      `${base}/api/sessions/session-checkpoint/checkpoint/rewind`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpointId: "checkpoint-missing" }),
      },
    );
    assert.equal(missing.status, 404);
  } finally {
    await close(server);
  }
});

test("Desktop rejects checkpoint mutations while the session is running", async () => {
  let release;
  let started;
  const running = new Promise((resolve) => {
    started = resolve;
  });
  const session = checkpointSession();
  session.run = async () => {
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const chat = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "keep running" }),
    });
    await running;
    const created = await fetch(
      `${base}/api/sessions/session-checkpoint/checkpoint`,
      { method: "POST" },
    );
    assert.equal(created.status, 409);
    const rewind = await fetch(
      `${base}/api/sessions/session-checkpoint/checkpoint/rewind`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpointId: "checkpoint-created" }),
      },
    );
    assert.equal(rewind.status, 409);
    release?.();
    await chat.text();
  } finally {
    release?.();
    await close(server);
  }
});

test("Desktop checkpoint UI keeps an explicit confirm-before-rewind boundary", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /id="checkpoint-action"/);
    assert.match(html, /id="checkpoint-panel"/);
    assert.match(html, /checkpoint\.confirmRewind/);
    assert.match(html, /checkpoint\/rewind/);
    const styles = await (await fetch(`${base}/public/styles.css`)).text();
    assert.match(styles, /\.checkpoint-panel/);
  } finally {
    await close(server);
  }
});
