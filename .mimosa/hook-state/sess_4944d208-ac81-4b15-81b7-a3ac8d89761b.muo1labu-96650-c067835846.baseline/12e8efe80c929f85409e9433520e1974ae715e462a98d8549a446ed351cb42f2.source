import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildSetupConfig,
  getSetupDefaultModel,
  getSetupCredentialHint,
  writeSetupConfig,
} from "../dist/setup-command.js";

test("setup config preserves existing settings while changing provider defaults", () => {
  const result = buildSetupConfig(
    {
      theme: "ember",
      defaultProvider: "ollama",
      defaultModel: "old-model",
    },
    { provider: "openai", model: "gpt-4.1-mini" },
  );

  assert.deepEqual(result, {
    theme: "ember",
    defaultProvider: "openai",
    defaultModel: "gpt-4.1-mini",
  });
});

test("setup exposes safe provider defaults and credential hints", () => {
  assert.equal(getSetupDefaultModel("ollama"), "qwen3:4b-instruct");
  assert.equal(getSetupDefaultModel("anthropic"), "claude-sonnet-4-20250514");
  assert.match(getSetupCredentialHint("openai"), /OPENAI_API_KEY/);
  assert.match(getSetupCredentialHint("gemini"), /GEMINI_API_KEY/);
  assert.match(getSetupCredentialHint("ollama"), /does not require an API key/i);
});

test("setup writes an atomic user-readable config without storing credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-setup-"));
  const configPath = join(directory, ".dev-agent", "config.json");
  const result = await writeSetupConfig(configPath, {
    provider: "openai",
    model: "gpt-4.1-mini",
  });

  assert.equal(result.created, true);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
    defaultProvider: "openai",
    defaultModel: "gpt-4.1-mini",
  });
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(configPath, "utf8"), /api[-_]?key/i);
});

test("setup refuses to replace a symlinked config target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-setup-link-"));
  const configPath = join(directory, "config.json");
  const targetPath = join(directory, "target.json");
  await writeSetupConfig(targetPath, { provider: "ollama", model: "qwen3:4b-instruct" });
  await chmod(targetPath, 0o600);

  // The write path must not follow an existing symlink.
  const { symlink } = await import("node:fs/promises");
  await symlink(targetPath, configPath);
  await assert.rejects(
    () => writeSetupConfig(configPath, { provider: "openai", model: "gpt-4.1-mini" }),
    /symbolic link|symlink/i,
  );
});
