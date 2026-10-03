import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const controller = await readFile(new URL("../public/task-validation-ui.js", import.meta.url), "utf8");

test("Desktop exposes a bounded bilingual task validation center", () => {
  assert.match(html, /id="task-validation-panel"/);
  assert.match(html, /id="task-validation-checks"/);
  assert.match(html, /id="task-validation-run"/);
  assert.match(html, /id="task-validation-rerun-failed"/);
  assert.match(html, /id="task-validation-cancel"/);
  assert.match(html, /id="task-validation-feedback"/);
  assert.match(html, /"taskValidation\.title": "Validation center"/);
  assert.match(html, /"taskValidation\.title": "验证中心"/);
  assert.match(styles, /\.task-validation-panel\s*\{/);
  assert.match(styles, /\.task-validation-check\[data-state="failed"\]/);
  assert.match(styles, /\.task-validation-actions button:disabled/);
});

test("task validation UI uses the session-bound API and text-only rendering", () => {
  assert.match(controller, /\/api\/task-validation\?sessionId=/);
  assert.match(controller, /method: "POST"/);
  assert.match(controller, /mode === "failed"/);
  assert.match(controller, /task-validation-rerun-failed/);
  assert.match(controller, /\/api\/task-validation\/\$\{encodeURIComponent\(sessionId\)\}/);
  assert.match(controller, /insertFeedback\(feedback\)/);
  assert.match(controller, /onStateChanged/);
  assert.match(html, /onStateChanged: \(\) => \{/);
  assert.doesNotMatch(controller, /\.innerHTML\s*=/);
  assert.match(controller, /textContent = safeText/);
  assert.match(controller, /schedulePoll\(token\)/);
});

test("failure feedback is bounded, metadata-only, and does not include output", async () => {
  const module = await import(pathToFileURL(fileURLToPath(new URL("../public/task-validation-ui.js", import.meta.url))).href);
  assert.equal(module.formatTaskValidationFeedback({ state: "passed", summary: "ok" }), "");
  const feedback = module.formatTaskValidationFeedback({
    state: "failed",
    summary: "check failed\u0000",
    failureSummary: "- typecheck: token=secret-value\n" + "x".repeat(20_000),
  });
  assert.ok(new TextEncoder().encode(feedback).byteLength <= 8 * 1024);
  assert.doesNotMatch(feedback, /\u0000/);
  assert.match(feedback, /Task validation failure/);
  assert.match(feedback, /typecheck/);
  assert.doesNotMatch(feedback, /raw output/i);
});
