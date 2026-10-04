import assert from "node:assert/strict";
import test from "node:test";

import { InkRuntimeStore } from "../dist/ink/runtime-store.js";

test("runtime store bounds and defensively copies prompt history", () => {
  const store = new InkRuntimeStore();
  const prompts = ["first", "second"];
  store.setPromptHistory(prompts);
  prompts.push("mutated outside the store");

  const snapshot = store.getSnapshot();
  assert.deepEqual(snapshot.promptHistory, ["first", "second"]);
  assert.notEqual(snapshot.promptHistory, prompts);

  store.appendPromptHistory("third");
  assert.deepEqual(store.getSnapshot().promptHistory, ["first", "second", "third"]);
});

test("runtime store replaces session projections without retaining old history", () => {
  const store = new InkRuntimeStore();
  store.setPromptHistory(["session A prompt"]);
  store.addNotice("old notice");
  store.setHistoryView({ title: "old history", rows: ["old row"] });

  const beforeRevision = store.getSnapshot().promptHistoryRevision;
  store.replaceSession(["session B prompt"]);
  const snapshot = store.getSnapshot();

  assert.deepEqual(snapshot.promptHistory, ["session B prompt"]);
  assert.equal(snapshot.notices.length, 0);
  assert.equal(snapshot.historyView, undefined);
  assert.ok(snapshot.promptHistoryRevision > beforeRevision);
});

test("ordinary runtime reset preserves prompt history for the active session", () => {
  const store = new InkRuntimeStore();
  store.setPromptHistory(["keep this prompt"]);
  store.addNotice("temporary notice");

  store.reset();

  assert.deepEqual(store.getSnapshot().promptHistory, ["keep this prompt"]);
  assert.equal(store.getSnapshot().notices.length, 0);
});
