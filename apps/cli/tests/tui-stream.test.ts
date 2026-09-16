import assert from "node:assert/strict";
import test from "node:test";

import { LiveAssistantRenderer } from "../dist/tui-stream.js";

test("live assistant renderer emits an initial answer and refreshes it as tokens arrive", () => {
  const writes: string[] = [];
  const renderer = new LiveAssistantRenderer((chunk) => writes.push(chunk), { width: 32 });

  renderer.append("# Title\n");
  renderer.append("hello");
  renderer.finish();

  const output = writes.join("");
  assert.match(output, /Assistant/);
  assert.match(output, /Title/);
  assert.match(output, /hello/);
  assert.match(output, /\u001b\[\d+A/);
  assert.equal(output.endsWith("\n"), true);
});

test("finishing a live answer resets the block for a later assistant segment", () => {
  const writes: string[] = [];
  const renderer = new LiveAssistantRenderer((chunk) => writes.push(chunk), { width: 32 });

  renderer.append("first");
  renderer.finish();
  renderer.append("second");
  renderer.finish();

  const output = writes.join("");
  assert.match(output, /first/);
  assert.match(output, /second/);
  assert.ok(output.split("Assistant").length >= 3);
});


test("coalesces high-frequency tokens and finish flushes the latest complete answer", () => {
  const writes: string[] = [];
  const scheduled: Array<() => void> = [];
  const cancelled = new Set<() => void>();
  const renderer = new LiveAssistantRenderer((chunk) => writes.push(chunk), {
    width: 32,
    throttleMs: 50,
    schedule: (callback) => {
      scheduled.push(callback);
      return callback;
    },
    cancelSchedule: (handle) => cancelled.add(handle as () => void),
  });

  renderer.append("a");
  for (let index = 0; index < 10_000; index += 1) {
    renderer.append("x");
  }

  assert.equal(scheduled.length, 1);
  assert.ok(writes.length < 100);

  const content = renderer.finish();
  assert.equal(content, `a${"x".repeat(10_000)}`);
  assert.equal(cancelled.size, 1);
  assert.match(writes.join(""), /a[x]+/);
});

test("keeps an unfinished fenced code block visible and does not duplicate it when closed", () => {
  const writes: string[] = [];
  const scheduled: Array<() => void> = [];
  const renderer = new LiveAssistantRenderer((chunk) => writes.push(chunk), {
    width: 40,
    throttleMs: 50,
    schedule: (callback) => {
      scheduled.push(callback);
      return callback;
    },
    cancelSchedule: () => undefined,
  });

  renderer.append("```ts\n");
  renderer.append("const answer = 42;");
  scheduled.shift()?.();
  assert.match(writes.join(""), /code \(ts\)/);
  assert.match(writes.join(""), /const answer = 42/);

  renderer.append("\n```");
  scheduled.shift()?.();
  renderer.finish();

  const output = writes.join("");
  const finalRenderedChunk = [...writes].reverse().find((chunk) => chunk.includes("const answer = 42"));
  assert.ok(finalRenderedChunk);
  assert.equal(finalRenderedChunk.match(/const answer = 42/g)?.length, 1);
  assert.equal(output.includes("const answer = 42"), true);
  assert.equal(scheduled.length, 0);
});

test("a late callback from a cancelled segment cannot consume the next segment's repaint", () => {
  const writes: string[] = [];
  const scheduled: Array<() => void> = [];
  const renderer = new LiveAssistantRenderer((chunk) => writes.push(chunk), {
    throttleMs: 50,
    schedule: (callback) => {
      scheduled.push(callback);
      return callback;
    },
    cancelSchedule: () => undefined,
  });

  renderer.append("first");
  renderer.append(" pending");
  const cancelledCallback = scheduled[0];
  renderer.finish();

  renderer.append("second");
  renderer.append(" pending");
  const nextCallback = scheduled[1];
  assert.ok(cancelledCallback);
  assert.ok(nextCallback);

  const writesBeforeLateCallback = writes.length;
  cancelledCallback?.();

  assert.equal(writes.length, writesBeforeLateCallback);
  assert.equal(renderer.isActive(), true);

  nextCallback?.();
  renderer.finish();
});

test("strips terminal control sequences from streamed assistant content before repainting", () => {
  const writes: string[] = [];
  const renderer = new LiveAssistantRenderer((chunk) => writes.push(chunk), {
    throttleMs: 0,
  });

  renderer.append("before\u001b]0;unsafe-title\u0007after");
  renderer.append(" and \u001b]8;;https://example.test");
  renderer.finish();

  const output = writes.join("");
  assert.match(output, /before/);
  assert.match(output, /after/);
  assert.match(output, /and/);
  assert.doesNotMatch(output, /unsafe-title/);
  assert.doesNotMatch(output, /https:\/\/example\.test/);
  assert.doesNotMatch(output, /\u001b\]/);
  assert.doesNotMatch(output, /\u0007/);
});
