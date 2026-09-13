import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChatSession } from "../dist/chat-session.js";

const ENV_KEYS = [
  "DEV_AGENT_MODEL_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "DEV_AGENT_MEMORY_FILE",
  "DEV_AGENT_APPROVAL",
  "DEV_AGENT_RUST_BINARY",
];

function applyEnv(values) {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value as string;
  return () => {
    for (const key of ENV_KEYS) {
      const previous = saved.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  };
}

async function startStubProvider() {
  let requests = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests += 1;
      const chunks = requests === 1
        ? [{
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "call-review-1",
                  type: "function",
                  function: {
                    name: "filesystem",
                    arguments: JSON.stringify({
                      action: "edit",
                      path: "target.txt",
                      oldText: "keep",
                      newText: "changed",
                    }),
                  },
                }],
              },
            }],
          }]
        : [{ choices: [{ delta: { content: "done" } }] }];
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function withSession(run) {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-review-"));
  const target = join(directory, "target.txt");
  await writeFile(target, "keep\n", "utf8");
  const provider = await startStubProvider();
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(directory, "session.json"),
    DEV_AGENT_APPROVAL: "review-writes",
  });
  try {
    const session = new ChatSession({ workingDirectory: directory, approvalMode: "review-writes" });
    return await run({ directory, target, session });
  } finally {
    await provider.close();
    restoreEnv();
    await rm(directory, { recursive: true, force: true });
  }
}

test("review-writes sends a real filesystem diff and applies only after approval", async () => {
  await withSession(async ({ target, session }) => {
    const events = [];
    const prompts = [];
    await session.run(
      "change the file",
      (event) => events.push(event),
      {
        requestApproval: async (prompt) => {
          prompts.push(prompt);
          assert.equal(prompt.tool, "filesystem");
          assert.ok(prompt.review);
          assert.match(prompt.review.changeSetId, /^[0-9a-f-]{36}$/);
          assert.match(prompt.review.files[0].diff, /-keep/);
          assert.match(prompt.review.files[0].diff, /\+changed/);
          return "allow";
        },
      }
    );

    assert.equal(prompts.length, 1);
    assert.equal(await readFile(target, "utf8"), "changed\n");
    assert.ok(events.some((event) => event.type === "approval" && event.data.decision === "allow"));
  });
});

test("review-writes denial leaves the target unchanged", async () => {
  await withSession(async ({ target, session }) => {
    const events = [];
    await session.run(
      "do not change it",
      (event) => events.push(event),
      { requestApproval: async () => "deny" }
    );

    assert.equal(await readFile(target, "utf8"), "keep\n");
    assert.ok(events.some((event) => event.type === "approval" && event.data.decision === "deny"));
  });
});

test("review-writes without a requester denies a filesystem mutation", async () => {
  await withSession(async ({ target, session }) => {
    const events = [];
    await session.run("write only with a review", (event) => events.push(event));

    assert.equal(await readFile(target, "utf8"), "keep\n");
    const denial = events.find((event) => event.type === "approval");
    assert.equal(denial.data.decision, "deny");
    assert.match(denial.data.reason, /interactive review/);
  });
});

test("review-writes can rollback an approved change set", async () => {
  await withSession(async ({ target, session }) => {
    let changeSetId;
    await session.run(
      "change and then undo the file",
      () => {},
      {
        requestApproval: async (prompt) => {
          changeSetId = prompt.review.changeSetId;
          return "allow";
        },
      }
    );

    assert.equal(await readFile(target, "utf8"), "changed\n");
    const result = await session.rollbackChangeSet(changeSetId);
    assert.equal(result.ok, true);
    assert.equal(result.changeSetId, changeSetId);
    assert.equal(await readFile(target, "utf8"), "keep\n");
  });
});

test("review-writes refuses rollback after the applied bytes changed", async () => {
  await withSession(async ({ target, session }) => {
    let changeSetId;
    await session.run(
      "change the file",
      () => {},
      {
        requestApproval: async (prompt) => {
          changeSetId = prompt.review.changeSetId;
          return "allow";
        },
      }
    );

    await writeFile(target, "external change\n", "utf8");
    await assert.rejects(
      () => session.rollbackChangeSet(changeSetId),
      /postimage.*conflict|postimage.*hash conflict/
    );
    assert.equal(await readFile(target, "utf8"), "external change\n");
  });
});
