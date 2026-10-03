import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChatSession } from "../dist/chat-session.js";

const ENV_KEYS = ["HOME", "DEV_AGENT_MODEL_PROVIDER", "DEV_AGENT_MEMORY_FILE"];

function applyEnv(values: Record<string, string>): () => void {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return () => {
    for (const key of ENV_KEYS) {
      const previous = saved.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  };
}

test("desktop ignores a user config file above the 1 MiB read limit", async () => {
  const home = await mkdtemp(join(tmpdir(), "dev-agent-desktop-config-limit-"));
  const configPath = join(home, ".dev-agent", "config.json");
  const memoryPath = join(home, "session.json");
  const restoreEnv = applyEnv({
    HOME: home,
    DEV_AGENT_MODEL_PROVIDER: "ollama",
    DEV_AGENT_MEMORY_FILE: memoryPath,
  });
  let session: ChatSession | undefined;
  try {
    await mkdir(join(home, ".dev-agent"), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({ approvalMode: "review-writes", padding: "x".repeat(1024 * 1024) }),
      "utf8"
    );

    session = new ChatSession({ workingDirectory: home });

    assert.equal(session.getStatus().approval.mode, "allow");
  } finally {
    await session?.close();
    restoreEnv();
    await rm(home, { recursive: true, force: true });
  }
});
