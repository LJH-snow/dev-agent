import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const moduleUrl = new URL("../public/composer-state.js", import.meta.url).href;
const load = () => import(moduleUrl);
function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}

test("composer keeps exact per-session drafts and modes across a tab reload", async () => {
  const { createComposerDrafts } = await load();
  const storage = memoryStorage();
  const drafts = createComposerDrafts({ storage, now: () => 1000 });
  drafts.save("alpha", { text: "  中文草稿\n第二行  ", mode: "plan" });
  drafts.save("beta", { text: "A different task", mode: "normal" });
  assert.deepEqual(drafts.read("alpha"), { text: "  中文草稿\n第二行  ", mode: "plan" });
  assert.equal(drafts.read("unknown"), undefined);
  assert.deepEqual(createComposerDrafts({ storage, now: () => 1100 }).read("alpha"), drafts.read("alpha"));
  const copy = drafts.read("alpha"); copy.text = "mutated";
  assert.notEqual(drafts.read("alpha").text, copy.text);
  assert.equal(drafts.isPersisted("alpha"), true);
});

test("sending, deletion and rename clear or move only the owning session's draft", async () => {
  const { createComposerDrafts } = await load();
  const storage = memoryStorage();
  const drafts = createComposerDrafts({ storage });
  drafts.save("alpha", { text: "draft", mode: "plan" });
  drafts.save("beta", { text: "other" });
  drafts.move("alpha", "renamed");
  assert.equal(drafts.read("alpha"), undefined);
  assert.equal(drafts.read("renamed").mode, "plan");
  drafts.remove("renamed");
  assert.deepEqual(drafts.sessionIds(), ["beta"]);
  drafts.save("beta", { text: "" });
  assert.deepEqual(drafts.sessionIds(), []);
  assert.equal(storage.values.size, 0);
});

test("unavailable storage and oversized drafts retain live text without claiming it was saved", async () => {
  const { createComposerDrafts } = await load();
  const drafts = createComposerDrafts({ storage: { getItem() { throw Error("blocked"); }, setItem() { throw Error("quota"); } } });
  drafts.save("alpha", { text: "retained in this window" });
  assert.equal(drafts.read("alpha").text, "retained in this window");
  assert.equal(drafts.isPersisted("alpha"), false);
  const storage = memoryStorage();
  const bounded = createComposerDrafts({ storage });
  bounded.save("alpha", { text: "old" });
  bounded.save("alpha", { text: "x".repeat(16385) });
  assert.equal(bounded.read("alpha").text.length, 16385);
  assert.equal(bounded.isPersisted("alpha"), false);
  assert.equal(createComposerDrafts({ storage }).read("alpha"), undefined);
});

test("draft snapshots are versioned, bounded, expired and untrusted payloads fail closed", async () => {
  const { createComposerDrafts, COMPOSER_DRAFT_STORAGE_KEY } = await load();
  const storage = memoryStorage();
  for (const raw of ["{", "null", JSON.stringify({version:99, entries:[]}), "x".repeat(262145)]) {
    storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, raw);
    assert.deepEqual(createComposerDrafts({ storage }).sessionIds(), []);
  }
  const drafts = createComposerDrafts({ storage, now: () => 1000 });
  drafts.save("__proto__", {text:"literal session ID", mode:"plan"});
  for (let i=0; i<40; i++) drafts.save(`session-${i}`, { text: "文".repeat(16000) });
  assert.ok(drafts.sessionIds().length <= 32);
  assert.ok(new TextEncoder().encode(storage.getItem(COMPOSER_DRAFT_STORAGE_KEY)!).byteLength <= 262144);
  assert.equal(drafts.isPersisted("session-39"), true);
  assert.deepEqual(createComposerDrafts({ storage, now: () => 1000 + 86400001 }).sessionIds(), []);
  storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, JSON.stringify({version:1, entries:[{sessionId:"alpha",text:"<img onerror=alert(1)>",mode:"invalid",savedAt:1000}]}));
  assert.deepEqual(createComposerDrafts({ storage, now: () => 1100 }).read("alpha"), {text:"<img onerror=alert(1)>",mode:"normal"});
});

test("Enter submits only after IME composition, never on repeat, Shift or a prevented event", async () => {
  const { shouldSubmitComposer } = await load();
  assert.equal(shouldSubmitComposer({key:"Enter"}), true);
  for (const event of [{key:"a"},{key:"Enter",shiftKey:true},{key:"Enter",isComposing:true},{key:"Enter",keyCode:229},{key:"Enter",repeat:true},{key:"Enter",defaultPrevented:true}]) assert.equal(shouldSubmitComposer(event), false);
  assert.equal(shouldSubmitComposer({key:"Enter"}, true), false);
});

test("composer integration wires every session lifecycle, draft feedback and composition boundaries", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /createComposerDrafts/);
  assert.match(html, /switchComposerSession\(sessionSelect\.value\)/);
  assert.match(html, /switchComposerSession\("session-"/);
  assert.match(html, /composerDrafts\.move\(renamedFrom, renamed\)/);
  assert.match(html, /composerDrafts\.remove\(deletedSessionId\)/);
  assert.match(html, /githubPrReviewUI\?\.sessionChanged\(\)/);
  assert.match(html, /shouldSubmitComposer\(e, composerIsComposing\)/);
  assert.match(html, /"compositionstart"/);
  assert.match(html, /"compositionend"/);
  assert.match(html, /id="composer-draft-status"/);
});
