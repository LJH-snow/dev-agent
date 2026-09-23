import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { InkThemeName } from "./ink/theme-types.js";

const MAX_CONFIG_BYTES = 1024 * 1024;

export async function persistInkTheme(
  configPath: string,
  theme: InkThemeName,
): Promise<void> {
  const config = await readConfigObject(configPath);
  const next = { ...config, theme };
  const directory = dirname(configPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const temporaryPath = `${configPath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, configPath);
}

async function readConfigObject(configPath: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return {};
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
