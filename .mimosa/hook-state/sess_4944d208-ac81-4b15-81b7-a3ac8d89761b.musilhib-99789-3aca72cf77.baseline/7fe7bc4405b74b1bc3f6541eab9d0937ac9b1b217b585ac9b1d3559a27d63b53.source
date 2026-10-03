import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough, Writable } from "node:stream";
import { createElement } from "react";
import { render, Text } from "ink";
import { createRenderMetricsLifecycle, RENDER_METRICS_SLOW_FRAME_MS, renderMetricsEnabled } from "../dist/ink/render-metrics.js";

test("metrics require explicit opt-in", () => {
  for (const value of [undefined, "0", "true"]) assert.equal(renderMetricsEnabled({ DEV_AGENT_TUI_RENDER_METRICS: value }), false);
  assert.equal(renderMetricsEnabled({ DEV_AGENT_TUI_RENDER_METRICS: "1" }), true);
});

test("disabled metrics still release initial input and never write", () => {
  let initial = 0;
  const lifecycle = createRenderMetricsLifecycle(() => initial++, false, () => assert.fail("write"));
  lifecycle.onRender({ renderTime: 100 });
  lifecycle.onRender({ renderTime: 200 });
  lifecycle.unmount(() => {});
  assert.equal(initial, 1);
});

test("exact budget and invalid samples are ignored", () => {
  assert.equal(RENDER_METRICS_SLOW_FRAME_MS, 1000 / 15);
  const lifecycle = createRenderMetricsLifecycle(() => {}, true, () => assert.fail("write"));
  for (const renderTime of [0, -1, 66.5, 1000 / 15, NaN, Infinity, -Infinity]) lifecycle.onRender({ renderTime });
  lifecycle.unmount(() => {});
});

test("bounded summary emits once after final render and cannot re-enter collection", () => {
  const writes: string[] = [];
  let unmounted = false;
  const lifecycle = createRenderMetricsLifecycle(() => {}, true, (message) => {
    assert.ok(unmounted);
    writes.push(message);
    lifecycle.onRender({ renderTime: 999 });
    lifecycle.unmount(() => assert.fail("second unmount"));
  });
  for (let i = 0; i < 100_000; i++) lifecycle.onRender({ renderTime: 100 });
  assert.deepEqual(writes, []);
  lifecycle.unmount(() => {
    lifecycle.onRender({ renderTime: 200 });
    unmounted = true;
  });
  lifecycle.unmount(() => assert.fail("second unmount"));
  assert.deepEqual(writes, ["[tui-render] slow frames: 100001; max: 200.0ms; budget: 66.67ms\n"]);
});

test("failed unmount never writes; diagnostic sink failure is nonfatal", () => {
  const lifecycle = createRenderMetricsLifecycle(() => {}, true, () => { throw new Error("sink"); });
  lifecycle.onRender({ renderTime: 100 });
  assert.throws(() => lifecycle.unmount(() => { throw new Error("unmount"); }), /unmount/);
  assert.doesNotThrow(() => lifecycle.unmount(() => {}));
});

test("actual Ink onRender and teardown wiring leaves active frame untouched", async () => {
  const stdin = new PassThrough();
  const frames: string[] = [];
  const stdout = new Writable({ write(chunk, _encoding, callback) { frames.push(String(chunk)); callback(); } });
  Object.assign(stdout, { columns: 80, rows: 24, isTTY: true });
  let initial = 0;
  let renders = 0;
  const messages: string[] = [];
  const lifecycle = createRenderMetricsLifecycle(() => initial++, true, (message) => messages.push(message));
  const instance = render(createElement(Text, {}, "metrics wiring"), {
    stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as NodeJS.WriteStream,
    stderr: stdout as NodeJS.WriteStream, patchConsole: true, exitOnCtrlC: false,
    onRender(metrics) {
      renders++;
      // Deterministically inject a slow sample through the same lifecycle used
      // by index.ts; do not turn the test into a CPU-speed benchmark.
      lifecycle.onRender({ ...metrics, renderTime: 100 });
    },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(initial, 1);
    assert.ok(renders > 0);
    assert.equal(messages.length, 0);
    assert.doesNotMatch(frames.join(""), /tui-render/);
    lifecycle.unmount(() => instance.unmount());
    const finishedRenders = renders;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(renders, finishedRenders);
    assert.equal(messages.length, 1);
  } finally {
    instance.unmount();
    instance.cleanup();
    stdin.destroy();
    stdout.destroy();
  }
});
