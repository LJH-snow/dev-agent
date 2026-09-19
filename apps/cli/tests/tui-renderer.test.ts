import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  renderApprovalMessage,
  renderAssistantMessage,
  renderCommandHints,
  renderRuntimeStatus,
  renderSignalDivider,
  renderToolCall,
  renderToolResult,
  renderUserMessage,
  renderValidationMessage,
  renderWelcome,
} from "../dist/tui-renderer.js";
import { displayWidth, truncateToDisplayWidth } from "../dist/tui-width.js";

function visibleLength(line: string): number {
  return line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").length;
}

test("display width counts terminal cells rather than JavaScript code points", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("中文"), 4);
  assert.equal(displayWidth("e\u0301"), 1);
  assert.ok(displayWidth("🙂") >= 1);
  assert.ok(displayWidth(truncateToDisplayWidth("中文abc", 4)) <= 4);
});

test("welcome render includes provider, model, status, session, and working directory", () => {
  const output = renderWelcome({
    provider: "OpenAI",
    model: "gpt-5",
    streaming: true,
    sessionId: "session-123",
    workingDirectory: "/Users/example/project",
  });

  assert.match(output, /OpenAI/);
  assert.match(output, /gpt-5/);
  assert.match(output, /streaming/i);
  assert.match(output, /session-123/);
  assert.match(output, /\/Users\/example\/project/);
  assert.match(output, /SIGNAL LOOM/);
  assert.match(output, /SIGNAL LOOM|\/\\  \/\\/);
});

test("rich renderer uses semantic blocks for runtime, tools, approvals, and validation", () => {
  const output = [
    renderRuntimeStatus({
      provider: "OpenAI",
      model: "gpt-5",
      streaming: true,
      width: 48,
    }),
    renderToolCall("shell", "{\"command\":\"pwd\"}", { width: 48 }),
    renderToolResult("shell", "workspace ready", { width: 48 }),
    renderApprovalMessage("filesystem", "allow", "2 file(s), +8/-2", { width: 48 }),
    renderValidationMessage("passed", "workspace checks passed", { width: 48 }),
  ].join("\n");

  assert.match(output, /SIGNAL RAIL/);
  assert.match(output, /> TOOL \/ shell/);
  assert.match(output, /< TOOL RESULT \/ shell/);
  assert.match(output, /APPROVAL \/ filesystem/);
  assert.match(output, /VALIDATION \/ passed/);
});

test("runtime state is independent from streaming transport capability", () => {
  const output = renderRuntimeStatus({
    provider: "OpenAI",
    model: "gpt-5",
    streaming: true,
    runState: "ready",
    width: 48,
  });

  assert.match(output, /READY \/ idle/);
  assert.match(output, /Transport: streaming/);
  assert.doesNotMatch(output, /LIVE \/ streaming/);
});

test("runtime renderer keeps the live label for an active streaming turn", () => {
  const output = renderRuntimeStatus({
    provider: "OpenAI",
    model: "gpt-5",
    streaming: true,
    runState: "streaming",
    width: 48,
  });

  assert.match(output, /LIVE \/ streaming/);
  assert.match(output, /Transport: streaming/);
});

test("signal divider keeps the weave motif inside narrow terminal widths", () => {
  const output = renderSignalDivider("TOOLS", { width: 24 });

  assert.match(output, /TOOLS/);
  assert.match(output, /[╞═╡]/);
  assert.ok(output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").length <= 24);
});

test("assistant render gives markdown headings and fenced code a clear layout", () => {
  const output = renderAssistantMessage(
    ["# Summary", "", "Useful text", "", "```ts", "const answer = 42;", "```"].join("\n")
  );

  assert.match(output, /Summary/);
  assert.match(output, /const answer = 42;/);
  assert.match(output, /code/i);
  assert.match(output, /[┌└│]/);
});

test("assistant render preserves lightweight markdown structure and unknown text", () => {
  const output = renderAssistantMessage(
    ["> quoted", "- first item", "* second item", "plain **text** stays visible"].join("\n")
  );

  assert.match(output, /quoted/);
  assert.match(output, /first item/);
  assert.match(output, /second item/);
  assert.match(output, /plain \*\*text\*\* stays visible/);
});

test("user messages and command hints are readable", () => {
  const message = renderUserMessage("hello from the user");
  const hints = renderCommandHints([
    { command: "/help", description: "Show help" },
    { command: "/quit", description: "Exit" },
  ]);

  assert.match(message, /hello from the user/);
  assert.match(hints, /Commands/i);
  assert.match(hints, /\/help/);
  assert.match(hints, /Show help/);
  assert.match(hints, /\/quit/);
});

test("NO_COLOR returns readable output without ANSI escape sequences", () => {
  const modulePath = fileURLToPath(new URL("../dist/tui-renderer.js", import.meta.url));
  const script = `import { renderWelcome } from ${JSON.stringify(modulePath)};\nprocess.stdout.write(renderWelcome({provider: "Plain", model: "text", streaming: false, sessionId: "s", workingDirectory: "/tmp"}));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\u001b\[/);
  assert.match(result.stdout, /Plain/);
  assert.match(result.stdout, /idle/i);
});

test("assistant render strips terminal control payloads from model text", () => {
  const modulePath = fileURLToPath(new URL("../dist/tui-renderer.js", import.meta.url));
  const payload =
    "before\u001b]8;;https://example.invalid\u0007click\u001b]8;;\u0007"
    + "dcs-start\u001bP1;secret\u001b\\c1-dcs\u0090secret\u009c"
    + "after\u0008";
  const script = `import { renderAssistantMessage } from ${JSON.stringify(modulePath)};\nprocess.stdout.write(renderAssistantMessage(${JSON.stringify(payload)}));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /beforeclickdcs-startc1-dcsafter/);
  assert.doesNotMatch(result.stdout, /secret/);
  assert.doesNotMatch(result.stdout, /[\u001b\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/);
});


test("human terminal previews redact obvious credentials", async () => {
  const { redactSensitiveText } = (await import("../dist/tui-renderer.js")) as unknown as {
    redactSensitiveText: (value: string) => string;
  };

  assert.equal(typeof redactSensitiveText, "function");
  const output = redactSensitiveText(
    '{"apiKey":"secret-value","password":"hunter2","authorization":"Bearer abc123"}'
  );
  assert.doesNotMatch(output, /secret-value|hunter2|abc123/);
  assert.match(output, /\[redacted\]/);
});

test("narrow widths do not produce over-wide lines and long values remain readable", () => {
  const width = 24;
  const output = [
    renderWelcome({
      provider: "VeryLongProviderName",
      model: "very-long-model-name",
      streaming: false,
      sessionId: "session-with-a-long-identifier",
      workingDirectory: "/a/very/long/working/directory/path",
      width,
    }),
    renderAssistantMessage("A very long assistant line that should wrap safely.", { width }),
  ].join("\n");

  for (const line of output.split("\n")) {
    assert.ok(visibleLength(line) <= width, `line exceeded width: ${line}`);
  }
  assert.match(output, /VeryLongProviderName|VeryLongProvider|Provider/);
  assert.match(output, /working|directory|path/i);
});

test("default command hints use the CLI's colon commands", () => {
  const output = renderCommandHints();

  assert.match(output, /:help/);
  assert.match(output, /:clear/);
  assert.match(output, /:model/);
  assert.match(output, /:collapse/);
  assert.match(output, /:expand/);
  assert.match(output, /:validate/);
  assert.match(output, /:cleanup/);
  assert.match(output, /:quit/);
  assert.match(output, /exit \/ quit/);
  assert.doesNotMatch(output, /\/help/);
});
