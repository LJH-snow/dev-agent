import { startServer } from "./server.js";

export { ChatSession } from "./chat-session.js";
export { createDesktopServer, startServer } from "./server.js";
export type { ChatSessionOptions, StreamEvent } from "./chat-session.js";
export type { DesktopServerOptions } from "./server.js";

async function main(): Promise<void> {
  const server = await startServer();
  const address = server.address();
  if (address && typeof address !== "string") {
    console.log(`dev-agent desktop listening on http://${address.address}:${address.port}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
