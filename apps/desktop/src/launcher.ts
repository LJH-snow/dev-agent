import type { Server } from "node:http";

import { startServer } from "./server.js";

const defaultHost = "127.0.0.1";
const defaultPort = 4317;
const probeTimeoutMs = 750;

export interface DesktopLaunchResult {
  readonly server: Server | null;
  readonly host: string;
  readonly port: number;
  readonly reused: boolean;
}

export function resolveDesktopEndpoint(
  env: NodeJS.ProcessEnv = process.env
): { readonly host: string; readonly port: number } {
  const host = env.DEV_AGENT_DESKTOP_HOST?.trim() || defaultHost;
  const rawPort = env.DEV_AGENT_DESKTOP_PORT?.trim();
  const port = rawPort === undefined || rawPort === "" ? defaultPort : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("DEV_AGENT_DESKTOP_PORT must be an integer from 0 to 65535");
  }
  return { host, port };
}

function isAddressInUse(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "EADDRINUSE"
  );
}

function probeHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

async function readProbe(url: string): Promise<{ ok: boolean; body: string }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(probeTimeoutMs),
    cache: "no-store",
  });
  return { ok: response.ok, body: await response.text() };
}

export async function isHealthyDesktopInstance(host: string, port: number): Promise<boolean> {
  const baseUrl = `http://${probeHost(host)}:${port}`;
  try {
    const health = await readProbe(`${baseUrl}/health`);
    if (!health.ok) return false;
    const payload = JSON.parse(health.body) as { status?: unknown };
    if (payload.status !== "ok") return false;

    const page = await readProbe(`${baseUrl}/`);
    return page.ok && page.body.includes('class="workbench"') && page.body.includes("dev-agent");
  } catch {
    return false;
  }
}

export async function startDesktopEntry(
  env: NodeJS.ProcessEnv = process.env
): Promise<DesktopLaunchResult> {
  const endpoint: { readonly host: string; readonly port: number } = resolveDesktopEndpoint(env);
  if (
    endpoint.port !== 0
    && await isHealthyDesktopInstance(endpoint.host, endpoint.port)
  ) {
    return { ...endpoint, server: null, reused: true };
  }
  try {
    const server = await startServer({ ...endpoint, requireCapabilityToken: true });
    return { ...endpoint, server, reused: false };
  } catch (error) {
    if (!isAddressInUse(error) || endpoint.port === 0) throw error;
    if (await isHealthyDesktopInstance(endpoint.host, endpoint.port)) {
      return { ...endpoint, server: null, reused: true };
    }
    throw new Error(
      `Desktop port ${endpoint.port} on ${endpoint.host} is already in use; `
      + "refusing to select another port. Stop the existing process or set "
      + "DEV_AGENT_DESKTOP_PORT to an explicit free port."
    );
  }
}
