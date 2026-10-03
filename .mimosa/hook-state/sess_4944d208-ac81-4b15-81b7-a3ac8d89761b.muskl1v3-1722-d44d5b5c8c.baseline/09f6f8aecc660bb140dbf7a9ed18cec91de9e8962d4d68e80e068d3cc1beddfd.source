import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const moduleSource = await readFile(new URL("../public/task-templates.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const templates = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`) as any;

class MemoryStorage {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("built-in task templates stay bilingual and bounded", () => {
  assert.equal(templates.BUILTIN_TASK_TEMPLATES.length, 5);
  assert.equal(templates.BUILTIN_TASK_TEMPLATES[0].id, "fix-bug");
  for (const template of templates.BUILTIN_TASK_TEMPLATES) {
    assert.match(template.prompt.en, /\S/);
    assert.match(template.prompt.zh, /\S/);
    assert.ok(template.prompt.en.length <= templates.MAX_TASK_TEMPLATE_PROMPT_CHARS);
    assert.ok(template.prompt.zh.length <= templates.MAX_TASK_TEMPLATE_PROMPT_CHARS);
    assert.match(template.shortcut, /^[1-5]$/);
  }
  assert.match(
    templates.localizedTaskTemplatePrompt(templates.BUILTIN_TASK_TEMPLATES[0], "zh"),
    /修复|调查/,
  );
});

test("custom template storage normalizes malformed data and persists bounded records", () => {
  const storage = new MemoryStorage();
  storage.setItem(templates.TASK_TEMPLATE_STORAGE_KEY, JSON.stringify({
    version: 99,
    templates: [
      { id: "../unsafe", name: "bad", prompt: "should be rejected" },
      { id: "custom-kept", name: "  Saved\u0000 task ", prompt: "  inspect\nchanges  ", defaultMode: "plan" },
      { id: "custom-kept", name: "duplicate", prompt: "duplicate" },
    ],
  }));
  const store = templates.createTaskTemplateStore({
    storage,
    now: () => "2026-09-25T10:00:00.000Z",
    idFactory: () => "custom-generated",
  });
  assert.deepEqual(store.list().map((item: any) => item.id), ["custom-kept"]);
  assert.equal(store.list()[0].name, "Saved task");
  assert.equal(store.list()[0].defaultMode, "plan");

  const saved = store.upsert({ name: "New local task", prompt: "Run the focused checks", defaultMode: "normal" });
  assert.equal(saved.ok, true);
  assert.equal(store.list()[0].id, "custom-generated");
  assert.equal(store.list()[0].prompt, "Run the focused checks");

  const reloaded = templates.createTaskTemplateStore({ storage, now: () => "2026-09-25T11:00:00.000Z" });
  assert.equal(reloaded.list().length, 2);
  assert.equal(reloaded.remove("custom-generated").ok, true);
  assert.equal(reloaded.list().length, 1);
});

test("custom template limits fail closed instead of accepting oversized or excessive input", () => {
  const storage = new MemoryStorage();
  const store = templates.createTaskTemplateStore({
    storage,
    idFactory: (() => {
      let index = 0;
      return () => `custom-${++index}`;
    })(),
  });
  assert.equal(store.upsert({ name: "", prompt: "missing name" }).ok, false);
  assert.equal(store.upsert({ name: "missing prompt", prompt: "" }).ok, false);
  assert.equal(store.upsert({ name: "oversized", prompt: "x".repeat(templates.MAX_TASK_TEMPLATE_PROMPT_CHARS + 1) }).ok, true);
  assert.equal(store.list()[0].prompt.length, templates.MAX_TASK_TEMPLATE_PROMPT_CHARS);

  for (let index = store.list().length; index < templates.MAX_CUSTOM_TASK_TEMPLATES; index += 1) {
    assert.equal(store.upsert({ name: `Task ${index}`, prompt: `Prompt ${index}` }).ok, true);
  }
  assert.equal(store.list().length, templates.MAX_CUSTOM_TASK_TEMPLATES);
  assert.equal(store.upsert({ name: "one too many", prompt: "Prompt" }).reason, "limit");
});

test("Desktop exposes safe template palette and quick-action contracts", () => {
  assert.match(html, /\/public\/task-templates\.js/);
  for (const id of [
    "task-template-toggle",
    "task-template-palette",
    "task-template-search",
    "task-template-list",
    "task-template-name",
    "task-template-prompt",
    "task-template-save",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-template-quick="fix-bug"/);
  assert.match(html, /Ctrl\+K/);
  assert.match(moduleSource, /handleShortcut/);
  assert.match(moduleSource, /textContent/);
  assert.match(moduleSource, /MAX_TASK_TEMPLATE_STORAGE_BYTES/);
  assert.match(styles, /\.task-template-palette\s*\{/);
  assert.match(styles, /\.composer-quick-action\s*\{/);
});
