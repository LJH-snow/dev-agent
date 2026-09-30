import assert from "node:assert/strict";
import test from "node:test";

import { InkUiController } from "../dist/ink-ui.js";

test("Ink prompt controller delivers idle input and preserves queued input", async () => {
  const controller = new InkUiController();

  const firstPrompt = controller.nextPrompt();
  controller.submit("first prompt");
  assert.deepEqual(await firstPrompt, { value: "first prompt", queued: false });

  controller.setBusy(true);
  controller.submit("second prompt");
  assert.deepEqual(await controller.nextPrompt(), {
    value: "second prompt",
    queued: true,
  });
});

test("Ink prompt controller gives approval input to the waiting approval request", async () => {
  const controller = new InkUiController();
  const approval = controller.askApproval("Run shell anyway? [y/N] ");

  controller.submit("n");

  assert.equal(await approval, "n");
  assert.equal(controller.snapshot().approvalPrompt, undefined);
});

test("Ink approval prompt abort releases the prompt slot", async () => {
  const controller = new InkUiController();
  const abort = new AbortController();
  const approval = controller.askApproval("Select worker tools: ", abort.signal);

  assert.equal(controller.snapshot().approvalPrompt, "Select worker tools: ");
  abort.abort();

  assert.equal(await approval, "");
  assert.equal(controller.snapshot().approvalPrompt, undefined);
  const nextApproval = controller.askApproval("Next prompt: ");
  controller.submit("ready");
  assert.equal(await nextApproval, "ready");
});

test("Ink text prompt accepts free-form input and abort releases the prompt slot", async () => {
  const controller = new InkUiController();
  const abort = new AbortController();
  const selection = controller.askText("Choose exact tool names: ", abort.signal);

  assert.equal(controller.snapshot().textPrompt, "Choose exact tool names: ");
  controller.submit("filesystem, search");
  assert.equal(await selection, "filesystem, search");
  assert.equal(controller.snapshot().textPrompt, undefined);

  const cancelled = controller.askText("Choose another scope: ", abort.signal);
  abort.abort();
  assert.equal(await cancelled, "");
  assert.equal(controller.snapshot().textPrompt, undefined);
  const next = controller.askText("Next scope: ");
  controller.submit("none");
  assert.equal(await next, "none");
});

test("Ink prompt controller switches themes without changing prompt state", () => {
  const controller = new InkUiController();

  assert.equal(controller.snapshot().theme, "signal");
  controller.setTheme("ember");

  assert.equal(controller.snapshot().theme, "ember");
  assert.deepEqual(controller.snapshot().queuedPrompts, []);
  assert.equal(controller.snapshot().busy, false);
});
