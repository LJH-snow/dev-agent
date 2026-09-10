import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

// loadConfig() reads ~/.dev-agent/config.json, so point HOME at a scratch dir
// instead of the developer's real home.
async function withHome(run) {
  const home = await mkdtemp(join(tmpdir(), "dev-agent-home-"));
  try {
    await mkdir(join(home, ".dev-agent"), { recursive: true });
    return await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function baseEnv(home) {
  return {
    ...process.env,
    HOME: home,
    // Clear the variables that would otherwise take precedence.
    DEV_AGENT_MODEL_PROVIDER: "",
    DEV_AGENT_MODEL: "",
    GEMINI_API_KEY: "",
    DEV_AGENT_GEMINI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    DEV_AGENT_ANTHROPIC_API_KEY: "",
    DEV_AGENT_MEMORY_FILE: join(home, "memory.json"),
  };
}

test("the config file defaultProvider is used when no env var is set", async () => {
  await withHome(async (home) => {
    await writeFile(
      join(home, ".dev-agent", "config.json"),
      JSON.stringify({ defaultProvider: "gemini" })
    );

    const result = await runCli(["--once", "hi"], baseEnv(home));

    // Reaching the gemini API-key check proves the config file selected gemini;
    // without config support the CLI would have defaulted to ollama instead.
    assert.match(result.stderr, /GEMINI_API_KEY is required/);
  });
});

test("DEV_AGENT_MODEL_PROVIDER overrides the config file", async () => {
  await withHome(async (home) => {
    await writeFile(
      join(home, ".dev-agent", "config.json"),
      JSON.stringify({ defaultProvider: "gemini" })
    );

    const result = await runCli(["--once", "hi"], {
      ...baseEnv(home),
      DEV_AGENT_MODEL_PROVIDER: "anthropic",
    });

    assert.match(result.stderr, /ANTHROPIC_API_KEY is required/);
  });
});

test("a malformed config file falls back to defaults instead of crashing", async () => {
  await withHome(async (home) => {
    await writeFile(join(home, ".dev-agent", "config.json"), "{ this is not json");

    const result = await runCli(["--tools"], baseEnv(home));

    assert.equal(result.code, 0);
    assert.match(result.stdout, /code-search/);
  });
});
