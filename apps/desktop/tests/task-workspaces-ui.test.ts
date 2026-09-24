import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const controller = await readFile(new URL("../public/task-workspace-ui.js", import.meta.url), "utf8");

test("Desktop exposes an isolated task action and bilingual worktree inspector contract", () => {
  assert.match(html, /id="new-task"[^>]*data-i18n-title="session\.newTaskTitle"/);
  assert.match(html, /id="task-workspace-panel"/);
  assert.match(html, /id="task-workspace-list"/);
  assert.match(html, /id="task-workspace-diff-tabs"[^>]*role="tablist"/);
  assert.match(html, /id="task-workspace-comments-panel"/);
  assert.match(html, /id="task-workspace-comments-list"/);
  assert.match(html, /id="task-workspace-insert-comments"/);
  assert.match(html, /id="task-workspace-branch"/);
  assert.match(html, /id="task-workspace-directory"/);
  assert.match(html, /id="task-workspace-state"/);
  assert.match(html, /id="task-workspace-changes"/);
  assert.match(html, /id="task-workspace-compare"/);
  assert.match(html, /id="task-workspace-merge"/);
  assert.match(html, /id="task-workspace-cleanup"/);
  assert.match(html, /"workspace\.title": "Task workspaces"/);
  assert.match(html, /"workspace\.title": "任务工作区"/);
  assert.match(html, /createTaskWorkspaceUI\(/);
  assert.match(styles, /\.task-workspace-card\s*\{/);
  assert.match(styles, /\.task-workspace-diff\s*\{/);
  assert.match(styles, /\.task-workspace-diff-line\.is-addition/);
  assert.match(styles, /\.task-workspace-comments-panel/);
});

test("task worktree actions use the bounded API and confirm merge or cleanup", () => {
  assert.match(controller, /compareButton\.addEventListener\("click", \(\) => void compare\(\)\)/);
  assert.match(controller, /fetcher\("\/api\/workspaces"/);
  assert.match(controller, /method: "POST"[\s\S]*body: JSON\.stringify\(\{\}\)/);
  assert.match(controller, /\/api\/workspaces\/\$\{encodeURIComponent\(workspace\.sessionId\)\}\/diff\$\{query\}/);
  assert.match(controller, /\?path=\$\{encodeURIComponent\(path\)\}/);
  assert.match(controller, /workspace\.diff\.\$\{section\.group\}/);
  assert.match(html, /"workspace\.diff\.staged": "Staged"/);
  assert.match(html, /"workspace\.diff\.unstaged": "Unstaged"/);
  assert.match(controller, /setAttribute\("aria-selected"/);
  assert.match(controller, /\/api\/workspaces\/\$\{encodeURIComponent\(workspace\.sessionId\)\}\/merge/);
  assert.match(controller, /confirmAction\(translate\("workspace\.confirm\.merge"/);
  assert.match(controller, /confirmAction\(translate\("workspace\.confirm\.cleanup"/);
  assert.match(controller, /\/api\/workspaces\/\$\{encodeURIComponent\(workspace\.sessionId\)\}.*method: "DELETE"/);
  assert.match(controller, /mergeButton\.disabled = !workspace \|\| workspace\.dirty/);
  assert.match(controller, /cleanupButton\.disabled = !workspace \|\| workspace\.dirty/);
  assert.doesNotMatch(controller, /\.innerHTML\s*=/, "Git paths and diffs must not enter an HTML parser");
  assert.match(controller, /renderPatch\(selectedWorkspace\(\), activeChoice\.group, activeChoice\.diff\)/);
  assert.match(controller, /textContent = file\.path/);
});

test("review comments persist per task session and stay bounded when inserted", async () => {
  const module = await import(pathToFileURL(fileURLToPath(new URL("../public/task-workspace-ui.js", import.meta.url))).href);
  const storage = new Map<string, string>();
  const adapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  };
  const comments = [
    { path: "src/app.ts", anchor: "@@ -1,2 +1,3 @@", group: "unstaged", text: "check this branch" },
    { path: "bad\u0000path", anchor: "line 2", group: "unknown", text: "safe" },
  ];
  assert.equal(module.writeReviewComments(adapter, "task-a", comments), true);
  const restored = module.readReviewComments(adapter, "task-a");
  assert.equal(restored.length, 2);
  assert.equal(restored[1].group, "all");
  const formatted = module.formatReviewComments(restored);
  assert.match(formatted, /Review comment src\/app\.ts:/);
  assert.doesNotMatch(formatted, /\u0000/);
  assert.ok(formatted.length <= 32 * 1024);
});
