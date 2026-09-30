#!/usr/bin/env node

const earlyInterrupt = new AbortController();
const onInterrupt = (): void => {
  earlyInterrupt.abort(new Error("CLI process interrupted"));
};

// Keep the signal alive while the command module is still loading. This is
// important for provider-free commands that can be interrupted during startup.
process.env.DEV_AGENT_NO_AUTO_MAIN = "1";
process.once("SIGINT", onInterrupt);
process.once("SIGTERM", onInterrupt);

try {
  const { runCli } = await import("./index.js");
  await runCli(process.argv, { startupSignal: earlyInterrupt.signal });
} finally {
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onInterrupt);
}
