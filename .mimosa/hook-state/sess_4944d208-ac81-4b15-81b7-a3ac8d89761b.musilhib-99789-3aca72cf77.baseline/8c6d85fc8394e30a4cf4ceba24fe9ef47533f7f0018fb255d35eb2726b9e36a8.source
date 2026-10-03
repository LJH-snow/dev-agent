import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough, Writable } from "node:stream";
import { createElement } from "react";
import { render } from "ink";
import { useAnimationTicks } from "../dist/ink/animation-clock.js";
import {
  ANIMATION_TICK_MS,
  subscribeToAnimationClock,
} from "../dist/ink/animation-clock.js";

test("animation clock ticks subscribers on one shared interval", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.after(() => t.mock.timers.reset());
  const seenA: number[] = [];
  const seenB: number[] = [];
  const unsubscribeA = subscribeToAnimationClock((value) => seenA.push(value));
  t.after(unsubscribeA);
  const unsubscribeB = subscribeToAnimationClock((value) => seenB.push(value));
  t.after(unsubscribeB);

  t.mock.timers.tick(ANIMATION_TICK_MS);
  assert.deepEqual(seenA, [1]);
  assert.deepEqual(seenB, [1]);

  t.mock.timers.tick(ANIMATION_TICK_MS * 2);
  assert.deepEqual(seenA, [1, 2, 3]);
  assert.deepEqual(seenB, [1, 2, 3]);

  unsubscribeA();
  t.mock.timers.tick(ANIMATION_TICK_MS);
  assert.deepEqual(seenA, [1, 2, 3]);
  assert.deepEqual(seenB, [1, 2, 3, 4]);
  unsubscribeB();

});

test("the shared timer stops after the last subscriber leaves", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.after(() => t.mock.timers.reset());
  const seen: number[] = [];
  const unsubscribe = subscribeToAnimationClock((value) => seen.push(value));
  t.after(unsubscribe);
  t.mock.timers.tick(ANIMATION_TICK_MS);
  assert.deepEqual(seen, [1]);

  unsubscribe();
  t.mock.timers.tick(ANIMATION_TICK_MS * 5);
  assert.deepEqual(seen, [1]);

  // Resubscribing restarts the clock from tick 1.
  const revived: number[] = [];
  const unsubscribeRevived = subscribeToAnimationClock((value) => revived.push(value));
  t.after(unsubscribeRevived);
  t.mock.timers.tick(ANIMATION_TICK_MS);
  assert.deepEqual(revived, [1]);
  unsubscribeRevived();

});

test("double unsubscribe is a no-op and does not affect other subscribers", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.after(() => t.mock.timers.reset());
  const seen: number[] = [];
  const unsubscribe = subscribeToAnimationClock(() => seen.push(1));
  t.after(unsubscribe);
  const other: number[] = [];
  const unsubscribeOther = subscribeToAnimationClock((value) => other.push(value));
  t.after(unsubscribeOther);

  unsubscribe();
  unsubscribe();
  t.mock.timers.tick(ANIMATION_TICK_MS);
  assert.deepEqual(seen, []);
  assert.deepEqual(other, [1]);
  unsubscribeOther();

});

test("duplicate callbacks have independent subscription lifetimes", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  const callback = () => calls++;
  const a = subscribeToAnimationClock(callback);
  const b = subscribeToAnimationClock(callback);
  t.after(() => { a(); b(); t.mock.timers.reset(); });
  t.mock.timers.tick(180);
  assert.equal(calls, 2);
  a();
  t.mock.timers.tick(180);
  assert.equal(calls, 3);
});

test("unsubscribe during dispatch skips the removed listener", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const a = subscribeToAnimationClock(() => b());
  const b = subscribeToAnimationClock(() => assert.fail("removed callback"));
  t.after(() => { a(); b(); t.mock.timers.reset(); });
  t.mock.timers.tick(180);
});

test("mounted hook uses local ticks, latest closure, reset keys and active cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const keepAlive = subscribeToAnimationClock(() => {});
  t.mock.timers.tick(180 * 7);
  const seen: string[] = [];
  function Probe({ label, active, resetKey }: { label: string; active: boolean; resetKey: string }) {
    useAnimationTicks((tick) => seen.push(`${label}:${tick}`), active, resetKey);
    return null;
  }
  const stdin = new PassThrough();
  const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const instance = render(createElement(Probe, { label: "a", active: true, resetKey: "1" }), {
    stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as NodeJS.WriteStream,
    stderr: stdout as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
  try {
    await settle();
    t.mock.timers.tick(180);
    assert.deepEqual(seen, ["a:1"]);
    instance.rerender(createElement(Probe, { label: "b", active: true, resetKey: "1" }));
    await settle();
    t.mock.timers.tick(180);
    assert.deepEqual(seen, ["a:1", "b:2"]);
    instance.rerender(createElement(Probe, { label: "c", active: true, resetKey: "2" }));
    await settle();
    t.mock.timers.tick(180);
    assert.equal(seen.at(-1), "c:1");
    instance.rerender(createElement(Probe, { label: "c", active: false, resetKey: "2" }));
    await settle();
    t.mock.timers.tick(360);
    assert.equal(seen.length, 3);
    instance.rerender(createElement(Probe, { label: "d", active: true, resetKey: "2" }));
    await settle();
    t.mock.timers.tick(180);
    assert.equal(seen.at(-1), "d:1");
    instance.unmount();
    await settle();
    t.mock.timers.tick(360);
    assert.equal(seen.length, 4);
  } finally {
    instance.unmount(); instance.cleanup(); keepAlive();
    stdin.destroy(); stdout.destroy(); t.mock.timers.reset();
  }
});
