import { startDesktopEntry } from "./launcher.js";

export { ChatSession } from "./chat-session.js";
export {
  isHealthyDesktopInstance,
  resolveDesktopEndpoint,
  startDesktopEntry,
} from "./launcher.js";
export { createDesktopServer, startServer } from "./server.js";
export type { ChatSessionOptions, StreamEvent } from "./chat-session.js";
export type { DesktopServerOptions } from "./server.js";
export { createDesktopStatus } from "./status.js";
export {
  inspectRepository,
  loadProjectCapabilityMetadata,
  loadWorkbenchMetadata,
  normalizeGitHubCapabilitySnapshot,
  normalizeRepositoryCapabilitySnapshot,
  normalizeWorkbenchMetadataSnapshot,
  parseGitRemoteHost,
  probeGitHubCapability,
} from "./capabilities.js";
export type {
  CapabilityState,
  CiCapabilitySnapshot,
  CiRunConclusion,
  CiRunStatus,
  GitHubCapabilitySnapshot,
  RepositoryCapabilitySnapshot,
  RepositoryCapabilityState,
  SkillMetadataSnapshot,
  ScheduledJobMetadataSnapshot,
  WorkbenchMetadataSnapshot,
} from "./capabilities.js";
export type { DesktopStatusOptions, DesktopStatusSnapshot } from "./status.js";

async function main(): Promise<void> {
  const launch = await startDesktopEntry();
  if (launch.reused) {
    console.log(`dev-agent desktop already running on http://${launch.host}:${launch.port}`);
    return;
  }
  const address = launch.server?.address();
  if (address && typeof address !== "string") {
    console.log(`dev-agent desktop listening on http://${address.address}:${address.port}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
