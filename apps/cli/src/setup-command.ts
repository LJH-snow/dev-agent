import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  PROVIDER_IDS,
  type ProviderManagementConfig,
  type SupportedProviderId,
} from "./provider-command.js";

const MAX_CONFIG_BYTES = 1024 * 1024;

const DEFAULT_MODELS: Readonly<Record<SupportedProviderId, string>> = {
  ollama: "qwen3:4b-instruct",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-2.0-flash",
};

const CREDENTIAL_HINTS: Readonly<Record<SupportedProviderId, string>> = {
  ollama: "Ollama does not require an API key; make sure the local Ollama service is running.",
  openai: "Set OPENAI_API_KEY in your environment before starting dev-agent.",
  anthropic: "Set ANTHROPIC_API_KEY in your environment before starting dev-agent.",
  gemini: "Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your environment before starting dev-agent.",
};

export interface SetupSelection {
  readonly provider: SupportedProviderId;
  readonly model: string;
}

export interface SetupWriteResult extends SetupSelection {
  readonly configPath: string;
  readonly created: boolean;
}

export function getSetupDefaultModel(provider: SupportedProviderId): string {
  return DEFAULT_MODELS[provider];
}

export function getSetupCredentialHint(provider: SupportedProviderId): string {
  return CREDENTIAL_HINTS[provider];
}

export function parseSetupProvider(value: string): SupportedProviderId {
  const normalized = value.trim().toLowerCase();
  if ((PROVIDER_IDS as readonly string[]).includes(normalized)) {
    return normalized as SupportedProviderId;
  }
  throw new Error("Provider must be one of: ollama, openai, anthropic, gemini.");
}

export function buildSetupConfig(
  existing: ProviderManagementConfig & Record<string, unknown>,
  selection: SetupSelection,
): ProviderManagementConfig & Record<string, unknown> {
  return {
    ...existing,
    defaultProvider: selection.provider,
    defaultModel: selection.model,
  };
}

export async function writeSetupConfig(
  configPath: string,
  selection: SetupSelection,
): Promise<SetupWriteResult> {
  const existing = await readSetupConfig(configPath);
  const next = buildSetupConfig(existing, selection);
  const directory = dirname(configPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertSafeConfigTarget(configPath);

  const temporaryPath = `${configPath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, configPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return {
    configPath,
    provider: selection.provider,
    model: selection.model,
    created: Object.keys(existing).length === 0,
  };
}

async function readSetupConfig(
  configPath: string,
): Promise<ProviderManagementConfig & Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
    throw new Error("Configuration file exceeds the 1 MiB setup limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Configuration file is not valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new Error("Configuration file must contain a JSON object.");
  }
  return parsed as ProviderManagementConfig & Record<string, unknown>;
}

async function assertSafeConfigTarget(configPath: string): Promise<void> {
  try {
    const details = await lstat(configPath);
    if (details.isSymbolicLink()) {
      throw new Error("Configuration target cannot be a symbolic link.");
    }
    if (!details.isFile()) {
      throw new Error("Configuration target must be a regular file.");
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
