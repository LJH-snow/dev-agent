import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildDesktopAutoFixPrompt,
  selectLatestDesktopAutoFixTarget,
} from "../dist/autofix.js";
import { createDesktopServer } from "../dist/server.js";

function validation(status: "passed" | "failed" | "blocked", changeSetId: string, recordedAt: string) {
  return {
    validationId: "validation:" + changeSetId + ":1",
    changeSetId,
    status,
    checks: [],
    durationMs: 1,
    summary: status === "passed"
      ? "all checks passed"
      : "password=secret /tmp/desktop-workspace/failure.ts",
    recordedAt,
  };
}

test("desktop Autofix selects only the latest failed or blocked validation", () => {
  const failed = validation("failed", "change-failed", "2026-09-30T00:00:00.000Z");
  const passed = validation("passed", "change-passed", "2026-09-30T00:00:01.000Z");
  assert.equal(selectLatestDesktopAutoFixTarget([failed, passed]), undefined);

  const blocked = validation("blocked", "change-blocked", "2026-09-30T00:00:02.000Z");
  const target = selectLatestDesktopAutoFixTarget([failed, blocked]);
  assert.ok(target);
  assert.equal(target.changeSetId, "change-blocked");
  assert.equal(target.status, "blocked");
});

test("desktop Autofix prompt is bounded and redacts sensitive diagnostics", () => {
  const target = selectLatestDesktopAutoFixTarget([
    validation("failed", "change-failed", "2026-09-30T00:00:00.000Z"),
  ]);
  assert.ok(target);
  const prompt = buildDesktopAutoFixPrompt(target);
  assert.match(prompt, /Repair the latest validation failure/u);
  assert.match(prompt, /<validation-failure>/u);
  assert.doesNotMatch(prompt, /secret|desktop-workspace/u);
  assert.ok(prompt.length <= 12_000);
});

test("Desktop /api/autofix starts a plan-mode review from the latest failure", async () => {
  let receivedMessage = "";
  let receivedMode: string | undefined;
  const review = {
    changeSetId: "change-set-autofix",
    files: [],
    additions: 0,
    deletions: 0,
    createdAt: "2026-09-30T00:00:00.000Z",
  };
  const session = {
    id: "desktop-default",
    async getLatestAutoFixTarget() {
      return {
        changeSetId: "change-failed",
        status: "failed",
        prompt: "Repair the latest validation failure.",
      };
    },
    async run(message: string, emit: (event: any) => void, options?: { mode?: string }) {
      receivedMessage = message;
      receivedMode = options?.mode;
      emit({ type: "plan-review", data: { review } });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  } as any;
  const server = createDesktopServer({ session });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };

  try {
    const response = await fetch("http://127.0.0.1:" + address.port + "/api/autofix", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "desktop-default" }),
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /event: plan-review/u);
    assert.equal(receivedMode, "plan");
    assert.match(receivedMessage, /^Repair the latest validation failure in the current workspace\./u);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Desktop /api/autofix fails closed when no repairable validation exists", async () => {
  const server = createDesktopServer({
    session: {
      id: "desktop-default",
      async getLatestAutoFixTarget() {
        return undefined;
      },
      async run() {},
    } as any,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };

  try {
    const response = await fetch("http://127.0.0.1:" + address.port + "/api/autofix", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "desktop-default" }),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "no failed or blocked validation is available for Autofix",
      code: "autofix-unavailable",
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Desktop validation UI exposes the Autofix review action", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /validation\.autofix/u);
  assert.match(html, /\/api\/autofix/u);
});
