import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  persistInkTheme,
} from "../dist/theme-preferences.js";
import { resolveInkTheme } from "../dist/config.js";

test("environment theme overrides config and the signal default", () => {
  assert.equal(
    resolveInkTheme(
      { theme: "mono" },
      { DEV_AGENT_THEME: "ember" },
    ),
    "ember",
  );
  assert.equal(resolveInkTheme({ theme: "mono" }, {}), "mono");
  assert.equal(resolveInkTheme({ theme: "unknown" } as never, {}), "signal");
  assert.equal(resolveInkTheme({}, {}), "signal");
});

test("persists a theme while preserving unrelated config fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-theme-"));
  const configPath = join(directory, ".dev-agent", "config.json");
  try {
    await mkdir(join(directory, ".dev-agent"), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({ defaultModel: "qwen3:4b", theme: "signal", maxTurns: 8 }),
      "utf8",
    );
    await persistInkTheme(configPath, "ember");

    assert.deepEqual(
      JSON.parse(await readFile(configPath, "utf8")),
      { defaultModel: "qwen3:4b", theme: "ember", maxTurns: 8 },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("creates a minimal config atomically when the file does not exist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-theme-new-"));
  const configPath = join(directory, "nested", "config.json");
  try {
    await persistInkTheme(configPath, "mono");
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), { theme: "mono" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
